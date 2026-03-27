-- ============================================================
-- Clinic Condition-Based Fees
-- Allows clinic staff to define the conditions they treat
-- and the specific consultation fee for each condition.
-- Patients see this fee on the booking page when their AI
-- diagnosis matches a condition the clinic treats.
-- ============================================================

create table if not exists clinic_condition_fees (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid references clinics(id) on delete cascade not null,
  condition_name text not null,                -- e.g. "Malaria", "Typhoid", "Diabetes"
  fee          integer not null default 0,     -- consultation fee in UGX
  notes        text,                           -- optional note (e.g. "Includes RDT test")
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table clinic_condition_fees enable row level security;

-- Anyone (patients) can read condition fees to see what clinics charge
create policy "Anyone can read clinic condition fees"
  on clinic_condition_fees for select using (true);

-- Clinic staff can manage their own clinic's condition fees
create policy "Clinic staff can manage own condition fees"
  on clinic_condition_fees for all using (true);

-- Index for fast lookup by clinic_id when loading booking page
create index if not exists idx_clinic_condition_fees_clinic_id
  on clinic_condition_fees(clinic_id);

-- Index for matching AI diagnosis condition names (case-insensitive via lower())
create index if not exists idx_clinic_condition_fees_name_lower
  on clinic_condition_fees(lower(condition_name));
