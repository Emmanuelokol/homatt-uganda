-- ── Realtime delivery for the clinician messenger ──────────────────────────
-- Ensures clinic_messages is in the supabase_realtime publication so INSERTs
-- stream to subscribed clients instantly. Idempotent: safe to run again even
-- if 20260728_clinician_messenger.sql already added it.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clinic_messages'
  ) then
    alter publication supabase_realtime add table public.clinic_messages;
  end if;
end $$;

-- Full row images in the WAL so realtime payloads always carry every column.
alter table public.clinic_messages replica identity full;
