-- ════════════════════════════════════════════════════════════════════
-- PATCH: Ensure discharged_at columns exist on clinic_diagnoses
-- Run this in Supabase SQL Editor if you see:
--   "column clinic_diagnoses.discharged_at does not exist"
-- Safe to re-run (all statements use IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════

alter table public.clinic_diagnoses
  add column if not exists discharged_at   timestamptz,
  add column if not exists discharged_by   uuid references auth.users(id),
  add column if not exists discharge_notes text;

create index if not exists idx_clinic_diagnoses_active
  on public.clinic_diagnoses (clinic_id, discharged_at)
  where discharged_at is null;

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

drop policy if exists "treatment_outcomes_insert"    on public.treatment_outcomes;
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

-- discharge_patient RPC (idempotent replace)
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
