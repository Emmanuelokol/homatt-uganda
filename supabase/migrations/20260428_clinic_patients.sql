-- ════════════════════════════════════════════════════════════════════
-- Clinic Patients — patients registered at a clinic before they have
-- a Homatt account. Persists the stub patient record so the clinic
-- (and its aligned personnel via portal_users) can search, follow up,
-- and re-order without having to re-enter the patient each time.
-- ────────────────────────────────────────────────────────────────────
-- Relationship:
--   clinic_patients.clinic_id  →  clinics.id
--   clinic_patients.profile_id →  auth.users.id   (filled when they join Homatt)
--   clinic_patients.registered_by → auth.users.id (the clinic staff who created them)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.clinic_patients (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  full_name     text not null,
  phone         text not null,
  profile_id    uuid references auth.users(id),    -- filled when patient joins Homatt
  registered_by uuid references auth.users(id),    -- clinic staff who created the record
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint clinic_patients_clinic_phone_unique unique (clinic_id, phone)
);

alter table public.clinic_patients enable row level security;

-- Staff can manage patients of THEIR clinic only
drop policy if exists "clinic_patients_staff_manage" on public.clinic_patients;
create policy "clinic_patients_staff_manage" on public.clinic_patients
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.role = 'clinic_staff'
        and pu.clinic_id = clinic_patients.clinic_id
        and pu.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.role = 'clinic_staff'
        and pu.clinic_id = clinic_patients.clinic_id
        and pu.is_active = true
    )
  );

-- Patients can read their own linked record (after they join Homatt)
drop policy if exists "clinic_patients_self_read" on public.clinic_patients;
create policy "clinic_patients_self_read" on public.clinic_patients
  for select using (auth.uid() = profile_id);

-- Admins do anything
drop policy if exists "clinic_patients_admin_all" on public.clinic_patients;
create policy "clinic_patients_admin_all" on public.clinic_patients
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create index if not exists idx_clinic_patients_clinic   on public.clinic_patients (clinic_id);
create index if not exists idx_clinic_patients_phone    on public.clinic_patients (phone);
create index if not exists idx_clinic_patients_profile  on public.clinic_patients (profile_id) where profile_id is not null;

-- ── Add clinic_patient_id reference on clinic_orders ────────────
-- Lets us link an order to a stub patient record so future orders
-- for the same person are grouped together.
alter table public.clinic_orders
  add column if not exists clinic_patient_id uuid references public.clinic_patients(id);

create index if not exists idx_clinic_orders_clinic_patient
  on public.clinic_orders (clinic_patient_id) where clinic_patient_id is not null;

comment on table public.clinic_patients is 'Patients registered at a clinic; linked to clinics.id and via portal_users to clinic staff.';
