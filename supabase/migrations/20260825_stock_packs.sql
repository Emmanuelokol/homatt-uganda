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
