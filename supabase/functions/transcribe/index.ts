/**
 * Homatt Health — Transcribe (Supabase Edge Function)
 *
 * Turns a short clip of a clinician speaking into text, using OpenAI Whisper.
 * The API key is a Supabase secret and never reaches the phone — the same
 * arrangement as ai-proxy and send-notification.
 *
 *   POST /functions/v1/transcribe
 *   Body: multipart/form-data with `audio` (a recorded clip) and an optional
 *         `mode` of "vitals" (default) or "story", which chooses the vocabulary
 *         Whisper is told to expect.
 *   Reply: { "text": "temp 38.5 BP 120 over 80 pulse 96" }
 *
 * Secrets, whichever the project has. Deepgram is tried first:
 *   DEEPGRAM_API_KEY  — cheaper per minute, and its keyword boosting can be
 *                       fed the vitals vocabulary, which is where the numbers
 *                       a nurse acts on come from
 *   OPENAI_API_KEY    — Whisper; already used by ai-proxy
 *
 * WHAT THIS IS AND IS NOT FOR
 * ---------------------------
 * It transcribes what a clinician says while taking a history: the vitals read
 * off a thermometer and a cuff, and the complaint the patient came with. The
 * reply is text; the app decides where it belongs and shows it for the
 * clinician to check. Nothing here writes to a record, sets a diagnosis, or
 * names a medicine.
 *
 * Two things are deliberately bounded, because this costs money per minute and
 * sends patient audio off the premises:
 *   • MAX_BYTES caps a clip at roughly a minute. A stuck microphone cannot run
 *     up a bill or upload a whole consultation.
 *   • The caller must be signed in. Supabase verifies the JWT before this code
 *     runs, so an unauthenticated request never reaches OpenAI.
 */

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const DEEPGRAM_API = 'https://api.deepgram.com/v1';
const OPENAI_MODELS = 'https://api.openai.com/v1/models';

// Below this many dollars the clinic is told to top up, rather than finding out
// mid-morning with a patient in front of them. Deepgram's nova-2 runs at well
// under a cent a minute, so a few dollars is still weeks of dictation — but a
// clinic on a bad line cannot fix an empty account quickly, and the warning is
// only useful if it arrives before the service stops.
const LOW_BALANCE = 5;

// Deepgram boosts words you tell it to expect. These are the ones whose
// mishearing costs the most: a missed "temp" leaves a reading unlabelled and
// the app then refuses it, so the clinician types it anyway.
const BOOST_VITALS = [
  'temperature:3', 'temp:3', 'pulse:3', 'weight:3', 'BP:3',
  'blood pressure:3', 'systolic:2', 'diastolic:2', 'mmHg:2',
  'celsius:2', 'kilograms:2',
];

// What a clinician says while taking a history, and how they say it here.
const BOOST_STORY = [
  'complains:3', 'complaining:3', 'presents:2', 'presenting:2',
  'fever:2', 'headache:2', 'cough:2', 'vomiting:2', 'diarrhoea:2',
  'body hotness:2', 'running stomach:2', 'general body pain:2',
  'boda boda:2', 'coartem:2', 'panadol:2',
];

/**
 * Ugandan names, so the recogniser has heard of them.
 *
 * nova-2-medical is trained on English, and an English model faced with
 * "Okello" or "Nakato" will produce the nearest English word it knows —
 * "Emmanuel Opio" came back as "Emmanuel Opal". Keyword boosting is exactly
 * the mechanism for this: it does not force a word, it raises the odds of one
 * the model would otherwise rank below a common English word.
 *
 * These are name STEMS, chosen for how commonly they occur and how badly an
 * English model mangles them. The weight is deliberately modest — a name is
 * worth finding, but not at the cost of hearing "Kato" for "cardio".
 *
 * Names that are also ordinary English words (Grace, Mercy, Innocent, Gift,
 * Patience, Peace, Blessing, Joy) are left out on purpose: they are already
 * recognised, and boosting them would make every "grace period" a patient.
 */
const BOOST_NAMES = [
  // Luganda / Baganda
  'Nakato', 'Babirye', 'Wasswa', 'Kato', 'Mukasa', 'Lubega', 'Kiggundu',
  'Ssemakula', 'Nabukenya', 'Namuli', 'Nakayima', 'Kizza', 'Ssebunya',
  'Nalubega', 'Nassiwa', 'Kayemba', 'Ssentongo', 'Namusoke', 'Mubiru',
  'Sserwadda', 'Nanyonga', 'Kaggwa', 'Nakiganda',
  // Acholi / Lango / Alur
  'Okello', 'Ocen', 'Opio', 'Odongo', 'Otim', 'Ojok', 'Oyella', 'Akello',
  'Auma', 'Aber', 'Lakot', 'Adong', 'Okot', 'Oketa', 'Obalim', 'Anena',
  // Iteso / Karimojong
  'Emokol', 'Apio', 'Asio', 'Ekwaru', 'Ochen', 'Amuge', 'Ikile',
  // Basoga
  'Waiswa', 'Balikoowa', 'Mudondo', 'Kagoya', 'Isabirye',
  // Banyankole / Bakiga / Batooro
  'Tumusiime', 'Atuhaire', 'Byaruhanga', 'Katusiime', 'Mugisha',
  'Kyomuhendo', 'Ninsiima', 'Ainembabazi', 'Twinomugisha', 'Asiimwe',
  'Kembabazi', 'Muhumuza', 'Turyahabwe', 'Natukunda',
  // Given names common here that an English model still gets wrong
  'Nabirye', 'Namutebi', 'Ssekandi', 'Kirabo', 'Achieng', 'Adhiambo',
  'Nangobi', 'Kabuye', 'Ssempala', 'Nakabugo',
].map((n) => `${n}:2`);

/**
 * What the clinic and the admin need to be told apart.
 *
 *   'credit'  — the account is out of money or over quota. The clinic can do
 *               nothing about it; somebody has to top the account up. This is
 *               the one that must never be reported as a network glitch,
 *               because it will not fix itself and dictation stays dead.
 *   'auth'    — the key is wrong, revoked, or was never set.
 *   'busy'    — rate limited. Trying again in a moment usually works.
 *   'refused' — the audio itself was rejected.
 */
function upstreamFault(status: number): { kind: string; message: string } {
  if (status === 402) {
    return { kind: 'credit',
             message: 'The dictation account is out of credit. Dictation will ' +
                      'not work until it is topped up — type the readings for now.' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth',
             message: 'The dictation key was refused. It may have been revoked ' +
                      'or replaced — type the readings for now.' };
  }
  if (status === 429) {
    return { kind: 'busy',
             message: 'The dictation service is busy. Wait a moment and try again.' };
  }
  return { kind: 'refused',
           message: 'The dictation service refused the recording.' };
}

// The phone now records the whole story rather than one blood pressure, at a
// guaranteed 64 kbps floor: two minutes is about 960 KB. 4 MB leaves room for
// a phone that chose a higher bitrate, and is still bounded — a forgotten
// recording costs a fraction of a cent, not an afternoon.
const MAX_BYTES = 4 * 1024 * 1024;

// Whisper accepts a prompt to bias what it expects to hear. Feeding it the
// vocabulary of a vitals reading measurably improves the numbers and the
// units, which is the whole point — the app throws away anything it cannot
// recognise as a labelled reading, so a better transcript is a better fill.
const HINTS: Record<string, string> = {
  vitals:
    'Clinical vitals dictated by a nurse in a Ugandan clinic. ' +
    'Temperature in degrees Celsius, blood pressure in mmHg systolic over ' +
    'diastolic, pulse in beats per minute, weight in kilograms. ' +
    'For example: temperature 38.5, BP 120 over 80, pulse 96, weight 62.',
  // The complaint and the story. Biasing toward vitals here would push the
  // model to hear numbers that were never said; biasing toward the way a
  // Ugandan clinician actually describes a presentation gives a better
  // transcript of the words that matter — including the negatives, which
  // carry as much clinical weight as the positives.
  story:
    'A clinician in a Ugandan clinic describing what a patient came with. ' +
    'Symptoms, how long they have lasted, what makes them better or worse, ' +
    'what the patient has already taken, and what they deny. ' +
    'For example: complains of fever and headache for two days, also ' +
    'vomiting, no diarrhoea, has taken panadol with no relief.',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Enough of a key to tell one from another, and not enough to use.
 *  Rotating a key is only half done until somebody can SEE that the new one is
 *  the one in use — and "dictation works" reads identically for the burnt key
 *  and its replacement. Four characters name it; the rest never leaves here. */
function keyTag(key: string): string {
  const k = String(key || '');
  if (k.length < 8) return '????';
  return '…' + k.slice(-4);
}

/**
 * Is dictation actually working, and how much is left?
 *
 * Asked from the settings screen, so an owner can see the account has run dry
 * BEFORE a clinician meets a dead button in front of a patient. It sends no
 * audio and costs nothing: Deepgram's projects endpoint answers whether the key
 * is live, and the balances endpoint answers what is left on it.
 */
async function probeDeepgram(key: string) {
  const head = { Authorization: `Token ${key}` };
  let r: Response;
  try {
    r = await fetch(`${DEEPGRAM_API}/projects`, { headers: head });
  } catch {
    return { name: 'deepgram', ok: false, kind: 'unreachable', balance: null,
             key: keyTag(key),
             message: 'Could not reach Deepgram from this server.' };
  }
  if (!r.ok) {
    const f = upstreamFault(r.status);
    return { name: 'deepgram', ok: false, kind: f.kind, balance: null,
             key: keyTag(key), message: f.message };
  }

  // The key works. What is left on it is a separate question, and a project
  // without billing access answers it with a 403 — which is not a fault, so a
  // balance we cannot read is reported as unknown rather than as a failure.
  let amount: number | null = null;
  try {
    const j = await r.json();
    const id = j?.projects?.[0]?.project_id;
    if (id) {
      const b = await fetch(`${DEEPGRAM_API}/projects/${id}/balances`, { headers: head });
      if (b.ok) {
        const bj = await b.json();
        const bal = Array.isArray(bj?.balances) ? bj.balances : [];
        const total = bal.reduce(
          (s: number, x: { amount?: unknown }) => s + (Number(x?.amount) || 0), 0);
        if (bal.length) amount = Math.round(total * 100) / 100;
      }
    }
  } catch { /* the key is good; the balance is simply unknown */ }

  if (amount !== null && amount <= 0) {
    return { name: 'deepgram', ok: false, kind: 'credit', balance: amount,
             key: keyTag(key),
             message: 'The Deepgram account is empty. Dictation will not work ' +
                      'until it is topped up.' };
  }
  if (amount !== null && amount < LOW_BALANCE) {
    return { name: 'deepgram', ok: true, kind: 'low', balance: amount,
             key: keyTag(key),
             message: `Dictation is working, but only $${amount.toFixed(2)} is ` +
                      'left on the Deepgram account. Top it up before it runs out.' };
  }
  return { name: 'deepgram', ok: true, kind: '', balance: amount,
           key: keyTag(key),
           message: amount === null
             ? 'Dictation is working. The balance on this key cannot be read.'
             : `Dictation is working. $${amount.toFixed(2)} left on the account.` };
}

/** The fallback. OpenAI will not tell us a balance, only whether the key lives. */
async function probeWhisper(key: string) {
  let r: Response;
  try {
    r = await fetch(OPENAI_MODELS, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    return { name: 'whisper', ok: false, kind: 'unreachable', balance: null,
             message: 'Could not reach OpenAI from this server.' };
  }
  if (r.ok) {
    return { name: 'whisper', ok: true, kind: '', balance: null,
             message: 'The OpenAI key works. OpenAI does not report a balance.' };
  }
  const f = upstreamFault(r.status);
  return { name: 'whisper', ok: false, kind: f.kind, balance: null,
           message: f.message };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Only POST requests are supported.' }, 405);
  }

  const dg = Deno.env.get('DEEPGRAM_API_KEY');
  const oa = Deno.env.get('OPENAI_API_KEY');

  // ── "Is dictation working?" ────────────────────────────────────────────────
  // A JSON body rather than a clip means the caller is asking after the
  // service, not using it. Checked before the secrets, so a server with no key
  // at all still answers the question instead of erroring.
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    let probe = false;
    try { probe = !!(await req.json())?.probe; } catch { probe = false; }
    if (probe) {
      if (!dg && !oa) {
        return json({ checked: true, ok: false, kind: 'unconfigured',
          message: 'Dictation is not set up on this server. Set DEEPGRAM_API_KEY ' +
                   'in Supabase secrets.', providers: [] });
      }
      const providers = [];
      if (dg) providers.push(await probeDeepgram(dg));
      if (oa) providers.push(await probeWhisper(oa));
      // Dictation works if ANY provider works — the app falls back the same way.
      const live = providers.find((p) => p.ok);
      const worst = providers.find((p) => p.kind === 'credit')
                 || providers.find((p) => p.kind === 'auth')
                 || providers[0];
      return json({
        checked: true,
        ok: !!live,
        // A working service with a thin balance still reports 'low', because
        // that is the thing worth acting on today.
        kind: live ? (live.kind || '') : (worst?.kind || 'refused'),
        message: live ? live.message : (worst?.message || 'Dictation is not working.'),
        providers,
      });
    }
  }

  if (!dg && !oa) {
    // Said plainly, because the clinic-side symptom is a dictate button that
    // does nothing, and the cause is a secret nobody set.
    return json({ error: 'Dictation is not configured on this server. Set ' +
                         'DEEPGRAM_API_KEY or OPENAI_API_KEY in Supabase secrets.',
                  kind: 'unconfigured' }, 503);
  }

  let audio: File | null = null;
  let mode = 'vitals';
  try {
    const form = await req.formData();
    const f = form.get('audio');
    if (f instanceof File) audio = f;
    const m = String(form.get('mode') || '').toLowerCase();
    if (m && HINTS[m]) mode = m;
  } catch {
    return json({ error: 'Send the clip as multipart/form-data in `audio`.' }, 400);
  }
  if (!audio) return json({ error: 'No audio was sent.' }, 400);
  if (audio.size === 0) return json({ error: 'The recording was empty.' }, 400);
  if (audio.size > MAX_BYTES) {
    return json({ error: 'That recording is too long. Say the readings in ' +
                         'one short sentence and try again.' }, 413);
  }

  async function viaDeepgram(key: string) {
    // Which model, and why it can be changed without a deploy.
    //
    // nova-2-medical is tuned for dictated American medical notes. What this
    // app actually hears is Ugandan-accented conversational English in a noisy
    // room, and which model wins on that is a question about real audio, not
    // one to settle by argument. DEEPGRAM_MODEL lets a clinic try another —
    // nova-3, nova-2-general — and compare, with no code change and no deploy.
    //
    // nova-3 replaced `keywords` with `keyterm`, so the parameter follows the
    // model rather than being hard-coded beside it.
    const model = Deno.env.get('DEEPGRAM_MODEL') || 'nova-2-medical';
    const q = new URLSearchParams({
      model, language: 'en', smart_format: 'true',
      punctuate: 'true', numerals: 'true',
    });
    // Vitals mode hears numbers; story mode hears people and symptoms. Biasing
    // one toward the other's vocabulary makes it hear things nobody said.
    const boost = mode === 'vitals'
      ? BOOST_VITALS
      : BOOST_VITALS.concat(BOOST_STORY, BOOST_NAMES);
    const param = /^nova-3/.test(model) ? 'keyterm' : 'keywords';
    boost.forEach((k) => {
      // nova-3 takes the phrase without the :weight suffix nova-2 wants.
      q.append(param, param === 'keyterm' ? k.replace(/:\d+$/, '') : k);
    });
    const r = await fetch(`${DEEPGRAM_URL}?${q}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`,
                 'Content-Type': audio!.type || 'audio/webm' },
      body: await audio!.arrayBuffer(),
    });
    if (!r.ok) return { ok: false as const, status: r.status };
    const j = await r.json();
    const t = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { ok: true as const, text: String(t) };
  }

  async function viaWhisper(key: string) {
    const out = new FormData();
    out.append('file', audio!, audio!.name || 'clip.webm');
    out.append('model', 'whisper-1');
    out.append('language', 'en');
    out.append('prompt', HINTS[mode]);
    // Plain text back: the app does its own parsing and has no use for word
    // timings or confidence scores.
    out.append('response_format', 'text');
    const r = await fetch(OPENAI_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: out,
    });
    if (!r.ok) return { ok: false as const, status: r.status };
    return { ok: true as const, text: (await r.text()).trim() };
  }

  const tries: Array<[string, () => Promise<{ ok: boolean; text?: string; status?: number }>]> = [];
  if (dg) tries.push(['deepgram', () => viaDeepgram(dg)]);
  if (oa) tries.push(['whisper', () => viaWhisper(oa)]);

  let lastFault: { kind: string; message: string } | null = null;
  let lastStatus = 0;
  for (const [name, run] of tries) {
    let r;
    try {
      r = await run();
    } catch (e) {
      lastFault = { kind: 'unreachable',
                    message: 'Could not reach the dictation service.' };
      continue;
    }
    if (r.ok) return json({ text: String(r.text || '').trim(), provider: name });
    lastStatus = r.status || 0;
    lastFault = upstreamFault(lastStatus);
    // Out of credit or a bad key will not fix itself by asking again, but the
    // OTHER provider might be fine — so keep going, and report the last fault
    // only if nothing worked.
  }

  // Never echo the upstream body — it can carry request details.
  return json({ error: lastFault?.message || 'Dictation failed.',
                kind: lastFault?.kind || 'refused',
                status: lastStatus }, 502);
});
