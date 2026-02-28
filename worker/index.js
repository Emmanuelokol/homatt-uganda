/**
 * Homatt Health - AI Proxy Worker
 * Deployed on Cloudflare Workers (free tier).
 *
 * This Worker holds all API keys as environment variables.
 * The Android app never sees the keys — it only calls this URL.
 *
 * Environment variables to set in Cloudflare dashboard:
 *   GROQ_API_KEY
 *   OPENAI_API_KEY
 *   GEMINI_API_KEY
 *
 * Request format (POST /):
 *   { "provider": "groq" | "openai" | "gemini", "prompt": "..." }
 *
 * Response format:
 *   { "text": "..." }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight (required for Android WebView)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Only POST requests are supported.' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const { provider, prompt } = body;

    if (!prompt) {
      return json({ error: 'Missing prompt.' }, 400);
    }

    try {
      let text;

      if (provider === 'groq') {
        text = await callGroq(prompt, env.GROQ_API_KEY);
      } else if (provider === 'openai') {
        text = await callOpenAI(prompt, env.OPENAI_API_KEY);
      } else if (provider === 'gemini') {
        text = await callGemini(prompt, env.GEMINI_API_KEY);
      } else {
        return json({ error: 'Unknown provider. Use groq, openai, or gemini.' }, 400);
      }

      return json({ text });

    } catch (err) {
      return json({ error: err.message }, 502);
    }
  },
};

// ---- Groq ----
async function callGroq(prompt, apiKey) {
  if (!apiKey) throw new Error('GROQ_API_KEY not configured in Worker.');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a medical health assistant for a mobile health app in Uganda called Homatt Health. Always respond with valid JSON only, no markdown or explanation.',
        },
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
  return data.choices?.[0]?.message?.content || '';
}

// ---- OpenAI ----
async function callOpenAI(prompt, apiKey) {
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured in Worker.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a medical health assistant for a mobile health app in Uganda called Homatt Health. Always respond with valid JSON only, no markdown or explanation.',
        },
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
  return data.choices?.[0]?.message?.content || '';
}

// ---- Gemini ----
async function callGemini(prompt, apiKey) {
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured in Worker.');

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) return text;
    }
  }

  throw new Error('All Gemini models failed.');
}

// ---- Helper ----
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
