-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — SCHEMA CATCH-UP
--
-- One safe, idempotent script that ensures EVERY column, feature table
-- and view the clinic portal + admin expect actually exists. Run it on
-- any database that has fallen behind on migrations to stop the
-- recurring "column / relation does not exist" errors.
--
-- 100% safe to run repeatedly: only ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS, and CREATE OR REPLACE VIEW — it never
-- drops or alters existing data. Functions (RPCs) live in their own
-- migrations; this script covers the schema those functions read.
-- ════════════════════════════════════════════════════════════════════

-- ── clinic_diagnoses (the consultation record) ──────────────────────
alter table public.clinic_diagnoses
  add column if not exists patient_name          text,
  add column if not exists patient_phone         text,
  add column if not exists clinic_patient_id     uuid,
  add column if not exists clinician_name        text,
  add column if not exists patient_type          text default 'outpatient',
  add column if not exists ward                  text,
  add column if not exists lab_results           text,
  add column if not exists clinical_findings     text,
  add column if not exists confirmed_conditions  jsonb,
  add column if not exists treatments_given      jsonb,
  add column if not exists patient_instructions  text,
  add column if not exists delivery_preference   text default 'pickup',
  add column if not exists expected_recovery     date,
  add column if not exists intake_schedule       jsonb default '[]',
  add column if not exists follow_up_days         integer default 7,
  add column if not exists follow_up_reason      text,
  add column if not exists follow_up_at          timestamptz,
  add column if not exists consultation_fee_ugx  numeric default 0,
  add column if not exists lab_fee_ugx           numeric default 0,
  add column if not exists meds_fee_ugx          numeric default 0,
  add column if not exists total_charged_ugx     numeric default 0,
  add column if not exists amount_paid           numeric default 0,
  add column if not exists payment_status        text default 'pending',
  add column if not exists discharged_at         timestamptz,
  add column if not exists discharge_notes       text,
  add column if not exists recovery_status       text,
  add column if not exists created_at            timestamptz default now();

-- ── bookings (patient app → clinic) ─────────────────────────────────
alter table public.bookings
  add column if not exists no_show               boolean default false,
  add column if not exists no_show_at            timestamptz,
  add column if not exists no_show_notes         text,
  add column if not exists preferred_time        text,
  add column if not exists attended_at           timestamptz,
  add column if not exists clinic_diagnosis_id   uuid;

-- ── clinics ─────────────────────────────────────────────────────────
alter table public.clinics
  add column if not exists district              text,
  add column if not exists county                text,
  add column if not exists city                  text,
  add column if not exists parish                text,
  add column if not exists address               text,
  add column if not exists contact_person        text,
  add column if not exists license_number        text,
  add column if not exists whatsapp              text,
  add column if not exists description           text,
  add column if not exists consultation_fee      numeric,
  add column if not exists commission_rate       numeric default 15,
  add column if not exists specialties           text[],
  add column if not exists facilities            text[],
  add column if not exists services              jsonb,
  add column if not exists opening_hours         jsonb,
  add column if not exists diagnostic_tests      jsonb default '[]',
  add column if not exists notes                 text,
  add column if not exists front_photo_url       text,
  add column if not exists latitude              numeric,
  add column if not exists longitude             numeric,
  add column if not exists subscription_tier     text not null default 'basic',
  add column if not exists trial_ends_at         date,
  add column if not exists verified              boolean default true,
  add column if not exists updated_at            timestamptz default now();

-- ── portal_users (clinic staff + roles) ─────────────────────────────
alter table public.portal_users
  add column if not exists staff_role            text default 'owner',
  add column if not exists is_active             boolean default true,
  add column if not exists onesignal_player_id   text;

-- ── clinic_inventory (stock) ────────────────────────────────────────
alter table public.clinic_inventory
  add column if not exists item_name             text,
  add column if not exists item_type             text,
  add column if not exists unit                  text default 'units',
  add column if not exists quantity              numeric(12,2) default 0,
  add column if not exists min_threshold         numeric(12,2) default 5,
  add column if not exists reorder_level         numeric(12,2) default 10,
  add column if not exists unit_cost_ugx         numeric(12,2),
  add column if not exists selling_price_ugx     numeric(12,2),
  add column if not exists category              text,
  add column if not exists expiry_date           date,
  add column if not exists is_active             boolean default true,
  add column if not exists updated_at            timestamptz default now();

-- ── profiles (patient accounts) ─────────────────────────────────────
alter table public.profiles
  add column if not exists onesignal_player_id   text,
  add column if not exists phone                 text;

-- ════════════════════════════════════════════════════════════════════
-- FEATURE TABLES — created only if missing (no-op if they exist)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.clinic_referrals (
  id             uuid primary key default gen_random_uuid(),
  from_clinic_id uuid, to_clinic_id uuid,
  patient_name   text, patient_phone text,
  reason text, needed_item text, notes text, referral_code text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.clinic_custom_lab_tests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid, test_name text, created_at timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
-- VIEW — patient_full_history (self-sufficient; columns ensured above)
-- ════════════════════════════════════════════════════════════════════
create or replace view public.patient_full_history as
select
  cd.id                       as diagnosis_id,
  cd.booking_id,
  cd.clinic_id,
  c.name                      as clinic_name,
  c.district                  as clinic_district,
  c.address                   as clinic_address,
  cd.clinician_name,
  cd.confirmed_diagnosis,
  cd.severity,
  cd.treatment_plan,
  cd.prescription_items,
  cd.follow_up_days,
  cd.total_charged_ugx,
  cd.payment_status,
  cd.created_at,
  cd.patient_phone,
  cd.patient_name,
  b.status                    as booking_status,
  b.no_show                   as missed,
  b.preferred_time            as appointment_time
from public.clinic_diagnoses cd
left join public.bookings b on b.id = cd.booking_id
left join public.clinics  c on c.id = cd.clinic_id;

select 'schema catch-up complete' as result;
