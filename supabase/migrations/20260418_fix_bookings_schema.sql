-- ============================================================
-- Fix bookings table: add all columns the app relies on.
-- Creates clinic_check_in_pins for patient PIN check-in.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- 1. Add every missing column to bookings
--    (patient_user_id first so the RLS policy below can reference it)
alter table bookings
  add column if not exists patient_user_id   uuid references auth.users(id),
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

-- 4. Fix bookings RLS — clinic staff can read/update all bookings
drop policy if exists "Patients can insert bookings" on bookings;
create policy "Patients can insert bookings"
  on bookings for insert
  with check (true);

drop policy if exists "Clinics can read/update their bookings" on bookings;
create policy "Clinics can read/update their bookings"
  on bookings for all
  using (true)
  with check (true);

-- Note: "Patients can read own bookings" policy is intentionally omitted here
-- because patient_user_id may not be populated in older bookings.
-- Patients access their bookings via localStorage (booking code + PIN).

-- ============================================================
-- Change symptoms from text[] to jsonb so both the currently
-- deployed app (which sends plain strings) and future code
-- (which sends arrays) both insert successfully.
-- to_jsonb() converts existing {array,data} → ["array","data"]
-- ============================================================
ALTER TABLE bookings
  ALTER COLUMN symptoms TYPE jsonb
  USING to_jsonb(symptoms);
