-- ════════════════════════════════════════════════════════════════════
-- Fix: pg_cron push notifications not being sent
-- ────────────────────────────────────────────────────────────────────
-- Root cause: notify_call() reads app.supabase_url and app.service_role_key
-- from database settings. If these were never set, the function silently
-- exits without calling send-notification, so no push notifications fire.
--
-- This migration:
--   1. Updates notify_call() to hardcode the known project URL as fallback
--   2. Adds a diagnostic view so you can see if the key is configured
--
-- REQUIRED MANUAL STEP (run once in Supabase SQL Editor):
--   alter database postgres set app.service_role_key = '<YOUR_SERVICE_ROLE_KEY>';
--
-- Find your service role key at:
--   Supabase Dashboard → Project Settings → API → service_role (secret)
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Hardcode project URL as fallback ──────────────────────────
-- The URL is public; only the service_role_key needs manual setup.
alter database postgres
  set app.supabase_url = 'https://kgkdiykzmqjougwzzewi.supabase.co';

-- ── 2. Rewrite notify_call with better error surfacing ────────────
create or replace function notify_call(payload jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_url  text;
  v_key  text;
  v_resp bigint;
begin
  -- Use database setting if present, fall back to the known project URL.
  v_url := coalesce(
    nullif(current_setting('app.supabase_url', true), ''),
    'https://kgkdiykzmqjougwzzewi.supabase.co'
  ) || '/functions/v1/send-notification';

  v_key := nullif(current_setting('app.service_role_key', true), '');

  if v_key is null then
    raise warning '[notify_call] app.service_role_key not set — push skipped. '
                  'Run: alter database postgres set app.service_role_key = ''<YOUR_KEY>'';';
    return;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := payload::text,
    timeout_milliseconds := 10000
  ) into v_resp;

exception when others then
  raise warning '[notify_call] HTTP error: %', sqlerrm;
end;
$$;

-- ── 3. Diagnostic query — run this to check configuration ────────
-- select
--   current_setting('app.supabase_url', true)     is not null as url_set,
--   current_setting('app.service_role_key', true) is not null as key_set;
-- Both should be TRUE. If key_set is FALSE, run the alter database command above.

-- ── 4. Confirm the function is updated ───────────────────────────
select proname, prosrc like '%service_role_key%' as has_key_check
from pg_proc
where proname = 'notify_call';
