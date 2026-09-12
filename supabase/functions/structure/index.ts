/**
 * Homatt Health — Structure (Supabase Edge Function)
 *
 * Takes the transcript of a clinician dictating a consultation and returns the
 * parts of it, so the intake boxes can fill themselves in.
 *
 *   POST /functions/v1/structure
 *   Body:  { "transcript": "her name is Jackline Marcy, a 32 year old …" }
 *   Reply: { "fields": { name, sex, age, ageUnit, complaint, history,
 *                        background }, "model": "anthropic" }
 *
 * Uses whichever key the project already has, in this order:
 *   ANTHROPIC_API_KEY → OPENAI_API_KEY → GROQ_API_KEY → GEMINI_API_KEY
 * These are the same secrets ai-proxy uses. Nothing new to set.
 *
 * ─── WHAT THIS IS ALLOWED TO DO, AND WHAT IT IS NOT ────────────────────────
 *
 * It extracts STRUCTURE. It may say "the name is Jackline Marcy, female, 32,
 * complaining of fever and headache". It may NOT say what is wrong with her.
 *
 * That is not a matter of prompt wording — the prompt asks for it, but a model
 * that ignores the prompt must still not be able to do harm, so the reply is
 * filtered here on the server against a whitelist. A diagnosis, a medicine, a
 * severity, a test, a fee: none of those fields survive, whatever the model
 * returns.
 *
 * NUMBERS ARE NOT ASKED FOR EITHER. The vitals are read on the phone by rules
 * that cannot hallucinate a temperature, are range-checked against what a body
 * can do, and are already measured across seventeen phrasings. Letting a
 * language model anywhere near a temperature would trade something exact for
 * something plausible, in the one place the app writes a number a nurse acts
 * on. So `age` is the only number here, and it is bounded below.
 *
 * The diagnosis stays where it is: the on-device engine reading the Uganda
 * Clinical Guidelines and the WHO pocket book, which returns up to three
 * suggestions, each with a match strength and the page it came from, and which
 * a clinician confirms. A model's guess cannot be checked against a book; that
 * engine's can.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// A dictated consultation is a sentence or two. Anything longer is a mistake
// (a stuck microphone, a pasted document) and costs money to process.
const MAX_CHARS = 4000;

const SYSTEM =
  'You split a dictated clinical note into its parts for a clinic app in ' +
  'Uganda. You return JSON only — no prose, no markdown, no code fence.';

const PROMPT = (t: string) => `A clinician has dictated a consultation. Split it into these fields and return JSON.

{
  "name":       the patient's name, or "" if not said. Ugandan names are common; do not translate or correct them.
  "sex":        "female", "male", or "" — the PATIENT's sex. If a parent or attendant is described, that is not the patient.
  "age":        a number as a string, or ""
  "ageUnit":    "years" or "months" — months only for an infant
  "complaint":  the ONE main thing they came with, a few words ("fever and headache")
  "history":    everything else the patient reports — how long, what makes it worse, what they have taken, and anything they DENY
  "background": chronic illness, medicines they are already on, family or social history, if mentioned
}

RULES
- Use only what was said. Never infer, never complete, never tidy a symptom into a diagnosis.
- Keep every denial word for word. "no chest pain" must stay "no chest pain"; dropping the "no" reverses the meaning.
- If something was not said, return "" for it. An empty field is correct and expected.
- Do NOT return a diagnosis, a disease name, a medicine, a dose, a test, a severity or a fee. Not in any field. If the clinician stated a diagnosis out loud, put it in "history" as their words, not as a conclusion.
- Do NOT return temperature, blood pressure, pulse or weight. Those are read separately.

THE DICTATION
"""
${t}
"""

JSON only:`;

// Only these ever reach the app. Everything else the model returns is dropped.
const ALLOWED = ['name', 'sex', 'age', 'ageUnit', 'complaint', 'history', 'background'];

async function callAnthropic(key: string, prompt: string) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key,
               'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1024,
      system: SYSTEM, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const j = await r.json();
  return j?.content?.[0]?.text ?? '';
}

async function callOpenAICompatible(url: string, key: string, model: string, prompt: string) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`${model} ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? '';
}

async function callGemini(key: string, prompt: string) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: SYSTEM + '\n\n' + prompt }] }],
                             generationConfig: { temperature: 0 } }) });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/** The first provider this project actually has a key for. */
function providers() {
  const out: Array<[string, () => Promise<string>]> = [];
  const prompt = (t: string) => PROMPT(t);
  const anth = Deno.env.get('ANTHROPIC_API_KEY');
  const oai = Deno.env.get('OPENAI_API_KEY');
  const groq = Deno.env.get('GROQ_API_KEY');
  const gem = Deno.env.get('GEMINI_API_KEY');
  return { anth, oai, groq, gem, out, prompt };
}

// A model asked for JSON sometimes wraps it in a fence or a sentence.
function firstJson(s: string) {
  const t = String(s || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// Every word of a suggested name must have been said. Asked to fill a form, a
// model will oblige — and a plausible Ugandan name on a consultation nobody
// named is worse than an empty box, because it reads like a record. The app
// checks this too; it is enforced in both places because only one of them is
// the server.
function saidAloud(candidate: string, transcript: string) {
  const hay = ' ' + transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ') + ' ';
  return candidate.toLowerCase().split(/\s+/).filter(Boolean)
    .every((w) => hay.includes(' ' + w + ' '));
}

function clean(raw: Record<string, unknown> | null, transcript = '') {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const k of ALLOWED) {
    let v = raw[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) v = v.filter(Boolean).join(', ');
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') continue;
    v = v.trim().replace(/\s+/g, ' ');
    if (!v || /^(n\/?a|none|null|unknown|not (?:said|stated|mentioned))$/i.test(v)) continue;
    out[k] = v.slice(0, 600);
  }
  // Bound the two fields that have a shape.
  if (out.sex && !/^(female|male)$/i.test(out.sex)) delete out.sex;
  else if (out.sex) out.sex = out.sex.toLowerCase();
  if (out.ageUnit && !/^(years|months)$/i.test(out.ageUnit)) delete out.ageUnit;
  if (out.age) {
    const n = parseFloat(out.age);
    const unit = (out.ageUnit || 'years').toLowerCase();
    const ok = isFinite(n) && n > 0 && (unit === 'months' ? n <= 36 : n <= 120);
    if (!ok) { delete out.age; delete out.ageUnit; }
    else out.age = String(n);
  }
  // A name is a name, not a sentence — and not one that was never spoken.
  if (out.name && (out.name.split(/\s+/).length > 4 || out.name.length > 60)) delete out.name;
  if (out.name && transcript && !saidAloud(out.name, transcript)) delete out.name;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Only POST is supported.' }, 405);

  let transcript = '';
  try {
    const body = await req.json();
    transcript = String(body?.transcript || '').trim();
  } catch {
    return json({ error: 'Send { "transcript": "…" } as JSON.' }, 400);
  }
  if (!transcript) return json({ error: 'No transcript was sent.' }, 400);
  if (transcript.length > MAX_CHARS) {
    return json({ error: 'That dictation is too long to split up.' }, 413);
  }

  const { anth, oai, groq, gem, prompt } = providers();
  const p = prompt(transcript);
  const tries: Array<[string, () => Promise<string>]> = [];
  if (anth) tries.push(['anthropic', () => callAnthropic(anth, p)]);
  if (oai) tries.push(['openai', () => callOpenAICompatible(
    'https://api.openai.com/v1/chat/completions', oai, 'gpt-4o-mini', p)]);
  if (groq) tries.push(['groq', () => callOpenAICompatible(
    'https://api.groq.com/openai/v1/chat/completions', groq, 'llama-3.1-8b-instant', p)]);
  if (gem) tries.push(['gemini', () => callGemini(gem, p)]);

  if (!tries.length) {
    return json({ error: 'No model key is set on this server. Set one of ' +
                         'ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY or ' +
                         'GEMINI_API_KEY in Supabase secrets.' }, 503);
  }

  const failed: string[] = [];
  for (const [name, run] of tries) {
    try {
      const fields = clean(firstJson(await run()), transcript);
      // An empty result is a real answer — the clinician said nothing we can
      // place — but it is not worth failing over to another provider for.
      return json({ fields, model: name });
    } catch (e) {
      failed.push(`${name}: ${String(e).slice(0, 60)}`);
    }
  }
  return json({ error: 'Could not reach any model.', tried: failed }, 502);
});
