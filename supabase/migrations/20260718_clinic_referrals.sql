-- ============================================================
-- Homatt Health — patient referrals between partner clinics
--
-- A clinician refers a patient to another Homatt clinic in seconds:
-- pick the clinic, pick a reason (e.g. needed medicine out of stock),
-- done. The receiving clinic's staff get a push notification instantly
-- and the referral appears for both clinics. Offline-safe: the client
-- generates the id and the outbox replays the insert idempotently.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create table if not exists public.clinic_referrals (
  id             uuid primary key default gen_random_uuid(),
  from_clinic_id uuid not null references public.clinics(id) on delete cascade,
  to_clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_name   text not null,
  patient_phone  text,
  reason         text,                -- e.g. 'Medicine out of stock'
  needed_item    text,                -- the drug/test we couldn't provide
  notes          text,
  referral_code  text,                -- short human code, e.g. RF-4G7K
  status         text not null default 'pending'
                 check (status in ('pending','received','seen','cancelled')),
  created_at     timestamptz default now()
);

create index if not exists idx_clinic_referrals_to   on public.clinic_referrals (to_clinic_id, created_at desc);
create index if not exists idx_clinic_referrals_from on public.clinic_referrals (from_clinic_id, created_at desc);

alter table public.clinic_referrals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'clinic_referrals' and policyname = 'referral_clinics_rw') then
    create policy referral_clinics_rw on public.clinic_referrals
      for all using (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
        or to_clinic_id in (select pu.clinic_id from public.portal_users pu
                             where pu.auth_user_id = auth.uid() and pu.is_active = true)
      ) with check (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;
end $$;

-- Push the receiving clinic's staff a notification the moment a referral lands
create or replace function public.notify_clinic_referral()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players jsonb;
  v_from    text;
begin
  select name into v_from from clinics where id = new.from_clinic_id;

  select jsonb_agg(pu.onesignal_player_id) into v_players
    from portal_users pu
   where pu.clinic_id = new.to_clinic_id
     and pu.is_active = true
     and pu.onesignal_player_id is not null;

  if v_players is not null and jsonb_array_length(v_players) > 0 then
    begin
      perform notify_call(jsonb_build_object(
        'player_ids', v_players,
        'heading',    '🤝 Patient referred to you',
        'message',    coalesce(new.patient_name, 'A patient') || ' referred by ' || coalesce(v_from, 'a partner clinic')
                      || case when new.reason is not null then ' — ' || new.reason else '' end
                      || case when new.referral_code is not null then '. Code: ' || new.referral_code else '' end,
        'data',       jsonb_build_object('screen', 'dashboard')
      ));
    exception when others then null;  -- a push failure must never block the referral
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_clinic_referral on public.clinic_referrals;
create trigger trg_notify_clinic_referral
  after insert on public.clinic_referrals
  for each row execute function public.notify_clinic_referral();

select 'clinic referrals ready' as result;
