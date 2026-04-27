// Homatt Health — runtime config
// All AI calls go through the Supabase Edge Function proxy.
// SUPABASE_ANON_KEY is a publishable key — safe to commit.
// ONESIGNAL_APP_ID is injected by CI; push notifications degrade gracefully without it.
window.HOMATT_CONFIG = {
  API_PROXY_URL:     'https://kgkdiykzmqjougwzzewi.supabase.co/functions/v1/ai-proxy',
  SUPABASE_URL:      'https://kgkdiykzmqjougwzzewi.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8',
  ONESIGNAL_APP_ID:  '',
};
