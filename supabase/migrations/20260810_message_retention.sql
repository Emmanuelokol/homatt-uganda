-- ── Messenger retention: auto-erase chat older than 60 days ────────────────
-- Keeps the messenger light: old messages and their photos/voice notes are
-- removed from the database and the clinic-chat storage bucket. Called by the
-- app (at most once per device per day) — no scheduler needed.

create or replace function public.purge_old_messages()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  n integer := 0;
begin
  -- only signed-in clinic staff may trigger the purge
  if auth.uid() is null then
    return 0;
  end if;

  delete from public.clinic_messages
   where created_at < now() - interval '60 days';
  get diagnostics n = row_count;

  -- media files (photos / voice notes) age out with their messages
  delete from storage.objects
   where bucket_id = 'clinic-chat'
     and created_at < now() - interval '60 days';

  return n;
end;
$$;

grant execute on function public.purge_old_messages() to authenticated;
