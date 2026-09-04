/**
 * Homatt Health — Transcribe (Supabase Edge Function)
 *
 * Turns a short clip of a clinician speaking into text, using OpenAI Whisper.
 * The API key is a Supabase secret and never reaches the phone — the same
 * arrangement as ai-proxy and send-notification.
 *
 *   POST /functions/v1/transcribe
 *   Body: multipart/form-data with `audio` (a recorded clip)
 *   Reply: { "text": "temp 38.5 BP 120 over 80 pulse 96" }
 *
 * Secret required:
 *   OPENAI_API_KEY   — already used by ai-proxy
 *
 * WHAT THIS IS AND IS NOT FOR
 * ---------------------------
 * It transcribes the VITALS a clinician reads off a thermometer and a cuff.
 * The reply is text; the app parses the numbers out of it and shows them in
 * the boxes for the clinician to check. Nothing here writes to a record, sets
 * a diagnosis, or names a medicine.
 *
 * Two things are deliberately bounded, because this costs money per minute and
 * sends patient audio off the premises:
 *   • MAX_BYTES caps a clip at roughly a minute. A stuck microphone cannot run
 *     up a bill or upload a whole consultation.
 *   • The caller must be signed in. Supabase verifies the JWT before this code
 *     runs, so an unauthenticated request never reaches OpenAI.
 */

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

// About a minute of the compressed audio a phone records. Long enough to read
// four vitals aloud twice over; short enough that a forgotten recording is a
// fraction of a cent rather than an afternoon.
const MAX_BYTES = 2 * 1024 * 1024;

// Whisper accepts a prompt to bias what it expects to hear. Feeding it the
// vocabulary of a vitals reading measurably improves the numbers and the
// units, which is the whole point — the app throws away anything it cannot
// recognise as a labelled reading, so a better transcript is a better fill.
const VITALS_HINT =
  'Clinical vitals dictated by a nurse in a Ugandan clinic. ' +
  'Temperature in degrees Celsius, blood pressure in mmHg systolic over ' +
  'diastolic, pulse in beats per minute, weight in kilograms. ' +
  'For example: temperature 38.5, BP 120 over 80, pulse 96, weight 62.';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Only POST requests are supported.' }, 405);
  }

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) {
    // Said plainly, because the clinic-side symptom is a dictate button that
    // does nothing, and the cause is a secret nobody set.
    return json({ error: 'Dictation is not configured on this server ' +
                         '(OPENAI_API_KEY is not set).' }, 503);
  }

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('audio');
    if (f instanceof File) audio = f;
  } catch {
    return json({ error: 'Send the clip as multipart/form-data in `audio`.' }, 400);
  }
  if (!audio) return json({ error: 'No audio was sent.' }, 400);
  if (audio.size === 0) return json({ error: 'The recording was empty.' }, 400);
  if (audio.size > MAX_BYTES) {
    return json({ error: 'That recording is too long. Say the readings in ' +
                         'one short sentence and try again.' }, 413);
  }

  const out = new FormData();
  out.append('file', audio, audio.name || 'vitals.webm');
  out.append('model', 'whisper-1');
  out.append('language', 'en');
  out.append('prompt', VITALS_HINT);
  // Plain text back: the app does its own parsing and has no use for word
  // timings or confidence scores.
  out.append('response_format', 'text');

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
  } catch (e) {
    return json({ error: 'Could not reach the transcription service.',
                  detail: String(e) }, 502);
  }

  const text = await res.text();
  if (!res.ok) {
    // Never echo the upstream body wholesale — it can carry request details.
    return json({ error: 'The transcription service refused the recording.',
                  status: res.status }, 502);
  }

  return json({ text: text.trim() });
});
