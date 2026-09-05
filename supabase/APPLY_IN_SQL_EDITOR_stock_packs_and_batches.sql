-- ═══════════════════════════════════════════════════════════════════════════
--  HOMATT HEALTH — STOCK: PACK SIZES, NEGATIVE STOCK, AND BATCHES
--
--  WHAT TO DO
--  ----------
--  1. Open Supabase → your project → SQL Editor → New query.
--  2. Copy this WHOLE file in, top to bottom.
--  3. Press Run.
--
--  It takes a few seconds. It is safe to run more than once — running it twice
--  changes nothing and breaks nothing.
--
--  WHAT IT GIVES YOU
--  -----------------
--  • Restocking in one question. The app remembers that your box of Amoxicillin
--    is 10 strips of 10, so next delivery you only say how many boxes arrived.
--  • Stock that is allowed to go NEGATIVE. A clinician who has run out still
--    treats the patient; the shelf reads "short by 20" until you buy more, and
--    it clears itself the moment you do.
--  • Every delivery tracked separately with its own expiry, and the batch that
--    expires SOONEST is always the one dispensed first.
--
--  AT THE END you will see two small result tables. That is the check that it
--  worked — see the notes at the bottom of each part.
--
--  This file is the two pending migrations joined together, in order:
--      supabase/migrations/20260825_stock_packs.sql
--      supabase/migrations/20260826_stock_batches.sql
--  Run it as one block. The order matters.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ##  PART 1 of 2 — pack sizes, and stock that may go negative
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- Stock: pack templates, and stock that is allowed to go negative
--
-- Two things the clinic asked for.
--
-- 1. RESTOCKING IN SECONDS. Medicines arrive in boxes of strips of tablets.
--    The owner should answer three questions once —
--        how many boxes?  how many strips in a box?  how many tablets in a
--        strip?
--    — and the app does the arithmetic (5 × 4 × 6 = 120 tablets). The strips
--    and tablets per box do not change between deliveries, so they are stored
--    against the item as a template. Next delivery asks ONE question: how many
--    boxes? That is what the new columns below hold.
--
-- 2. STOCK MUST BE ABLE TO GO NEGATIVE. A clinician who has run out still
--    treats the patient — refusing to record the consultation would be worse
--    than an inaccurate count. The shortfall is carried as a negative number so
--    the owner can see exactly how much is owed to the shelf, and it clears
--    itself the moment stock is added. Previously two things prevented this:
--    a check constraint, and greatest(0, …) clamps inside the RPCs, which
--    silently threw the shortfall away and made the count wrong for good.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The pack template ──────────────────────────────────────────────────
alter table public.clinic_inventory
  add column if not exists strips_per_box  numeric(12,2),
  add column if not exists units_per_strip numeric(12,2),
  add column if not exists last_boxes      numeric(12,2);

comment on column public.clinic_inventory.strips_per_box is
  'Strips (or cards/sachets) in one box. Part of the restock template — asked once, reused every delivery.';
comment on column public.clinic_inventory.units_per_strip is
  'Tablets (or units) in one strip. boxes × strips_per_box × units_per_strip = units received.';
comment on column public.clinic_inventory.last_boxes is
  'Boxes received last time, offered as the default next time.';


-- ── 2. Let stock go negative ──────────────────────────────────────────────
alter table public.clinic_inventory
  drop constraint if exists clinic_inventory_qty_positive;


-- ── 3. Deduction: record the true shortfall, never clamp it away ──────────
create or replace function public.deduct_inventory(
  p_clinic_id    uuid,
  p_diagnosis_id uuid,
  p_booking_id   uuid,
  p_items        jsonb
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
    select (elem->>'item_id')::uuid as item_id,
           (elem->>'qty')::numeric  as qty
    from jsonb_array_elements(p_items) as elem
  loop
    select * into v_row
      from public.clinic_inventory
     where id = v_item.item_id and clinic_id = p_clinic_id
     for update;
    if not found then continue; end if;

    -- No greatest(0, …): dispensing 30 tablets from a shelf holding 10 leaves
    -- -20, which is the truth and is what tells the owner how much to buy.
    v_after := v_row.quantity - v_item.qty;

    update public.clinic_inventory
       set quantity = v_after, updated_at = now()
     where id = v_row.id;

    insert into public.clinic_inventory_txns
      (clinic_id, inventory_id, diagnosis_id, booking_id, txn_type,
       quantity_change, quantity_after, unit_cost_ugx, created_by)
    values
      (p_clinic_id, v_row.id, p_diagnosis_id, p_booking_id, 'deduction',
       -v_item.qty, v_after, v_row.unit_cost_ugx, auth.uid());

    if v_after <= v_row.min_threshold then
      v_low_stock := v_low_stock || jsonb_build_object(
        'id',            v_row.id,
        'item_name',     v_row.item_name,
        'quantity',      v_after,
        'min_threshold', v_row.min_threshold,
        'short_by',      case when v_after < 0 then -v_after else 0 end
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'low_stock', v_low_stock);
end $$;

grant execute on function public.deduct_inventory(uuid, uuid, uuid, jsonb) to authenticated;


-- ── 4. Adjustment: adding stock must be able to clear a negative ──────────
-- Adding 120 to a shelf sitting at -20 has to land on 100, not on 120.
do $$
declare
  fn record;
  newbody text;
begin
  for fn in
    select p.oid, pg_get_functiondef(p.oid) as def,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'adjust_inventory'
  loop
    if fn.def like '%greatest(0, v_row.quantity + p_qty_change)%' then
      newbody := replace(fn.def,
        'greatest(0, v_row.quantity + p_qty_change)',
        'v_row.quantity + p_qty_change');
      execute newbody;
      raise notice 'adjust_inventory(%) unclamped', fn.args;
    end if;
  end loop;
end $$;


-- ── 5. What needs buying ──────────────────────────────────────────────────
-- Anything at or below its threshold, worst first. A negative quantity means
-- that much has already been dispensed that the shelf did not have.
create or replace view public.v_clinic_stock_alerts as
  select id, clinic_id, item_name, item_type, unit,
         quantity, min_threshold, reorder_level,
         strips_per_box, units_per_strip, last_boxes,
         (quantity < 0)                                   as is_short,
         case when quantity < 0 then -quantity else 0 end  as short_by,
         greatest(0, reorder_level - quantity)             as suggested_top_up
    from public.clinic_inventory
   where is_active = true
     and quantity <= min_threshold
   order by quantity asc;

grant select on public.v_clinic_stock_alerts to authenticated;


-- ── Check it worked ───────────────────────────────────────────────────────
select column_name
  from information_schema.columns
 where table_schema='public' and table_name='clinic_inventory'
   and column_name in ('strips_per_box','units_per_strip','last_boxes')
 order by 1;

select conname from pg_constraint
 where conname = 'clinic_inventory_qty_positive';   -- expect zero rows


-- ###########################################################################
-- ##  PART 2 of 2 — one row per delivery, dispensed soonest-expiry first
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- Stock batches — track each delivery separately, and dispense the batch that
-- expires soonest FIRST (FEFO: first-expired, first-out).
--
-- The clinic buys the same medicine again and again, and each delivery has its
-- own expiry date. Kept as one lump, there is no way to say which stock is
-- about to expire or to make sure that stock leaves the shelf first. So every
-- intake now records a BATCH — a row with its own quantity and expiry — and
-- dispensing walks the batches in expiry order, emptying the soonest-expiring
-- one before touching a later one.
--
-- clinic_inventory.quantity stays as the running TOTAL (the sum of the live
-- batches), so everything that already reads that column keeps working. A
-- clinic that never runs this migration simply keeps the flat single-quantity
-- behaviour — the app degrades cleanly.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. The parent needs an expiry column to hold the soonest batch date ────
alter table public.clinic_inventory
  add column if not exists expiry_date date;


-- ── 1. One row per delivery ────────────────────────────────────────────────
create table if not exists public.clinic_inventory_batches (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  inventory_id  uuid not null references public.clinic_inventory(id) on delete cascade,
  quantity      numeric(12,2) not null default 0,   -- units still in THIS batch
  received_qty  numeric(12,2) not null default 0,   -- units this delivery brought in
  expiry_date   date,                                -- null = no expiry given
  boxes         numeric(12,2),
  notes         text,
  received_at   timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index if not exists idx_inv_batches_item
  on public.clinic_inventory_batches (inventory_id);
-- The FEFO order: soonest real expiry first, undated batches last, then oldest
-- delivery first as a tie-break.
create index if not exists idx_inv_batches_fefo
  on public.clinic_inventory_batches (inventory_id, expiry_date nulls last, received_at);

alter table public.clinic_inventory_batches enable row level security;

drop policy if exists "inv_batch_read"  on public.clinic_inventory_batches;
create policy "inv_batch_read" on public.clinic_inventory_batches
  for select using (
    exists (select 1 from public.portal_users pu
            where pu.auth_user_id = auth.uid() and pu.is_active = true
              and pu.clinic_id = clinic_inventory_batches.clinic_id));

drop policy if exists "inv_batch_write" on public.clinic_inventory_batches;
create policy "inv_batch_write" on public.clinic_inventory_batches
  for all using (
    exists (select 1 from public.portal_users pu
            where pu.auth_user_id = auth.uid() and pu.is_active = true
              and pu.clinic_id = clinic_inventory_batches.clinic_id));


-- ── 1b. Settle owed units against live stock, FEFO ─────────────────────────
-- A negative batch means units were dispensed the shelf did not have. When
-- fresh stock arrives it backfills that debt (soonest-expiring positive first),
-- so the owner never sees a stray negative line beside real stock.
create or replace function public._settle_batches(p_inventory_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt numeric;
  v_take numeric;
  b      record;
begin
  select coalesce(-sum(quantity), 0) into v_debt
    from public.clinic_inventory_batches
   where inventory_id = p_inventory_id and quantity < 0;
  if v_debt <= 0 then return; end if;

  delete from public.clinic_inventory_batches
   where inventory_id = p_inventory_id and quantity < 0;

  for b in
    select id, quantity from public.clinic_inventory_batches
     where inventory_id = p_inventory_id and quantity > 0
     order by expiry_date nulls last, received_at
     for update
  loop
    exit when v_debt <= 0;
    v_take := least(b.quantity, v_debt);
    update public.clinic_inventory_batches
       set quantity = quantity - v_take where id = b.id;
    v_debt := v_debt - v_take;
  end loop;

  -- Still owed after all live stock — keep it as one negative on the soonest
  -- (or newest, if none dated) remaining batch, so the shortfall stays visible.
  if v_debt > 0 then
    update public.clinic_inventory_batches
       set quantity = quantity - v_debt
     where id = (select id from public.clinic_inventory_batches
                  where inventory_id = p_inventory_id
                  order by expiry_date nulls last, received_at desc
                  limit 1);
  end if;

  -- Drop batches that are now exactly empty (spent stock, tidy list).
  delete from public.clinic_inventory_batches
   where inventory_id = p_inventory_id and quantity = 0;
end $$;

grant execute on function public._settle_batches(uuid) to authenticated;


-- ── 2. Add stock: record a batch AND keep the parent total in step ─────────
-- Returns the new on-hand total for the item.
create or replace function public.add_stock_batch(
  p_clinic_id    uuid,
  p_inventory_id uuid,
  p_qty          numeric,
  p_expiry       date    default null,
  p_boxes        numeric default null,
  p_notes        text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.clinic_inventory%rowtype;
  v_total numeric;
  v_had   integer;
begin
  select * into v_row
    from public.clinic_inventory
   where id = p_inventory_id and clinic_id = p_clinic_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item not found');
  end if;

  -- If this item has no batches yet but already carries a flat quantity (stock
  -- from before batches existed, or a debt from an earlier flat deduction),
  -- fold that into an opening-balance batch so nothing is lost and the running
  -- total stays exactly the sum of the batches — a debt then clears naturally.
  select count(*) into v_had
    from public.clinic_inventory_batches where inventory_id = p_inventory_id;
  if v_had = 0 and v_row.quantity <> 0 then
    insert into public.clinic_inventory_batches
      (clinic_id, inventory_id, quantity, received_qty, expiry_date, notes, created_by)
    values
      (p_clinic_id, p_inventory_id, v_row.quantity, greatest(0, v_row.quantity),
       v_row.expiry_date, 'opening balance', auth.uid());
  end if;

  insert into public.clinic_inventory_batches
    (clinic_id, inventory_id, quantity, received_qty, expiry_date, boxes, notes, created_by)
  values
    (p_clinic_id, p_inventory_id, p_qty, p_qty, p_expiry, p_boxes, p_notes, auth.uid());

  -- Settle any debt: units owed (negative batches) are backfilled from the new
  -- stock, FEFO, so no confusing negative line lingers next to fresh stock.
  perform public._settle_batches(p_inventory_id);

  -- The parent total is always the sum of the live batches.
  select coalesce(sum(quantity), 0) into v_total
    from public.clinic_inventory_batches where inventory_id = p_inventory_id;

  update public.clinic_inventory
     set quantity = v_total, updated_at = now(),
         expiry_date = (select min(expiry_date) from public.clinic_inventory_batches
                         where inventory_id = p_inventory_id and quantity > 0)
   where id = p_inventory_id;

  insert into public.clinic_inventory_txns
    (clinic_id, inventory_id, txn_type, quantity_change, quantity_after, unit_cost_ugx, notes, created_by)
  values
    (p_clinic_id, p_inventory_id, 'addition', p_qty, v_total, v_row.unit_cost_ugx, p_notes, auth.uid());

  return jsonb_build_object('ok', true, 'quantity_after', v_total);
end $$;

grant execute on function public.add_stock_batch(uuid, uuid, numeric, date, numeric, text) to authenticated;


-- ── 3. Deduct one item FEFO across its batches ─────────────────────────────
-- Consumes the soonest-expiring batch first. Returns the item's new total.
create or replace function public._deduct_one_fefo(
  p_clinic_id    uuid,
  p_inventory_id uuid,
  p_qty          numeric,
  p_diagnosis_id uuid,
  p_booking_id   uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.clinic_inventory%rowtype;
  v_batch  record;
  v_need   numeric := p_qty;
  v_take   numeric;
  v_total  numeric;
  v_has    boolean;
begin
  select * into v_row
    from public.clinic_inventory
   where id = p_inventory_id and clinic_id = p_clinic_id
   for update;
  if not found then return null; end if;

  select exists(select 1 from public.clinic_inventory_batches
                 where inventory_id = p_inventory_id) into v_has;

  if v_has then
    -- Walk live batches in expiry order, emptying the soonest first.
    for v_batch in
      select id, quantity from public.clinic_inventory_batches
       where inventory_id = p_inventory_id and quantity > 0
       order by expiry_date nulls last, received_at
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_batch.quantity, v_need);
      update public.clinic_inventory_batches
         set quantity = quantity - v_take where id = v_batch.id;
      v_need := v_need - v_take;
    end loop;

    -- Anything still owed (the shelf ran dry) lands on the soonest-expiring
    -- batch as a negative, so the debt is visible and clears on the next add.
    if v_need > 0 then
      update public.clinic_inventory_batches
         set quantity = quantity - v_need
       where id = (select id from public.clinic_inventory_batches
                    where inventory_id = p_inventory_id
                    order by expiry_date nulls last, received_at
                    limit 1);
    end if;

    select coalesce(sum(quantity), 0) into v_total
      from public.clinic_inventory_batches where inventory_id = p_inventory_id;
  else
    -- No batches recorded (pre-migration stock) — the flat behaviour.
    v_total := v_row.quantity - p_qty;
  end if;

  update public.clinic_inventory
     set quantity = v_total, updated_at = now(),
         expiry_date = (select min(expiry_date) from public.clinic_inventory_batches
                         where inventory_id = p_inventory_id and quantity > 0)
   where id = p_inventory_id;

  insert into public.clinic_inventory_txns
    (clinic_id, inventory_id, diagnosis_id, booking_id, txn_type,
     quantity_change, quantity_after, unit_cost_ugx, created_by)
  values
    (p_clinic_id, p_inventory_id, p_diagnosis_id, p_booking_id, 'deduction',
     -p_qty, v_total, v_row.unit_cost_ugx, auth.uid());

  return v_total;
end $$;

grant execute on function public._deduct_one_fefo(uuid, uuid, numeric, uuid, uuid) to authenticated;


-- ── 4. deduct_inventory: FEFO-aware, same signature the app already calls ──
create or replace function public.deduct_inventory(
  p_clinic_id    uuid,
  p_diagnosis_id uuid,
  p_booking_id   uuid,
  p_items        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item      record;
  v_row       public.clinic_inventory%rowtype;
  v_after     numeric;
  v_low_stock jsonb := '[]';
begin
  for v_item in
    select (elem->>'item_id')::uuid as item_id,
           (elem->>'qty')::numeric  as qty
    from jsonb_array_elements(p_items) as elem
  loop
    v_after := public._deduct_one_fefo(
      p_clinic_id, v_item.item_id, v_item.qty, p_diagnosis_id, p_booking_id);
    if v_after is null then continue; end if;

    select * into v_row from public.clinic_inventory where id = v_item.item_id;
    if v_after <= v_row.min_threshold then
      v_low_stock := v_low_stock || jsonb_build_object(
        'id',            v_row.id,
        'item_name',     v_row.item_name,
        'quantity',      v_after,
        'min_threshold', v_row.min_threshold,
        'short_by',      case when v_after < 0 then -v_after else 0 end);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'low_stock', v_low_stock);
end $$;

grant execute on function public.deduct_inventory(uuid, uuid, uuid, jsonb) to authenticated;


-- ── 5. The batches an owner should see: soonest expiry first ──────────────
create or replace view public.v_stock_batches as
  select b.id, b.clinic_id, b.inventory_id, i.item_name, i.unit,
         b.quantity, b.received_qty, b.expiry_date, b.boxes, b.received_at,
         (b.expiry_date is not null and b.expiry_date <= (current_date + 30)) as expiring_soon,
         (b.expiry_date is not null and b.expiry_date <  current_date)         as expired
    from public.clinic_inventory_batches b
    join public.clinic_inventory i on i.id = b.inventory_id
   where b.quantity <> 0
   order by b.inventory_id, b.expiry_date nulls last, b.received_at;

grant select on public.v_stock_batches to authenticated;


-- ── Check it worked ───────────────────────────────────────────────────────
select 'batches table' as what,
       (to_regclass('public.clinic_inventory_batches') is not null) as ok
union all
select 'add_stock_batch', (to_regproc('public.add_stock_batch') is not null)
union all
select 'fefo deduct',     (to_regproc('public._deduct_one_fefo') is not null);
