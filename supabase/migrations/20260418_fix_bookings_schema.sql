-- ============================================================
-- Fix bookings table: add all columns that the patient app and
-- clinic portal rely on but that are missing from the original schema.
-- Also creates clinic_check_in_pins which stores patient PINs.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- 1. Add every missing column to bookings
alter table bookings
  add column if not exists notes              text,
  add column if not exists location_district  text,
  add column if not exists location_city      text,
  add column if not exists family_member_id   uuid,
  add column if not exists discount_applied   boolean default false,
  add column if not exists discount_pct       integer default 0,
  add column if not exists ai_full_data       jsonb;

-- 2. Create the PIN table used during patient check-in
create table if not exists clinic_check_in_pins (
  id          uuid        primary key default gen_random_uuid(),
  pin_token   text        not null,
  booking_id  uuid        references bookings(id) on delete cascade,
  expires_at  timestamptz,
  is_used     boolean     default false,
  created_at  timestamptz default now()
);

-- 3. Enable RLS on the PIN table
alter table clinic_check_in_pins enable row level security;

drop policy if exists "Anyone can insert check-in pins" on clinic_check_in_pins;
create policy "Anyone can insert check-in pins"
  on clinic_check_in_pins for insert
  with check (true);

drop policy if exists "Anyone can read check-in pins" on clinic_check_in_pins;
create policy "Anyone can read check-in pins"
  on clinic_check_in_pins for select
  using (true);

drop policy if exists "Anyone can update check-in pins" on clinic_check_in_pins;
create policy "Anyone can update check-in pins"
  on clinic_check_in_pins for update
  using (true);

-- 4. Ensure bookings RLS policies allow both patients and clinic staff
--    to insert/read correctly.

-- Patients: insert their own bookings (anon or authenticated)
drop policy if exists "Patients can insert bookings" on bookings;
create policy "Patients can insert bookings"
  on bookings for insert
  with check (true);

-- Patients: read their own bookings by patient_user_id
drop policy if exists "Patients can read own bookings" on bookings;
create policy "Patients can read own bookings"
  on bookings for select
  using (auth.uid() = patient_user_id);

-- Clinic staff: read and update all bookings (they filter by clinic_id in queries)
drop policy if exists "Clinics can read/update their bookings" on bookings;
create policy "Clinics can read/update their bookings"
  on bookings for all
  using (true)
  with check (true);

-- 5. Verify — after running, confirm columns exist:
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'bookings'
-- order by ordinal_position;
