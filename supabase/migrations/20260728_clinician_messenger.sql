-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — clinician-to-clinician messenger
--
-- 1-to-1 chat between clinic staff, WITHIN a clinic or ACROSS partner
-- clinics. Text + photo + voice note. Realtime delivery + push
-- notification to the recipient. Offline-safe on the client (text
-- queues; media needs a connection to upload).
--
-- Idempotent — safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Messages table ───────────────────────────────────────────────
create table if not exists public.clinic_messages (
  id             uuid primary key default gen_random_uuid(),
  from_user      uuid not null,            -- sender auth.uid()
  from_name      text,                     -- denormalized so inbox needs no join
  from_clinic_id uuid,
  to_user        uuid not null,            -- recipient auth.uid()
  to_clinic_id   uuid,
  body           text,                     -- message text (null for media-only)
  media_url      text,                     -- photo / voice-note URL
  media_type     text check (media_type in ('image','audio') or media_type is null),
  duration_ms    integer,                  -- voice-note length
  created_at     timestamptz default now(),
  read_at        timestamptz
);

create index if not exists idx_clinic_messages_pair
  on public.clinic_messages (from_user, to_user, created_at desc);
create index if not exists idx_clinic_messages_to
  on public.clinic_messages (to_user, created_at desc);

alter table public.clinic_messages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='clinic_messages' and policyname='msg_participants_select') then
    create policy msg_participants_select on public.clinic_messages
      for select using (from_user = auth.uid() or to_user = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='clinic_messages' and policyname='msg_sender_insert') then
    create policy msg_sender_insert on public.clinic_messages
      for insert with check (from_user = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='clinic_messages' and policyname='msg_recipient_update') then
    -- recipient may mark messages read
    create policy msg_recipient_update on public.clinic_messages
      for update using (to_user = auth.uid());
  end if;
end $$;

-- ── 2. Directory of clinicians you can message ──────────────────────
-- Active clinic staff across ALL clinics (excluding yourself), grouped by
-- whether they're in your own clinic or a partner clinic.
create or replace function public.list_message_contacts()
returns table (
  user_id       uuid,
  full_name     text,
  staff_role    text,
  clinic_id     uuid,
  clinic_name   text,
  is_own_clinic boolean
)
language sql
security definer
set search_path = public
as $$
  with me as (
    select clinic_id from portal_users
     where auth_user_id = auth.uid() and is_active = true
     limit 1
  )
  select pu.auth_user_id, pu.full_name, coalesce(pu.staff_role,'owner'),
         pu.clinic_id, c.name,
         (pu.clinic_id = (select clinic_id from me))
    from portal_users pu
    join clinics c on c.id = pu.clinic_id
   where pu.role = 'clinic_staff'
     and pu.is_active = true
     and pu.auth_user_id is not null
     and pu.auth_user_id <> auth.uid()
   order by (pu.clinic_id = (select clinic_id from me)) desc, c.name, pu.full_name;
$$;
grant execute on function public.list_message_contacts() to authenticated;

-- ── 3. Your conversations (inbox) — one row per chat partner ────────
create or replace function public.message_threads()
returns table (
  other_user   uuid,
  other_name   text,
  other_clinic text,
  last_body    text,
  last_media   text,
  last_at      timestamptz,
  last_from_me boolean,
  unread       integer
)
language sql
security definer
set search_path = public
as $$
  with mine as (
    select *,
           case when from_user = auth.uid() then to_user else from_user end as partner
      from clinic_messages
     where from_user = auth.uid() or to_user = auth.uid()
  ),
  ranked as (
    select *, row_number() over (partition by partner order by created_at desc) rn
      from mine
  )
  select r.partner,
         coalesce(pu.full_name,
                  (select from_name from mine m2 where m2.partner = r.partner and m2.from_user = r.partner order by created_at desc limit 1),
                  'Clinician'),
         c.name,
         r.body,
         r.media_type,
         r.created_at,
         (r.from_user = auth.uid()),
         (select count(*)::int from mine u where u.partner = r.partner and u.to_user = auth.uid() and u.read_at is null)
    from ranked r
    left join portal_users pu on pu.auth_user_id = r.partner and pu.is_active = true
    left join clinics c on c.id = pu.clinic_id
   where r.rn = 1
   order by r.created_at desc;
$$;
grant execute on function public.message_threads() to authenticated;

-- ── 4. Mark a conversation read ─────────────────────────────────────
create or replace function public.mark_messages_read(p_other_user uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with upd as (
    update clinic_messages
       set read_at = now()
     where to_user = auth.uid() and from_user = p_other_user and read_at is null
     returning 1
  )
  select count(*)::int from upd;
$$;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- ── 5. Realtime: deliver new messages live ──────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clinic_messages'
  ) then
    alter publication supabase_realtime add table public.clinic_messages;
  end if;
exception when others then null;
end $$;

-- ── 6. Push notify the recipient on every new message ───────────────
create or replace function public.notify_clinic_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player text;
  v_preview text;
begin
  select onesignal_player_id into v_player
    from portal_users
   where auth_user_id = new.to_user and is_active = true
     and onesignal_player_id is not null
   limit 1;

  if v_player is null then return new; end if;

  v_preview := case
    when new.media_type = 'image' then '📷 Photo'
    when new.media_type = 'audio' then '🎤 Voice note'
    else left(coalesce(new.body, 'New message'), 120)
  end;

  begin
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(v_player),
      'heading',    coalesce(new.from_name, 'New message'),
      'message',    v_preview,
      'data',       jsonb_build_object('screen', 'messages', 'from', new.from_user)
    ));
  exception when others then null;   -- a push failure must never block the send
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_clinic_message on public.clinic_messages;
create trigger trg_notify_clinic_message
  after insert on public.clinic_messages
  for each row execute function public.notify_clinic_message();

-- ── 7. Storage bucket for chat media (photos + voice notes) ─────────
insert into storage.buckets (id, name, public)
values ('clinic-chat', 'clinic-chat', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='clinic-chat read') then
    create policy "clinic-chat read" on storage.objects for select using (bucket_id = 'clinic-chat');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='clinic-chat insert') then
    create policy "clinic-chat insert" on storage.objects for insert to authenticated with check (bucket_id = 'clinic-chat');
  end if;
end $$;

select 'clinician messenger ready' as result;
