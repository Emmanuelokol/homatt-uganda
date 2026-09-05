-- ============================================================
-- Fix: Ensure RLS + all clinic columns are correct so patient
-- app (anon key) can read active clinics.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- 1. Make sure county and parish columns exist
alter table clinics
  add column if not exists county  text,
  add column if not exists parish  text;

-- 2. Make sure quality/rating columns exist (used by scoring)
alter table clinics
  add column if not exists quality_score      numeric,
  add column if not exists cure_rate          numeric,
  add column if not exists avg_rating         numeric,
  add column if not exists avg_wait_minutes   numeric,
  add column if not exists condition_performance jsonb,
  add column if not exists verified           boolean default true;

-- 3. Enable RLS if not already enabled
alter table clinics enable row level security;

-- 4. Drop and recreate the patient read policy so it definitely exists
drop policy if exists "Patients can read active clinics" on clinics;

create policy "Patients can read active clinics"
  on clinics for select
  to anon, authenticated
  using (active = true);

-- 5. Same for clinic_condition_fees
alter table clinic_condition_fees enable row level security;

drop policy if exists "Anyone can read clinic condition fees" on clinic_condition_fees;

create policy "Anyone can read clinic condition fees"
  on clinic_condition_fees for select
  to anon, authenticated
  using (true);

-- 6. Add county and parish to profiles so user location is fully personalised
alter table profiles
  add column if not exists county text,
  add column if not exists parish text;

-- 7. Verify — run this to confirm your two clinics are visible:
-- select id, name, district, city, county, parish, active, verified
-- from clinics
-- where active = true;
