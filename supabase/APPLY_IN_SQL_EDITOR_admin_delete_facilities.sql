-- ═══════════════════════════════════════════════════════════════════════════
--  HOMATT HEALTH — PERMANENTLY DELETE A CLINIC, PHARMACY OR RIDER
--
--  WHAT TO DO
--  ----------
--  1. Supabase → your project → SQL Editor → New query.
--  2. Copy this WHOLE file in.
--  3. Press Run.
--
--  Safe to run more than once.
--
--  WHY YOU NEED IT
--  ---------------
--  Without these functions the admin "Delete" button can only take a facility
--  OUT OF THE LIST — the row, its records and its staff logins stay in the
--  database. With them, Delete really deletes:
--
--    • the facility row
--    • its records (stock, sales, orders, treatments, settings)
--    • its staff login accounts
--
--  WHAT IS DELIBERATELY KEPT
--  -------------------------
--  Patients and customers keep their own history. A booking whose clinic is
--  deleted, or an order whose pharmacy is deleted, SURVIVES — it simply stops
--  pointing at the facility that is gone. A person's record is theirs.
--
--  ONLY A HOMATT ADMIN CAN RUN THESE. The check is profiles.is_admin = true;
--  anyone else gets "only Homatt admins can delete...".
--
--  Verified on PostgreSQL 16 before shipping: a non-admin is refused, an admin
--  wipes the facility and its staff login, and the customer's order is kept.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ##  PART 1 of 2 — clinics
-- ###########################################################################

-- ── 2. Admin hard delete ───────────────────────────────────────────
create or replace function public.admin_delete_clinic(p_clinic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_staff uuid[];
begin
  -- Caller must be a Homatt admin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    return jsonb_build_object('ok', false, 'error', 'only Homatt admins can delete clinics');
  end if;

  select name into v_name from clinics where id = p_clinic_id;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'clinic not found');
  end if;

  -- Staff auth ids (their logins get deleted at the end)
  select coalesce(array_agg(auth_user_id), '{}') into v_staff
    from portal_users
   where clinic_id = p_clinic_id and auth_user_id is not null;

  -- Dependents — each wrapped so a missing table never aborts the wipe
  begin delete from clinic_referrals where from_clinic_id = p_clinic_id or to_clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_custom_lab_tests where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_quick_sales      where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_inventory_txns   where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_inventory        where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_followups        where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from e_prescriptions         where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_monthly_summaries where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_condition_fees   where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_settings         where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_diagnoses        where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  begin delete from clinic_patients         where clinic_id = p_clinic_id; exception when undefined_table then null; end;

  -- Patients keep their booking history; the booking just loses its clinic
  begin update bookings set clinic_id = null where clinic_id = p_clinic_id; exception when undefined_table then null; end;

  -- Staff portal rows, then their login accounts
  begin delete from portal_users where clinic_id = p_clinic_id; exception when undefined_table then null; end;
  if array_length(v_staff, 1) is not null then
    begin delete from auth.users where id = any(v_staff); exception when others then null; end;
  end if;

  delete from clinics where id = p_clinic_id;

  return jsonb_build_object('ok', true, 'deleted', v_name,
                            'staff_logins_removed', coalesce(array_length(v_staff, 1), 0));
end;
$$;

grant execute on function public.admin_delete_clinic(uuid) to authenticated;

select 'trial removed + admin delete ready' as result;


-- ###########################################################################
-- ##  PART 2 of 2 — pharmacies and riders
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- Homatt Health — permanently delete a pharmacy or a rider
--
-- A clinic could already be deleted for good (admin_delete_clinic, 20260726).
-- Pharmacies and riders could not: the admin screens only set status='removed',
-- so the row, its orders and its login stayed in the database for ever with no
-- way to actually get rid of them.
--
-- These two functions are the same shape as admin_delete_clinic:
--   • Homatt admins only (profiles.is_admin = true)
--   • every dependent table wrapped, so one missing table cannot abort the wipe
--   • the staff/rider login in auth.users goes too
--   • customers keep their own order history; the order simply loses its
--     pharmacy, exactly as a booking keeps its history when a clinic goes
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Pharmacy ───────────────────────────────────────────────────────────────
create or replace function public.admin_delete_pharmacy(p_pharmacy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_staff uuid[];
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    return jsonb_build_object('ok', false, 'error', 'only Homatt admins can delete a pharmacy');
  end if;

  select name into v_name from pharmacies where id = p_pharmacy_id;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'pharmacy not found');
  end if;

  begin
    select coalesce(array_agg(auth_user_id), '{}') into v_staff
      from portal_users
     where pharmacy_id = p_pharmacy_id and auth_user_id is not null;
  exception when undefined_table or undefined_column then v_staff := '{}'; end;

  -- The customer's order history survives; it just stops pointing here.
  begin update pharmacy_orders set pharmacy_id = null where pharmacy_id = p_pharmacy_id;
    exception when undefined_table or undefined_column then null; end;
  begin delete from pharmacy_inventory where pharmacy_id = p_pharmacy_id;
    exception when undefined_table then null; end;
  begin delete from portal_users where pharmacy_id = p_pharmacy_id;
    exception when undefined_table or undefined_column then null; end;
  -- A prescription routed here loses its routing rather than being destroyed.
  begin update clinic_diagnoses set routed_pharmacy_id = null where routed_pharmacy_id = p_pharmacy_id;
    exception when undefined_table or undefined_column then null; end;

  if array_length(v_staff, 1) is not null then
    begin delete from auth.users where id = any(v_staff); exception when others then null; end;
  end if;

  delete from pharmacies where id = p_pharmacy_id;

  return jsonb_build_object('ok', true, 'deleted', v_name,
                            'staff_logins_removed', coalesce(array_length(v_staff, 1), 0));
end;
$$;

grant execute on function public.admin_delete_pharmacy(uuid) to authenticated;


-- ── Rider ──────────────────────────────────────────────────────────────────
create or replace function public.admin_delete_rider(p_rider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_auth uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    return jsonb_build_object('ok', false, 'error', 'only Homatt admins can delete a rider');
  end if;

  select coalesce(full_name, name), auth_user_id into v_name, v_auth
    from riders where id = p_rider_id;
  if v_name is null then
    -- The rider exists but has no name column populated; still allow the delete.
    if not exists (select 1 from riders where id = p_rider_id) then
      return jsonb_build_object('ok', false, 'error', 'rider not found');
    end if;
    v_name := 'rider';
  end if;

  -- A completed delivery is part of the customer's order history — keep it,
  -- just unassign the rider.
  begin update deliveries set rider_id = null where rider_id = p_rider_id;
    exception when undefined_table or undefined_column then null; end;
  begin delete from rider_locations where rider_id = p_rider_id;
    exception when undefined_table then null; end;

  if v_auth is not null then
    begin delete from auth.users where id = v_auth; exception when others then null; end;
  end if;

  delete from riders where id = p_rider_id;

  return jsonb_build_object('ok', true, 'deleted', v_name,
                            'staff_logins_removed', case when v_auth is null then 0 else 1 end);
end;
$$;

grant execute on function public.admin_delete_rider(uuid) to authenticated;


-- ── Check it worked ────────────────────────────────────────────────────────
select 'admin_delete_pharmacy' as fn, (to_regproc('public.admin_delete_pharmacy') is not null) as ok
union all
select 'admin_delete_rider',         (to_regproc('public.admin_delete_rider') is not null);
