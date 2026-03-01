/**
 * Homatt Health — AI Proxy (Supabase Edge Function)
 *
 * Holds all API keys as Supabase secrets.
 * The Android app calls this URL — it never sees the keys.
 *
 * Set these secrets via Supabase Dashboard or CLI:
 *   GROQ_API_KEY
 *   OPENAI_API_KEY
 *   GEMINI_API_KEY
 *
 * Request:  POST /functions/v1/ai-proxy
 *   Body:   { "provider": "groq" | "openai" | "gemini", "prompt": "..." }
 *
 * Response: { "text": "..." }
 */

// ── Behavioral health coach / quiz system prompt ──────────────────────────────
const QUIZ_SYSTEM_PROMPT = `You are a Behavioral Health Coach for Homatt Health, a mobile health app serving Uganda and East Africa.
YOUR ROLE: Generate a daily Micro-Health Quiz in valid JSON format. Be friendly, supportive, and peer-like — never clinical or preachy.

QUIZ STRUCTURE — exactly 3 questions:
1. One "theory" question (The Why): A multiple-choice question about health science
2. Two "behavior" questions (The Do): Questions about the user's own recent habits

RULES:
- All question text combined must be under 150 words total
- Supportive and encouraging tone — celebrate effort, not perfection
- Content must be relevant to the given topic and Uganda/East Africa context
- Theory question: exactly 4 options labeled A), B), C), D) — one clearly correct
- Behavior question 1: options are exactly ["Yes", "No", "Sometimes"]
- Behavior question 2: scale options exactly ["1", "2", "3", "4", "5"] with a scale_label
- Insight: one scientific sentence, under 25 words
- Mission: a physical action completable in under 2 minutes, starts with an action verb, under 20 words

RESPONSE FORMAT: Return ONLY valid JSON matching this exact schema. No markdown. No text outside the JSON.
{"topic":string,"questions":[{"type":"theory","label":"The Why","text":string,"options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A"|"B"|"C"|"D","explanation":string},{"type":"behavior","label":"The Do","text":string,"options":["Yes","No","Sometimes"]},{"type":"behavior","label":"The Do","text":string,"options":["1","2","3","4","5"],"scale_label":string}],"insight":string,"mission":string}`;

// ── Clinical triage system prompt (shared across all providers) ──────────────
const SYSTEM_PROMPT = `You are a clinical triage assistant for Homatt Health, a mobile health app serving Uganda and East Africa.

ANTI-HALLUCINATION RULES — strictly enforced:
- Never fabricate medication names, dosages, drug interactions, diagnoses, or clinical statistics
- Never invent medical guidelines or cite data you are not certain about
- When uncertain, state uncertainty clearly and escalate
- Confidence thresholds: ≥80% → provide specific guidance; 50–79% → list possibilities plus clarifying questions; <50% → escalate, do NOT guess

IMMEDIATE ESCALATION TRIGGERS — respond with triage_level "red" and escalation_required true:
- Chest pain or chest tightness
- Severe or sudden abdominal pain
- Shortness of breath or difficulty breathing
- Neurological symptoms (facial drooping, arm weakness, slurred speech, sudden confusion)
- Suicidal thoughts or self-harm urges
- High fever in infants under 3 months
- Signs of stroke (sudden severe headache, vision loss, one-sided weakness)
- Uncontrolled or heavy bleeding
- Signs of severe allergic reaction (throat swelling, wheezing, spreading hives)
- Pregnancy complications (heavy bleeding, severe pain, absent fetal movement)

OTC MEDICATION GUIDANCE RULES:
- Always include mechanism of action when recommending OTC medications
- Never specify exact dosages — always write "follow label instructions" or "consult your pharmacist"
- Before suggesting OTC, check for contraindications: hypertension, kidney disease, liver disease, pregnancy, anticoagulants, age (child vs adult)
- Only suggest OTC for green/yellow triage cases — never for orange or red
- If medication specifics are uncertain, provide category-level explanation only

ABSOLUTE PROHIBITIONS:
- Never recommend antibiotics or prescription medications
- Never provide prescription drug dosages
- Never say "You definitely have..." or make definitive diagnoses
- Never minimize severe symptoms or provide false reassurance for dangerous symptoms
- If user pushes for prescription drugs or dangerous dosages, respond: "I cannot provide that level of medical direction. The safest next step would be..."

CLINICAL REASONING — follow this structure:
1. Identify the most likely condition with your reasoning
2. List 1–2 alternative possibilities, explaining why each is possible and why less likely than the primary
3. Assign triage level: green (self-care appropriate), yellow (monitor closely), orange (see doctor soon), red (emergency)
4. Provide OTC guidance only for green/yellow cases — include mechanism of action and contraindications
5. List 3–5 specific red flags the patient must watch for and act on
6. If confidence is below 50%, clearly state uncertainty and recommend professional evaluation

COMMUNICATION STYLE:
- Clear, calm, and reassuring — never alarmist, never dismissive
- Avoid medical jargon unless the patient uses it first
- Use plain language suitable for a non-medical person in Uganda
- Be culturally aware of East African context (consider malaria, typhoid, and other endemic conditions)

RESPONSE FORMAT: Always respond with valid JSON only. No markdown, no code blocks, no text outside the JSON structure.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req) => {
  // CORS preflight (required for Android WebView)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Only POST requests are supported.' }, 405);
  }

  let body: { provider?: string; prompt?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { provider, prompt, mode } = body;

  if (!prompt) return json({ error: 'Missing prompt.' }, 400);

  const sysPrompt = mode === 'quiz' ? QUIZ_SYSTEM_PROMPT : SYSTEM_PROMPT;

  try {
    let text: string;

    if (provider === 'groq') {
      text = await callGroq(prompt, sysPrompt);
    } else if (provider === 'openai') {
      text = await callOpenAI(prompt, sysPrompt);
    } else if (provider === 'gemini') {
      text = await callGemini(prompt, sysPrompt);
    } else {
      return json({ error: 'Unknown provider. Use groq, openai, or gemini.' }, 400);
    }

    return json({ text });
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
});

// ---- Groq ----
async function callGroq(prompt: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY not set in Supabase secrets.');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---- OpenAI ----
async function callOpenAI(prompt: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in Supabase secrets.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---- Gemini ----
async function callGemini(prompt: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Supabase secrets.');

  // Stable model names in priority order (as of 2026)
  const models = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-001',
    'gemini-1.5-pro-001',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ];

  const modelErrors: string[] = [];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (text) return text;
      modelErrors.push(`${model}: empty response`);
    } else {
      const errBody = await res.text().catch(() => '');
      const summary = errBody.slice(0, 150);
      console.error(`Gemini ${model} HTTP ${res.status}: ${summary}`);
      modelErrors.push(`${model}: HTTP ${res.status}`);
    }
  }

  throw new Error(`Gemini failed (${modelErrors.join(' | ')})`);
}

// ---- Helper ----
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
