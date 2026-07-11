-- ============================================================
-- Homatt Health — add the "salesperson" (drug shop) staff role
--
-- Drug shops (and clinics with a front-shop attendant) need an account
-- that can ONLY do quick sales and manage stock — no consultations,
-- no patient history, no finances, no settings. This adds that role.
--
-- Drug shops that ALSO treat patients just use the existing 'clinician'
-- role, which already includes consultations plus quick sale + stock.
--
-- Only widens the allowed set — no existing role/account is affected.
-- Idempotent — safe to run multiple times.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'portal_users_staff_role_check'
  ) then
    alter table public.portal_users drop constraint portal_users_staff_role_check;
  end if;
  alter table public.portal_users
    add constraint portal_users_staff_role_check
    check (staff_role in ('owner','clinician','nurse','receptionist','salesperson'));
end $$;

-- The role-change RPC must accept the new role too (its validation list
-- is separate from the table constraint). Redefine just the check line
-- by recreating the function with salesperson included.
create or replace function public.set_staff_role(
  p_target_id uuid,
  p_role      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id   uuid;
  v_is_owner    boolean;
  v_target_clinic uuid;
  v_owner_count int;
begin
  if p_role not in ('owner','clinician','nurse','receptionist','salesperson') then
    return jsonb_build_object('ok', false, 'error', 'invalid role');
  end if;

  select pu.clinic_id, (coalesce(pu.staff_role, 'owner') = 'owner')
    into v_clinic_id, v_is_owner
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic_id is null or coalesce(v_is_owner, false) = false then
    return jsonb_build_object('ok', false, 'error', 'only owners can change roles');
  end if;

  select pu.clinic_id into v_target_clinic
    from public.portal_users pu
   where pu.id = p_target_id;

  if v_target_clinic is null or v_target_clinic <> v_clinic_id then
    return jsonb_build_object('ok', false, 'error', 'staff member not in your clinic');
  end if;

  if p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.portal_users
     where clinic_id = v_clinic_id
       and coalesce(staff_role, 'owner') = 'owner'
       and is_active = true;

    if v_owner_count <= 1
       and exists (
         select 1 from public.portal_users
          where id = p_target_id and coalesce(staff_role, 'owner') = 'owner'
       ) then
      return jsonb_build_object('ok', false,
        'error', 'cannot remove the clinic''s only owner');
    end if;
  end if;

  update public.portal_users
     set staff_role = p_role
   where id = p_target_id;

  return jsonb_build_object('ok', true, 'id', p_target_id, 'role', p_role);
end;
$$;

grant execute on function public.set_staff_role(uuid, text) to authenticated;
