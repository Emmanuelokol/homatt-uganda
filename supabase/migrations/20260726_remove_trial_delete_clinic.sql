-- ============================================================
-- Homatt Health — remove free onboarding + admin hard-delete clinic
--
-- 1. The 30-day free period is retired: no more default trial on new
--    clinics, all existing trials cleared. Tiers apply from day one.
-- 2. admin_delete_clinic(p_clinic_id): Homatt-admin-only PERMANENT
--    delete — removes the clinic's records, referrals, inventory,
--    sales, staff rows AND the staff auth logins, detaches patient
--    bookings (patients keep their own booking history), then deletes
--    the clinic row. Every dependent table is handled defensively so
--    the function works on any deployment state.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── 1. Retire the trial ────────────────────────────────────────────
alter table public.clinics alter column trial_ends_at set default null;
update public.clinics set trial_ends_at = null where trial_ends_at is not null;

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
