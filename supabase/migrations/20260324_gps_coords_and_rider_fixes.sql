-- ── GPS COORDINATES FOR PHARMACY ORDERS ─────────────────────────────────────
-- Add delivery GPS coordinates to pharmacy_orders so map links can be generated
alter table pharmacy_orders
  add column if not exists delivery_lat numeric,
  add column if not exists delivery_lon numeric;

-- ── RIDER_DELIVERIES FIXES ────────────────────────────────────────────────────
-- Add missing columns needed by the rider dashboard
alter table rider_deliveries
  add column if not exists updated_at timestamptz default now(),
  add column if not exists distance_km numeric,
  add column if not exists rider_id uuid references riders(id);

-- Extend the status constraint to include in_transit (used by the rider portal)
alter table rider_deliveries
  drop constraint if exists rider_deliveries_status_check;
alter table rider_deliveries
  add constraint rider_deliveries_status_check
    check (status in ('pending','in_transit','picked_up','delivered','failed'));

-- ── PORTAL USERS: ADD RIDER_ID ───────────────────────────────────────────────
-- Link portal_users to riders table so the login can store riderId
alter table portal_users
  add column if not exists rider_id uuid references riders(id);
