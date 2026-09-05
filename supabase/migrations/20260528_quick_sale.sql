-- ════════════════════════════════════════════════════════════════════
-- Quick Sale: selling price for clinic_inventory + clinic_quick_sales
-- ════════════════════════════════════════════════════════════════════

-- 1. Add selling_price_ugx to clinic_inventory (used by Quick Sale POS)
alter table public.clinic_inventory
  add column if not exists selling_price_ugx numeric(12,2);

-- 2. Quick Sales table — each row is one retail counter transaction
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
