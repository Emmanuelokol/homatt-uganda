// Copy this to config.js and fill in your Supabase project values.
// SUPABASE_URL and SUPABASE_ANON_KEY are public — safe to include in the browser.
// API_PROXY_URL points to your Edge Function which holds the AI API keys server-side.

window.HOMATT_CONFIG = {
  SUPABASE_URL: 'https://<your-project-ref>.supabase.co',
  SUPABASE_ANON_KEY: '<your-supabase-anon-key>',
  API_PROXY_URL: 'https://<your-project-ref>.supabase.co/functions/v1/ai-proxy',
};
