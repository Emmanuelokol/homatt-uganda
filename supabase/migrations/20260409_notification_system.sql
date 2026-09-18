-- ============================================================
-- Homatt Health Uganda — Notification & Automation System
-- Adds: OneSignal player IDs, notification flags, preferences,
--       admin_alerts table, follow_up_alerts table, proxy_users
-- ============================================================

-- ── EXTENSIONS ───────────────────────────────────────────────
-- pg_net: HTTP requests from within PostgreSQL (used by pg_cron)
create extension if not exists pg_net schema extensions;

-- ── onesignal_player_id ──────────────────────────────────────
-- Patient app — stored in profiles
alter table profiles
  add column if not exists onesignal_player_id     text,
  add column if not exists notification_preferences jsonb
    default '{"appointment_reminders":true,"medicine_reminders":true,"promo_prevention_shop":false,"recovery_checkins":true}'::jsonb,
  add column if not exists notifications_sent_today integer default 0,
  add column if not exists last_notification_date   date;

-- Portal staff — stored in portal_users (covers clinic_staff, pharmacy_staff, rider, admin)
alter table portal_users
  add column if not exists onesignal_player_id text;

-- ── PROXY / VHT USERS ────────────────────────────────────────
-- Community health workers who register and assist patients
create table if not exists proxy_users (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid references auth.users(id),
  full_name        text,
  phone            text,
  district         text,
  sub_county       text,
  is_active        boolean default true,
  onesignal_player_id text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table proxy_users enable row level security;
create policy "Proxy users can read own record" on proxy_users
  for select using (auth.uid() = auth_user_id);
create policy "Admin can manage proxy users" on proxy_users
  for all using (true);

-- Link bookings to proxy/VHT who assisted
alter table bookings
  add column if not exists proxy_id       uuid references proxy_users(id),
  add column if not exists proxy_assisted boolean default false;

-- ── NOTIFICATION FLAGS ON BOOKINGS ───────────────────────────
alter table bookings
  add column if not exists reminder_sent          boolean default false,
  add column if not exists same_day_reminder_sent boolean default false,
  add column if not exists followup_reminder_sent boolean default false,
  add column if not exists followup_required      boolean default false,
  add column if not exists deposit_amount         integer default 0;

-- ── NOTIFICATION FLAGS ON PHARMACY_ORDERS ────────────────────
-- pharmacy_orders tracks both orders AND deliveries (dispatched/delivered status)
alter table pharmacy_orders
  add column if not exists day2_reminder_sent boolean default false,
  add column if not exists day4_reminder_sent boolean default false,
  add column if not exists day7_reminder_sent boolean default false,
  add column if not exists delivered_at       timestamptz,
  add column if not exists recovery_status    text check (recovery_status in ('better','same','worse'));

-- ── ADMIN ALERTS TABLE ───────────────────────────────────────
create table if not exists admin_alerts (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,  -- 'payment_failed', 'patient_dropout', 'system_event'
  message       text not null,
  related_table text,
  related_id    uuid,
  severity      text default 'info' check (severity in ('info','warning','critical')),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id),
  created_at    timestamptz default now()
);
alter table admin_alerts enable row level security;
create policy "Admin can manage alerts" on admin_alerts for all using (true);

create index if not exists idx_admin_alerts_unresolved
  on admin_alerts (created_at desc)
  where resolved_at is null;

-- ── FOLLOW-UP ALERTS TABLE ───────────────────────────────────
create table if not exists follow_up_alerts (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid references auth.users(id),
  vht_id       uuid references proxy_users(id),
  booking_id   uuid references bookings(id),
  reason       text,
  actioned_at  timestamptz,
  actioned_by  uuid references auth.users(id),
  created_at   timestamptz default now()
);
alter table follow_up_alerts enable row level security;
create policy "VHTs and admin can manage follow-up alerts" on follow_up_alerts
  for all using (true);

create index if not exists idx_follow_up_alerts_vht
  on follow_up_alerts (vht_id, created_at desc)
  where actioned_at is null;

-- ── INDEXES FOR CRON QUERY PERFORMANCE ───────────────────────
create index if not exists idx_bookings_appointment_reminder
  on bookings (appointment_time, reminder_sent, clinic_id)
  where appointment_time is not null and status not in ('cancelled','completed');

create index if not exists idx_bookings_same_day_reminder
  on bookings (appointment_time, same_day_reminder_sent)
  where appointment_time is not null and status not in ('cancelled','completed');

create index if not exists idx_pharmacy_orders_delivered_at
  on pharmacy_orders (delivered_at, day2_reminder_sent, patient_user_id)
  where status = 'delivered' and delivered_at is not null;

create index if not exists idx_bookings_pending_payment
  on bookings (created_at, status)
  where status = 'pending';

-- ── COMMENTS ─────────────────────────────────────────────────
comment on column profiles.onesignal_player_id
  is 'OneSignal push subscription player ID captured from Capacitor app';
comment on column profiles.notification_preferences
  is 'Per-user notification toggles: appointment_reminders, medicine_reminders, promo_prevention_shop, recovery_checkins';
comment on column profiles.notifications_sent_today
  is 'Rolling count of push notifications sent today — reset when last_notification_date != today';
comment on column profiles.last_notification_date
  is 'Date of last notification send — used to reset notifications_sent_today counter';
comment on column proxy_users.onesignal_player_id
  is 'OneSignal push player ID for VHT/community health worker';
comment on table admin_alerts
  is 'System-wide alert feed for admin portal: payment failures, dropouts, system events';
comment on table follow_up_alerts
  is 'Patient follow-up tasks assigned to VHT/proxy workers';
