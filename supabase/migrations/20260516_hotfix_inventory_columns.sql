-- ════════════════════════════════════════════════════════════════════
-- HOTFIX: Repair clinic_inventory table — add ALL missing columns
-- ────────────────────────────────────────────────────────────────────
-- Your DB has a public.clinic_inventory table from a previous/different
-- schema that's missing most of the columns we need. This adds every
-- expected column safely (IF NOT EXISTS, nullable, with sensible
-- defaults) so the rest of the migration can run.
--
-- Run THIS first in Supabase SQL Editor as a brand-new query.
-- Then run the full 20260516_clinic_inventory.sql in another new
-- query window (do NOT re-use any old saved query).
-- ════════════════════════════════════════════════════════════════════

alter table public.clinic_inventory
  add column if not exists item_name       text,
  add column if not exists item_type       text,
  add column if not exists unit            text          default 'units',
  add column if not exists quantity        numeric(12,2) default 0,
  add column if not exists min_threshold   numeric(12,2) default 5,
  add column if not exists reorder_level   numeric(12,2) default 10,
  add column if not exists unit_cost_ugx   numeric(12,2),
  add column if not exists is_active       boolean       default true,
  add column if not exists created_at      timestamptz   default now(),
  add column if not exists updated_at      timestamptz   default now();

-- Backfill any NULL values from previous schema rows
update public.clinic_inventory set is_active     = true       where is_active     is null;
update public.clinic_inventory set unit          = 'units'    where unit          is null;
update public.clinic_inventory set quantity      = 0          where quantity      is null;
update public.clinic_inventory set min_threshold = 5          where min_threshold is null;
update public.clinic_inventory set reorder_level = 10         where reorder_level is null;
update public.clinic_inventory set created_at    = now()      where created_at    is null;
update public.clinic_inventory set updated_at    = now()      where updated_at    is null;

-- Verify all columns are now there
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'clinic_inventory'
order by ordinal_position;
