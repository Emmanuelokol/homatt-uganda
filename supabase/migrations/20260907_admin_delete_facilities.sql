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
