-- ════════════════════════════════════════════════════════════════════
-- APPLY THIS IN THE SUPABASE SQL EDITOR (copy–paste the whole file)
-- ────────────────────────────────────────────────────────────────────
-- Adds the newer clinic_inventory columns + quick sales table that the
-- clinic portal Stock Tracker and Quick Sale POS need. Without these,
-- "Save Item" fails whenever a selling price, category or packaging
-- field is filled in, and Quick Sale shows demo drugs instead of your
-- real stock.
--
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- 1. Selling price (Quick Sale POS) — from 20260528_quick_sale.sql
alter table public.clinic_inventory
  add column if not exists selling_price_ugx numeric(12,2);

-- 2. Category / illness tag — from 20260602_clinic_inventory_category.sql
alter table public.clinic_inventory
  add column if not exists category text default null;

-- 3. Packaging (pack & box selling) — from 20260606_inventory_packaging.sql
alter table public.clinic_inventory
  add column if not exists tabs_per_pack          integer       default null,
  add column if not exists packs_per_box          integer       default null,
  add column if not exists pack_selling_price_ugx numeric(12,2) default null,
  add column if not exists box_selling_price_ugx  numeric(12,2) default null;

-- 4. Quick Sales table — from 20260528_quick_sale.sql
create table if not exists public.clinic_quick_sales (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  drug_id         uuid references public.clinic_inventory(id),
  drug_name       text not null,
  unit            text default 'unit',
  quantity        integer not null default 1,
  unit_price_ugx  numeric(12,2) not null default 0,
  total_ugx       numeric(12,2) not null default 0,
  payment_method  text not null default 'cash',
  sold_by         uuid references auth.users(id),
  created_at      timestamptz default now()
);

create index if not exists idx_quick_sales_clinic_date
  on public.clinic_quick_sales (clinic_id, created_at desc);

alter table public.clinic_quick_sales enable row level security;

drop policy if exists "qs_clinic_read"  on public.clinic_quick_sales;
create policy "qs_clinic_read" on public.clinic_quick_sales
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_quick_sales.clinic_id
    )
  );

drop policy if exists "qs_clinic_write" on public.clinic_quick_sales;
create policy "qs_clinic_write" on public.clinic_quick_sales
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_quick_sales.clinic_id
    )
  );

-- 5. Diagnostic tests column for clinic settings (Services section)
alter table public.clinics
  add column if not exists diagnostic_tests jsonb default '[]';

select 'Inventory + Quick Sale columns applied successfully' as result;
