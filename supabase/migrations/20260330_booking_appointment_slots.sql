-- ============================================================
-- Booking Appointment Time & Clinic Slot Settings
-- Adds appointment_time to bookings so patients can choose a
-- preferred date/time, and slot configuration columns to clinics
-- so the portal can control capacity and booking windows.
-- ============================================================

-- ── bookings: preferred appointment time ─────────────────────
alter table bookings
  add column if not exists appointment_time  timestamptz,
  add column if not exists appointment_confirmed boolean default false;

-- Index for clinic staff to query appointments by date
create index if not exists idx_bookings_appointment_time
  on bookings(clinic_id, appointment_time)
  where appointment_time is not null;

-- ── clinics: appointment slot configuration ───────────────────
alter table clinics
  add column if not exists slot_duration_minutes  integer  default 30,
  add column if not exists max_per_slot           integer  default 3,
  add column if not exists slot_buffer_minutes    integer  default 0,
  add column if not exists booking_window_days    integer  default 14,
  add column if not exists accepts_online_slots   boolean  default true,
  add column if not exists auto_confirm_slots     boolean  default false;

-- Comment for documentation
comment on column clinics.slot_duration_minutes  is 'Duration of each appointment slot in minutes';
comment on column clinics.max_per_slot           is 'Max patients allowed in a single time slot';
comment on column clinics.slot_buffer_minutes    is 'Buffer gap between slots (minutes)';
comment on column clinics.booking_window_days    is 'How many days ahead patients can book';
comment on column clinics.accepts_online_slots   is 'Whether clinic accepts patient-chosen time slots';
comment on column clinics.auto_confirm_slots     is 'Auto-confirm bookings without manual clinic review';
comment on column bookings.appointment_time      is 'Patient-preferred appointment datetime (UTC)';
comment on column bookings.appointment_confirmed is 'Whether the clinic has confirmed this appointment time';
