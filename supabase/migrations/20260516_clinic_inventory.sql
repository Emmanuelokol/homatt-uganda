-- ════════════════════════════════════════════════════════════════════
-- Clinic Inventory Intelligence
-- ────────────────────────────────────────────────────────────────────
-- Tables:
--   clinic_inventory            — master stock list per clinic
--   clinic_inventory_txns       — every deduction / addition / adjustment
-- RPCs:
--   deduct_inventory            — called when treatment is confirmed; auto-deducts items
--   adjust_inventory            — manual stock addition or correction
--   get_clinic_stock            — returns stock levels + low-stock flag
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Master stock list ──────────────────────────────────────────
create table if not exists public.clinic_inventory (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  item_name       text not null,
  item_type       text not null check (item_type in ('medicine','material','consumable')),
  unit            text not null default 'units',   -- tabs, ml, vials, pieces …
  quantity        numeric(12,2) not null default 0,
  min_threshold   numeric(12,2) not null default 5,
  reorder_level   numeric(12,2) not null default 10,
  unit_cost_ugx   numeric(12,2),                   -- used for financial reports
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  constraint clinic_inventory_qty_positive check (quantity >= 0)
);

create unique index if not exists idx_clinic_inventory_name
  on public.clinic_inventory (clinic_id, lower(item_name))
  where is_active = true;

create index if not exists idx_clinic_inventory_clinic
  on public.clinic_inventory (clinic_id, item_type);

create index if not exists idx_clinic_inventory_low_stock
  on public.clinic_inventory (clinic_id)
  where quantity <= min_threshold and is_active = true;

alter table public.clinic_inventory enable row level security;

drop policy if exists "inv_clinic_read"   on public.clinic_inventory;
create policy "inv_clinic_read" on public.clinic_inventory
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_inventory.clinic_id
    )
  );

drop policy if exists "inv_clinic_write"  on public.clinic_inventory;
create policy "inv_clinic_write" on public.clinic_inventory
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_inventory.clinic_id
    )
  );

-- ── 2. Transaction log ────────────────────────────────────────────
create table if not exists public.clinic_inventory_txns (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  inventory_id    uuid not null references public.clinic_inventory(id) on delete cascade,
  diagnosis_id    uuid references public.clinic_diagnoses(id),
  booking_id      uuid references public.bookings(id),
  txn_type        text not null check (txn_type in ('deduction','addition','adjustment','wastage')),
  quantity_change numeric(12,2) not null,
  quantity_after  numeric(12,2) not null,
  unit_cost_ugx   numeric(12,2),
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz default now()
);

create index if not exists idx_inv_txns_clinic_date
  on public.clinic_inventory_txns (clinic_id, created_at desc);
create index if not exists idx_inv_txns_diagnosis
  on public.clinic_inventory_txns (diagnosis_id);
create index if not exists idx_inv_txns_inventory
  on public.clinic_inventory_txns (inventory_id, created_at desc);

alter table public.clinic_inventory_txns enable row level security;

drop policy if exists "inv_txns_read"  on public.clinic_inventory_txns;
create policy "inv_txns_read" on public.clinic_inventory_txns
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_inventory_txns.clinic_id
    )
  );

drop policy if exists "inv_txns_insert" on public.clinic_inventory_txns;
create policy "inv_txns_insert" on public.clinic_inventory_txns
  for insert with check (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_inventory_txns.clinic_id
    )
  );

-- ── 3. RPC: get_clinic_stock ──────────────────────────────────────
-- Returns stock levels + low-stock flag for the dashboard.
create or replace function public.get_clinic_stock(p_clinic_id uuid)
returns table (
  id            uuid,
  item_name     text,
  item_type     text,
  unit          text,
  quantity      numeric,
  min_threshold numeric,
  reorder_level numeric,
  unit_cost_ugx numeric,
  is_low_stock  boolean,
  is_critical   boolean
)
language sql
security definer
set search_path = public
as $$
  select
    id,
    item_name,
    item_type,
    unit,
    quantity,
    min_threshold,
    reorder_level,
    unit_cost_ugx,
    quantity <= min_threshold   as is_low_stock,
    quantity = 0                as is_critical
  from public.clinic_inventory
  where clinic_id = p_clinic_id
    and is_active = true
  order by
    (quantity <= min_threshold) desc,
    item_type,
    item_name;
$$;

grant execute on function public.get_clinic_stock(uuid) to authenticated;

-- ── 4. RPC: deduct_inventory ──────────────────────────────────────
-- Called when a treatment plan is confirmed. Accepts a JSONB array:
-- [ { "item_id": "<uuid>", "qty": 2 }, … ]
-- Atomically reduces quantity, logs each transaction.
-- Returns list of items that are now low-stock.
create or replace function public.deduct_inventory(
  p_clinic_id    uuid,
  p_diagnosis_id uuid,
  p_booking_id   uuid,
  p_items        jsonb  -- [{ item_id, qty }]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item       record;
  v_row        public.clinic_inventory%rowtype;
  v_after      numeric;
  v_low_stock  jsonb := '[]';
begin
  for v_item in
    select
      (elem->>'item_id')::uuid  as item_id,
      (elem->>'qty')::numeric   as qty
    from jsonb_array_elements(p_items) as elem
  loop
    -- lock the row
    select * into v_row
    from public.clinic_inventory
    where id = v_item.item_id and clinic_id = p_clinic_id
    for update;

    if not found then continue; end if;

    v_after := greatest(0, v_row.quantity - v_item.qty);

    update public.clinic_inventory
       set quantity   = v_after,
           updated_at = now()
     where id = v_row.id;

    insert into public.clinic_inventory_txns
      (clinic_id, inventory_id, diagnosis_id, booking_id, txn_type,
       quantity_change, quantity_after, unit_cost_ugx, created_by)
    values
      (p_clinic_id, v_row.id, p_diagnosis_id, p_booking_id, 'deduction',
       -v_item.qty, v_after, v_row.unit_cost_ugx, auth.uid());

    if v_after <= v_row.min_threshold then
      v_low_stock := v_low_stock || jsonb_build_object(
        'id',           v_row.id,
        'item_name',    v_row.item_name,
        'quantity',     v_after,
        'min_threshold', v_row.min_threshold
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'low_stock', v_low_stock);
end;
$$;

grant execute on function public.deduct_inventory(uuid, uuid, uuid, jsonb) to authenticated;

-- ── 5. RPC: adjust_inventory ─────────────────────────────────────
-- Manual stock addition, correction, or wastage recording.
create or replace function public.adjust_inventory(
  p_clinic_id    uuid,
  p_inventory_id uuid,
  p_qty_change   numeric,  -- positive = addition, negative = wastage/correction
  p_txn_type     text,     -- 'addition' | 'adjustment' | 'wastage'
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.clinic_inventory%rowtype;
  v_after numeric;
begin
  select * into v_row
  from public.clinic_inventory
  where id = p_inventory_id and clinic_id = p_clinic_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item not found');
  end if;

  v_after := greatest(0, v_row.quantity + p_qty_change);

  update public.clinic_inventory
     set quantity   = v_after,
         updated_at = now()
   where id = v_row.id;

  insert into public.clinic_inventory_txns
    (clinic_id, inventory_id, txn_type, quantity_change, quantity_after,
     unit_cost_ugx, notes, created_by)
  values
    (p_clinic_id, v_row.id, p_txn_type, p_qty_change, v_after,
     v_row.unit_cost_ugx, p_notes, auth.uid());

  return jsonb_build_object(
    'ok',            true,
    'item_name',     v_row.item_name,
    'quantity_after', v_after,
    'is_low_stock',  v_after <= v_row.min_threshold
  );
end;
$$;

grant execute on function public.adjust_inventory(uuid, uuid, numeric, text, text) to authenticated;

-- ── 6. View: clinic_inventory_summary ────────────────────────────
-- Daily/weekly/monthly stock consumption per clinic.
-- Used by the financial + stock dashboard.
create or replace view public.clinic_inventory_consumption as
select
  t.clinic_id,
  i.item_name,
  i.item_type,
  i.unit,
  i.unit_cost_ugx,
  date_trunc('day',   t.created_at at time zone 'Africa/Kampala') as day,
  date_trunc('week',  t.created_at at time zone 'Africa/Kampala') as week,
  date_trunc('month', t.created_at at time zone 'Africa/Kampala') as month,
  sum(-t.quantity_change) filter (where t.txn_type = 'deduction') as qty_used,
  sum(-t.quantity_change * coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0))
    filter (where t.txn_type = 'deduction')                       as cost_ugx
from public.clinic_inventory_txns t
join public.clinic_inventory i on i.id = t.inventory_id
where t.txn_type = 'deduction'
group by 1,2,3,4,5,6,7,8;

comment on view public.clinic_inventory_consumption is
  'Aggregated stock usage by day/week/month per clinic item. Used for financial + stock dashboards.';
