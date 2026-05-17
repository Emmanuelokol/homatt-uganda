-- ════════════════════════════════════════════════════════════════════
-- HOTFIX: Add missing columns to clinic_inventory
-- ────────────────────────────────────────────────────────────────────
-- The original migration created the table without is_active in your
-- database (partial run). The unique index then fails because the
-- column it references doesn't exist.
--
-- Run THIS file first in Supabase SQL Editor. It's tiny and safe.
-- Then re-run 20260516_clinic_inventory.sql in a NEW query window
-- (don't re-use the old saved query — paste the latest file content).
-- ════════════════════════════════════════════════════════════════════

alter table public.clinic_inventory
  add column if not exists is_active       boolean not null default true,
  add column if not exists unit_cost_ugx   numeric(12,2),
  add column if not exists min_threshold   numeric(12,2) not null default 5,
  add column if not exists reorder_level   numeric(12,2) not null default 10,
  add column if not exists updated_at      timestamptz default now();

-- Verify the columns are now there
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'clinic_inventory'
order by ordinal_position;
