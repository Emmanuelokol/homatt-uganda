-- ════════════════════════════════════════════════════════════════════
-- Active medications RPC + discharge tracking
-- ────────────────────────────────────────────────────────────────────
-- Adds:
--   • get_patient_active_meds RPC — fetches all currently-active prescriptions
--       across the Homatt network for a given phone / user_id. Used by the
--       clinic portal patient profile card to show drug interactions.
--   • clinic_diagnoses.discharged_at / discharged_by / discharge_notes
--   • treatment_outcomes table — recovery feedback collected from patient
--       after discharge (via push notification → feedback card).
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Discharge columns on clinic_diagnoses ──
alter table public.clinic_diagnoses
  add column if not exists discharged_at   timestamptz,
  add column if not exists discharged_by   uuid references auth.users(id),
  add column if not exists discharge_notes text;

comment on column public.clinic_diagnoses.discharged_at is
  'When the clinician marked the treatment as complete. Cases with discharged_at IS NULL stay on the active dashboard.';

create index if not exists idx_clinic_diagnoses_active
  on public.clinic_diagnoses (clinic_id, discharged_at)
  where discharged_at is null;

-- ── 2. Treatment outcomes — patient's recovery feedback ──
create table if not exists public.treatment_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  diagnosis_id       uuid references public.clinic_diagnoses(id) on delete cascade,
  booking_id         uuid references public.bookings(id),
  patient_user_id    uuid references auth.users(id),
  patient_phone      text,
  clinic_id          uuid references public.clinics(id),
  recovery_status    text check (recovery_status in ('much_worse','worse','same','better','much_better')),
  comment            text,
  followup_needed    boolean default false,
  created_at         timestamptz default now()
);

alter table public.treatment_outcomes enable row level security;

drop policy if exists "treatment_outcomes_insert"   on public.treatment_outcomes;
create policy "treatment_outcomes_insert" on public.treatment_outcomes
  for insert with check (true);

drop policy if exists "treatment_outcomes_select_own" on public.treatment_outcomes;
create policy "treatment_outcomes_select_own" on public.treatment_outcomes
  for select using (
    auth.uid() = patient_user_id
    or exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = treatment_outcomes.clinic_id
    )
  );

create index if not exists idx_treatment_outcomes_diagnosis
  on public.treatment_outcomes (diagnosis_id);
create index if not exists idx_treatment_outcomes_clinic
  on public.treatment_outcomes (clinic_id, created_at desc);

comment on table public.treatment_outcomes is
  'Recovery feedback submitted by the patient after a clinic visit is discharged. Drives the follow-up loop.';

-- ── 3. RPC: get_patient_active_meds ──
-- Returns all currently-active prescriptions for a patient, regardless of
-- which clinic prescribed them. Used by the patient profile card to warn
-- the clinician about drug interactions before they prescribe anything new.
create or replace function public.get_patient_active_meds(
  p_phone   text default null,
  p_user_id uuid default null
)
returns table (
  prescription_id     uuid,
  clinic_id           uuid,
  clinic_name         text,
  diagnosis_id        uuid,
  confirmed_diagnosis text,
  items               jsonb,
  start_date          date,
  end_date            date,
  picked_up_at        timestamptz,
  picked_up_at_clinic_id uuid,
  created_at          timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    ep.id,
    ep.clinic_id,
    c.name,
    cd.id,
    cd.confirmed_diagnosis,
    ep.items,
    ep.start_date,
    ep.end_date,
    ep.picked_up_at,
    ep.picked_up_at_clinic_id,
    ep.created_at
  from public.e_prescriptions ep
  left join public.clinics c             on c.id  = ep.clinic_id
  left join public.clinic_diagnoses cd   on cd.id = ep.diagnosis_id
  where ep.status = 'active'
    and (ep.end_date is null or ep.end_date >= current_date)
    and (
         (p_user_id is not null and ep.patient_id = p_user_id)
      or (p_phone   is not null and (
            cd.patient_phone = p_phone
         or ep.booking_id in (select b.id from public.bookings b where b.patient_user_id in
              (select id from public.profiles where phone_number = p_phone))
      ))
    )
  order by ep.created_at desc
  limit 15;
$$;

grant execute on function public.get_patient_active_meds(text, uuid) to authenticated;

comment on function public.get_patient_active_meds is
  'Returns all active prescriptions across the network for the given patient (by phone or user_id). Used for drug-interaction safety check in the clinic portal.';

-- ── 4. RPC: discharge_patient ──
-- Marks a diagnosis as discharged and (optionally) the underlying booking
-- as completed. Idempotent.
create or replace function public.discharge_patient(
  p_diagnosis_id uuid,
  p_notes        text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  update public.clinic_diagnoses
     set discharged_at   = now(),
         discharged_by   = auth.uid(),
         discharge_notes = coalesce(p_notes, discharge_notes)
   where id = p_diagnosis_id
     and discharged_at is null
   returning booking_id into v_booking_id;

  if v_booking_id is not null then
    update public.bookings
       set status = 'completed'
     where id = v_booking_id
       and status in ('attended','in_progress','confirmed');
  end if;

  return true;
end;
$$;

grant execute on function public.discharge_patient(uuid, text) to authenticated;
