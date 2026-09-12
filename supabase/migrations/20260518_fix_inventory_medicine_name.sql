-- ════════════════════════════════════════════════════════════════════
-- FIX: clinic_inventory medicine_name → item_name column rename
-- ────────────────────────────────────────────────────────────────────
-- The live DB was created with medicine_name text NOT NULL.
-- This renames it to item_name (the canonical column used everywhere)
-- and handles all three possible states of the live DB:
--   A) Only medicine_name exists  → rename it to item_name
--   B) Both columns exist          → copy data then drop medicine_name
--   C) Only item_name exists       → nothing to do (already fixed)
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_has_medicine_name boolean;
  v_has_item_name     boolean;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_inventory'
      and column_name = 'medicine_name'
  ) into v_has_medicine_name;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_inventory'
      and column_name = 'item_name'
  ) into v_has_item_name;

  if v_has_medicine_name and not v_has_item_name then
    -- Case A: rename
    execute 'alter table public.clinic_inventory rename column medicine_name to item_name';

  elsif v_has_medicine_name and v_has_item_name then
    -- Case B: copy then drop
    execute 'update public.clinic_inventory set item_name = medicine_name where item_name is null and medicine_name is not null';
    execute 'alter table public.clinic_inventory drop column medicine_name';
  end if;
  -- Case C: nothing to do
end $$;

-- Drop NOT NULL from item_type in case the old schema had it NOT NULL
-- (PostgreSQL silently ignores this if already nullable)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_inventory'
      and column_name = 'item_type'
  ) then
    execute 'alter table public.clinic_inventory alter column item_type drop not null';
  end if;
end $$;

-- Backfill any remaining nulls
update public.clinic_inventory set item_type = 'medicine'   where item_type is null;
update public.clinic_inventory set is_active = true         where is_active is null;
update public.clinic_inventory set unit      = 'units'      where unit      is null;
update public.clinic_inventory set quantity  = 0            where quantity  is null;

-- Verify
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'clinic_inventory'
order by ordinal_position;
