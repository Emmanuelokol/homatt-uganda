-- ============================================================
-- Fix: Add all missing clinic columns that are used by the
-- portal (settings.html) and patient app (symptom-checker.js,
-- clinic-booking.html) but were never applied to production.
--
-- This migration is idempotent (all ADD COLUMN IF NOT EXISTS).
-- Safe to run multiple times.
-- ============================================================

-- ── Booking / appointment slot columns ───────────────────────
-- From 20260330_booking_appointment_slots.sql (may not have been applied)
alter table clinics
  add column if not exists slot_duration_minutes  integer  default 30,
  add column if not exists max_per_slot           integer  default 3,
  add column if not exists slot_buffer_minutes    integer  default 0,
  add column if not exists booking_window_days    integer  default 14,
  add column if not exists accepts_online_slots   boolean  default true,
  add column if not exists auto_confirm_slots     boolean  default false;

-- ── Profile / location columns ───────────────────────────────
-- From 20260409_clinic_settings_columns.sql (may not have been applied)
alter table clinics
  add column if not exists description       text,
  add column if not exists whatsapp          text,
  add column if not exists contact_person    text,
  add column if not exists city              text,
  add column if not exists latitude          numeric,
  add column if not exists longitude         numeric,
  add column if not exists specialties       text[],
  add column if not exists facilities        text[],
  add column if not exists services          jsonb,
  add column if not exists consultation_fee  numeric,
  add column if not exists opening_hours     jsonb;

-- ── bookings: appointment time columns ───────────────────────
alter table bookings
  add column if not exists appointment_time      timestamptz,
  add column if not exists appointment_confirmed boolean default false;

-- ── profiles: OneSignal push notification columns ────────────
-- From 20260409_notification_system.sql (may not have been applied)
alter table profiles
  add column if not exists onesignal_player_id      text,
  add column if not exists notifications_sent_today  integer default 0,
  add column if not exists last_notification_date    date,
  add column if not exists notification_preferences  jsonb;

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_clinics_latlon
  on clinics (latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists idx_bookings_appointment_time
  on bookings (clinic_id, appointment_time)
  where appointment_time is not null;

-- ── Comments ──────────────────────────────────────────────────
comment on column clinics.slot_duration_minutes  is 'Duration of each appointment slot in minutes';
comment on column clinics.max_per_slot           is 'Max patients allowed in a single time slot';
comment on column clinics.slot_buffer_minutes    is 'Buffer gap between slots (minutes)';
comment on column clinics.booking_window_days    is 'How many days ahead patients can book';
comment on column clinics.accepts_online_slots   is 'Whether clinic accepts patient-chosen time slots';
comment on column clinics.auto_confirm_slots     is 'Auto-confirm bookings without manual clinic review';
comment on column clinics.description            is 'Clinic about/description shown to patients';
comment on column clinics.whatsapp               is 'WhatsApp contact number';
comment on column clinics.contact_person         is 'Manager or contact person name';
comment on column clinics.city                   is 'City or subcounty';
comment on column clinics.latitude               is 'GPS latitude for distance-based sorting';
comment on column clinics.longitude              is 'GPS longitude for distance-based sorting';
comment on column clinics.specialties            is 'Array of medical specialties / conditions treated';
comment on column clinics.facilities             is 'Available facilities (lab, X-ray, pharmacy, etc.)';
comment on column clinics.services               is 'Service fee list [{type, fee, notes}] set in clinic portal';
comment on column clinics.consultation_fee       is 'General consultation fee in UGX';
comment on column clinics.opening_hours          is 'Opening hours per day {Monday: {open, close, closed}}';
comment on column profiles.onesignal_player_id   is 'OneSignal subscription ID for targeted push notifications';
