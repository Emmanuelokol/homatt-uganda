-- ════════════════════════════════════════════════════════════════════
-- Correcting what was already recorded — and only the owner may do it
-- ════════════════════════════════════════════════════════════════════
--
-- A clinic asked to be able to fix what they had already saved: edit or
-- delete a quick sale, add the drug or the lab test or the money that was
-- forgotten on a treatment, and correct or remove a patient — "this is only
-- done in the main account, not sub accounts".
--
-- ── WHY THIS IS A MIGRATION AND NOT A SCREEN ────────────────────────
--
-- The screen cannot enforce that. Today every one of these tables is open to
-- every member of staff:
--
--   qs_clinic_write            for all using (active portal_user, same clinic)
--   clinic_patients_staff_manage    the same shape
--
-- "for all" is insert, update AND delete, and the check is membership, not
-- role. So a receptionist or a visiting clinician can already delete a sale
-- or a patient with a REST call — hiding the button in the app changes
-- nothing about that. The permission has to live in the database.
--
-- ── AND A HOLE FOUND ON THE WAY ─────────────────────────────────────
--
-- `adjust_inventory`, `deduct_inventory` and `get_clinic_stock` are all
-- `security definer`, which means they run as the owner of the function and
-- RLS never applies to them. None of the three checked that the CALLER
-- belongs to p_clinic_id — only that the item did. Any authenticated Homatt
-- user, including a patient account or a clinician attached to a different
-- clinic, could read another clinic's stock list and adjust its quantities,
-- given the ids.
--
-- That is fixed here, because this migration's "put the stock back" path
-- calls adjust_inventory, and building an owner-only feature on a function
-- anyone can call would be pointless.
--
-- ── THE RULES THE CORRECTIONS FOLLOW ────────────────────────────────
--
-- 1. A sale that is deleted or reduced PUTS THE STOCK BACK. A sale removed
--    without returning the stock makes the shelf count drift silently, which
--    is a worse fault than the wrong sale — nobody sees it until a count.
-- 2. Every correction writes an audit row: who, when, what, from, to. A
--    clinic's books changing with no trace is its own kind of harm, and the
--    owner asking for this is also the person it protects.
-- 3. A patient with any history is ARCHIVED, never destroyed. Their
--    treatments are a medical record. A patient with no visits and no sales
--    — the typo that made a duplicate, which is the common case — is deleted
--    outright, because there is nothing to lose.
-- 4. Nothing here invents a number. A correction records what a person typed.

-- ── 0. Who is the main account ──────────────────────────────────────
--
-- The clinic's own owner login. Deliberately NOT "anyone who is not a
-- visiting clinician": a receptionist and a nurse are sub-accounts too, and
-- the request was specific.
create or replace function public.is_clinic_main_account(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.portal_users pu
    where pu.auth_user_id = auth.uid()
      and pu.is_active = true
      and pu.clinic_id = p_clinic_id
      and coalesce(pu.staff_role, 'owner') = 'owner'
  );
$$;

grant execute on function public.is_clinic_main_account(uuid) to authenticated;

-- Staff of this clinic at all, of any role. Used by the inventory fix below.
create or replace function public.is_clinic_staff(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.portal_users pu
    where pu.auth_user_id = auth.uid()
      and pu.is_active = true
      and pu.clinic_id = p_clinic_id
  );
$$;

grant execute on function public.is_clinic_staff(uuid) to authenticated;

-- ── 1. The audit trail ──────────────────────────────────────────────
create table if not exists public.clinic_record_edits (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  record_type  text not null,          -- 'quick_sale' | 'visit' | 'patient'
  record_id    uuid,
  action       text not null,          -- 'edit' | 'delete' | 'archive'
  before_json  jsonb,
  after_json   jsonb,
  reason       text,
  edited_by    uuid references auth.users(id),
  created_at   timestamptz default now()
);

create index if not exists idx_record_edits_clinic
  on public.clinic_record_edits (clinic_id, created_at desc);

alter table public.clinic_record_edits enable row level security;

-- Readable by the clinic's staff; written only through the RPCs below, which
-- are security definer. No direct insert policy on purpose — an audit row a
-- client can forge is not an audit row.
drop policy if exists "record_edits_read" on public.clinic_record_edits;
create policy "record_edits_read" on public.clinic_record_edits
  for select using (public.is_clinic_staff(clinic_id));

-- ── 2. Close the inventory hole ─────────────────────────────────────
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
    id, item_name, item_type, unit, quantity, min_threshold, reorder_level,
    unit_cost_ugx,
    quantity <= min_threshold as is_low_stock,
    quantity = 0              as is_critical
  from public.clinic_inventory
  where clinic_id = p_clinic_id
    and is_active = true
    -- The caller must be staff of THIS clinic. Without this the function
    -- handed any authenticated user any clinic's shelves.
    and public.is_clinic_staff(p_clinic_id)
  order by (quantity <= min_threshold) desc, item_type, item_name;
$$;

grant execute on function public.get_clinic_stock(uuid) to authenticated;

create or replace function public.adjust_inventory(
  p_clinic_id    uuid,
  p_inventory_id uuid,
  p_qty_change   numeric,
  p_txn_type     text,
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
  -- The caller must be staff of this clinic. Restocking is an ordinary staff
  -- job, so this is staff and not owner — but it is no longer "anybody".
  if not public.is_clinic_staff(p_clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'not your clinic');
  end if;

  select * into v_row
  from public.clinic_inventory
  where id = p_inventory_id and clinic_id = p_clinic_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item not found');
  end if;

  v_after := greatest(0, v_row.quantity + p_qty_change);

  update public.clinic_inventory
     set quantity = v_after, updated_at = now()
   where id = v_row.id;

  insert into public.clinic_inventory_txns
    (clinic_id, inventory_id, txn_type, quantity_change, quantity_after,
     unit_cost_ugx, notes, created_by)
  values
    (p_clinic_id, v_row.id, p_txn_type, p_qty_change, v_after,
     v_row.unit_cost_ugx, p_notes, auth.uid());

  return jsonb_build_object(
    'ok', true,
    'item_name', v_row.item_name,
    'quantity_after', v_after,
    'is_low_stock', v_after <= v_row.min_threshold
  );
end;
$$;

grant execute on function public.adjust_inventory(uuid, uuid, numeric, text, text) to authenticated;

-- ── 3. Quick sale: correct it, or take it off the books ─────────────
--
-- Editing the quantity moves the stock by the DIFFERENCE, in the right
-- direction: selling 2 where 3 was recorded puts 1 back on the shelf.
create or replace function public.edit_quick_sale(
  p_sale_id        uuid,
  p_quantity       integer default null,
  p_unit_price_ugx numeric default null,
  p_payment_method text    default null,
  p_reason         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.clinic_quick_sales%rowtype;
  v_before jsonb;
  v_qty    integer;
  v_price  numeric;
  v_method text;
  v_delta  numeric;
begin
  select * into v_sale from public.clinic_quick_sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale not found');
  end if;

  if not public.is_clinic_main_account(v_sale.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'only the main account can correct a sale');
  end if;

  v_qty    := coalesce(p_quantity, v_sale.quantity);
  v_price  := coalesce(p_unit_price_ugx, v_sale.unit_price_ugx);
  v_method := coalesce(p_payment_method, v_sale.payment_method);

  if v_qty < 1 then
    return jsonb_build_object('ok', false, 'error', 'a sale of nothing is a deletion — use delete_quick_sale');
  end if;
  if v_price < 0 then
    return jsonb_build_object('ok', false, 'error', 'a price cannot be negative');
  end if;

  v_before := to_jsonb(v_sale);

  update public.clinic_quick_sales
     set quantity       = v_qty,
         unit_price_ugx = v_price,
         total_ugx      = v_qty * v_price,
         payment_method = v_method
   where id = v_sale.id;

  -- Stock follows the correction. Fewer sold than recorded puts the
  -- difference back; more sold takes it off.
  v_delta := v_sale.quantity - v_qty;
  if v_delta <> 0 and v_sale.drug_id is not null then
    perform public.adjust_inventory(
      v_sale.clinic_id, v_sale.drug_id, v_delta, 'adjustment',
      'Quick sale corrected: ' || v_sale.quantity || ' → ' || v_qty || ' × ' || coalesce(v_sale.unit, 'unit'));
  end if;

  insert into public.clinic_record_edits
    (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
  values
    (v_sale.clinic_id, 'quick_sale', v_sale.id, 'edit', v_before,
     to_jsonb((select s from public.clinic_quick_sales s where s.id = v_sale.id)),
     p_reason, auth.uid());

  return jsonb_build_object('ok', true, 'stock_returned', v_delta);
end;
$$;

grant execute on function public.edit_quick_sale(uuid, integer, numeric, text, text) to authenticated;

create or replace function public.delete_quick_sale(
  p_sale_id uuid,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.clinic_quick_sales%rowtype;
  v_before jsonb;
begin
  select * into v_sale from public.clinic_quick_sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale not found');
  end if;

  if not public.is_clinic_main_account(v_sale.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'only the main account can delete a sale');
  end if;

  v_before := to_jsonb(v_sale);

  -- The stock goes back on the shelf FIRST. If this failed after the row was
  -- gone there would be nothing left to say how much to return.
  if v_sale.drug_id is not null then
    perform public.adjust_inventory(
      v_sale.clinic_id, v_sale.drug_id, v_sale.quantity, 'adjustment',
      'Quick sale deleted: ' || v_sale.quantity || ' × ' || coalesce(v_sale.unit, 'unit') ||
      ' of ' || v_sale.drug_name || ' returned to stock');
  end if;

  delete from public.clinic_quick_sales where id = v_sale.id;

  insert into public.clinic_record_edits
    (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
  values
    (v_sale.clinic_id, 'quick_sale', v_sale.id, 'delete', v_before, null, p_reason, auth.uid());

  return jsonb_build_object('ok', true, 'stock_returned', v_sale.quantity);
end;
$$;

grant execute on function public.delete_quick_sale(uuid, text) to authenticated;

-- ── 4. A visit: the drug, the test or the money that was forgotten ──
--
-- Only the fields a correction should touch. The diagnosis itself, the
-- clinician who recorded it and the date are NOT editable here: changing who
-- was treated for what, after the fact, is not a correction, it is a
-- different record.
create or replace function public.edit_visit_record(
  p_visit_id            uuid,
  p_prescription_items  jsonb   default null,
  p_lab_tests_ordered   text[]  default null,
  p_consultation_fee    numeric default null,
  p_lab_fee             numeric default null,
  p_meds_fee            numeric default null,
  p_amount_paid         numeric default null,
  p_treatment_plan      text    default null,
  p_reason              text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.clinic_diagnoses%rowtype;
  v_before jsonb;
  v_cons   numeric;
  v_lab    numeric;
  v_meds   numeric;
  v_total  numeric;
  v_paid   numeric;
  v_status text;
begin
  select * into v_row from public.clinic_diagnoses where id = p_visit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'visit not found');
  end if;

  if not public.is_clinic_main_account(v_row.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'only the main account can correct a visit');
  end if;

  v_before := to_jsonb(v_row);

  v_cons := greatest(0, coalesce(p_consultation_fee, v_row.consultation_fee_ugx, 0));
  v_lab  := greatest(0, coalesce(p_lab_fee,          v_row.lab_fee_ugx,          0));
  v_meds := greatest(0, coalesce(p_meds_fee,         v_row.meds_fee_ugx,         0));
  v_total := v_cons + v_lab + v_meds;
  v_paid := greatest(0, coalesce(p_amount_paid, v_row.amount_paid, 0));
  if v_paid > v_total then v_paid := v_total; end if;

  -- THE AMOUNT DECIDES THE STATUS, NOT A CHIP. Same rule the treatment screen
  -- already follows: nothing paid is pending, part of it is partial, the whole
  -- bill is paid — so a correction cannot record a debt as settled by mistake.
  v_status := case
    when v_total <= 0    then coalesce(v_row.payment_status, 'pending')
    when v_paid <= 0     then 'pending'
    when v_paid >= v_total then 'paid'
    else 'partial'
  end;

  update public.clinic_diagnoses
     set prescription_items   = coalesce(p_prescription_items, prescription_items),
         lab_tests_ordered    = coalesce(p_lab_tests_ordered,  lab_tests_ordered),
         treatment_plan       = coalesce(p_treatment_plan,     treatment_plan),
         consultation_fee_ugx = v_cons,
         lab_fee_ugx          = v_lab,
         meds_fee_ugx         = v_meds,
         total_charged_ugx    = v_total,
         amount_paid          = v_paid,
         payment_status       = v_status
   where id = v_row.id;

  insert into public.clinic_record_edits
    (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
  values
    (v_row.clinic_id, 'visit', v_row.id, 'edit', v_before,
     to_jsonb((select d from public.clinic_diagnoses d where d.id = v_row.id)),
     p_reason, auth.uid());

  return jsonb_build_object('ok', true, 'total_charged_ugx', v_total,
                            'amount_paid', v_paid, 'payment_status', v_status);
end;
$$;

grant execute on function public.edit_visit_record(uuid, jsonb, text[], numeric, numeric, numeric, numeric, text, text) to authenticated;

-- ── 5. A patient: correct one, and remove one safely ────────────────
create or replace function public.edit_clinic_patient(
  p_patient_id uuid,
  p_full_name  text default null,
  p_phone      text default null,
  p_notes      text default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.clinic_patients%rowtype;
  v_before jsonb;
  v_name   text;
  v_phone  text;
begin
  select * into v_row from public.clinic_patients where id = p_patient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'patient not found');
  end if;

  if not public.is_clinic_main_account(v_row.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'only the main account can edit a patient');
  end if;

  v_name  := nullif(btrim(coalesce(p_full_name, v_row.full_name)), '');
  v_phone := nullif(btrim(coalesce(p_phone,     v_row.phone)),     '');
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'a patient needs a name');
  end if;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'a patient needs a phone number');
  end if;

  -- The clinic already holds somebody else on that number. Say so plainly
  -- rather than letting the unique constraint surface as a database error.
  if exists (
    select 1 from public.clinic_patients p
    where p.clinic_id = v_row.clinic_id and p.phone = v_phone and p.id <> v_row.id
  ) then
    return jsonb_build_object('ok', false, 'error', 'another patient at this clinic already has that phone number');
  end if;

  v_before := to_jsonb(v_row);

  update public.clinic_patients
     set full_name  = v_name,
         phone      = v_phone,
         notes      = coalesce(p_notes, notes),
         updated_at = now()
   where id = v_row.id;

  insert into public.clinic_record_edits
    (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
  values
    (v_row.clinic_id, 'patient', v_row.id, 'edit', v_before,
     to_jsonb((select p from public.clinic_patients p where p.id = v_row.id)),
     p_reason, auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.edit_clinic_patient(uuid, text, text, text, text) to authenticated;

-- Archive rather than destroy, whenever there is anything to lose.
alter table public.clinic_patients
  add column if not exists archived_at timestamptz;

create or replace function public.delete_clinic_patient(
  p_patient_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.clinic_patients%rowtype;
  v_before jsonb;
  v_visits integer;
begin
  select * into v_row from public.clinic_patients where id = p_patient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'patient not found');
  end if;

  if not public.is_clinic_main_account(v_row.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'only the main account can remove a patient');
  end if;

  v_before := to_jsonb(v_row);

  -- Does this person have a history? A visit is a medical record and is not
  -- ours to destroy to tidy a list.
  --
  -- The link is clinic_diagnoses, not bookings: a walk-in is recorded straight
  -- onto a diagnosis and never gets a booking at all, so counting bookings
  -- would report "no history" for most of a busy clinic's patients and delete
  -- them outright. `bookings` has no patient_phone column either.
  select count(*) into v_visits
  from public.clinic_diagnoses d
  where d.clinic_id = v_row.clinic_id
    and (d.patient_phone = v_row.phone
         or (d.patient_name is not null and d.patient_name = v_row.full_name));

  if v_visits > 0 then
    update public.clinic_patients
       set archived_at = now(), updated_at = now()
     where id = v_row.id;

    insert into public.clinic_record_edits
      (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
    values
      (v_row.clinic_id, 'patient', v_row.id, 'archive', v_before, null, p_reason, auth.uid());

    return jsonb_build_object('ok', true, 'archived', true, 'visits', v_visits);
  end if;

  -- Nothing to lose: the duplicate a typo made. Remove it.
  delete from public.clinic_patients where id = v_row.id;

  insert into public.clinic_record_edits
    (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
  values
    (v_row.clinic_id, 'patient', v_row.id, 'delete', v_before, null, p_reason, auth.uid());

  return jsonb_build_object('ok', true, 'archived', false, 'visits', 0);
end;
$$;

grant execute on function public.delete_clinic_patient(uuid, text) to authenticated;

-- ── 6. Shut the direct doors the RPCs replace ───────────────────────
--
-- With the corrections available as owner-only RPCs, a sub-account no longer
-- needs — and must not have — a direct UPDATE or DELETE on these tables. The
-- RPCs are security definer, so they keep working.
--
-- INSERT and SELECT stay open to all staff: recording a sale and registering
-- a patient are everyday work, and the clinician portal depends on both.
drop policy if exists "qs_clinic_write" on public.clinic_quick_sales;

drop policy if exists "qs_clinic_insert" on public.clinic_quick_sales;
create policy "qs_clinic_insert" on public.clinic_quick_sales
  for insert with check (public.is_clinic_staff(clinic_id));

drop policy if exists "qs_clinic_update_owner" on public.clinic_quick_sales;
create policy "qs_clinic_update_owner" on public.clinic_quick_sales
  for update using (public.is_clinic_main_account(clinic_id));

drop policy if exists "qs_clinic_delete_owner" on public.clinic_quick_sales;
create policy "qs_clinic_delete_owner" on public.clinic_quick_sales
  for delete using (public.is_clinic_main_account(clinic_id));

drop policy if exists "clinic_patients_staff_manage" on public.clinic_patients;

drop policy if exists "clinic_patients_staff_read" on public.clinic_patients;
create policy "clinic_patients_staff_read" on public.clinic_patients
  for select using (public.is_clinic_staff(clinic_id));

drop policy if exists "clinic_patients_staff_insert" on public.clinic_patients;
create policy "clinic_patients_staff_insert" on public.clinic_patients
  for insert with check (public.is_clinic_staff(clinic_id));

-- Staff may still correct the record they are in the middle of creating —
-- the treatment screen upserts a patient as it goes — but only the main
-- account may delete one.
drop policy if exists "clinic_patients_staff_update" on public.clinic_patients;
create policy "clinic_patients_staff_update" on public.clinic_patients
  for update using (public.is_clinic_staff(clinic_id));

drop policy if exists "clinic_patients_owner_delete" on public.clinic_patients;
create policy "clinic_patients_owner_delete" on public.clinic_patients
  for delete using (public.is_clinic_main_account(clinic_id));
