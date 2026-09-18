-- ============================================================
-- Homatt Health — activate / deactivate clinic staff (owner only)
--
-- Lets a clinic owner switch a staff account off (staff member leaves)
-- and back on, from the portal's Settings page. Deactivated accounts
-- fail the portal's is_active checks everywhere, so they can no longer
-- use the clinic portal even though the login still exists.
--
-- Safeguards: owner-only, same clinic only, cannot deactivate yourself,
-- cannot deactivate the clinic's only active owner.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create or replace function public.set_staff_active(
  p_target_id uuid,
  p_active    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id     uuid;
  v_is_owner      boolean;
  v_target_clinic uuid;
  v_target_self   boolean;
  v_target_owner  boolean;
  v_owner_count   int;
begin
  -- Caller must be an active owner
  select pu.clinic_id, (coalesce(pu.staff_role, 'owner') = 'owner')
    into v_clinic_id, v_is_owner
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic_id is null or coalesce(v_is_owner, false) = false then
    return jsonb_build_object('ok', false, 'error', 'only owners can change staff access');
  end if;

  -- Target must be in the same clinic
  select pu.clinic_id,
         (pu.auth_user_id = auth.uid()),
         (coalesce(pu.staff_role, 'owner') = 'owner' and pu.is_active)
    into v_target_clinic, v_target_self, v_target_owner
    from public.portal_users pu
   where pu.id = p_target_id;

  if v_target_clinic is null or v_target_clinic <> v_clinic_id then
    return jsonb_build_object('ok', false, 'error', 'staff member not in your clinic');
  end if;

  if coalesce(v_target_self, false) and p_active = false then
    return jsonb_build_object('ok', false, 'error', 'you cannot deactivate your own account');
  end if;

  -- Never deactivate the clinic's only active owner
  if p_active = false and coalesce(v_target_owner, false) then
    select count(*) into v_owner_count
      from public.portal_users
     where clinic_id = v_clinic_id
       and coalesce(staff_role, 'owner') = 'owner'
       and is_active = true;
    if v_owner_count <= 1 then
      return jsonb_build_object('ok', false,
        'error', 'cannot deactivate the clinic''s only owner');
    end if;
  end if;

  update public.portal_users
     set is_active = p_active
   where id = p_target_id;

  return jsonb_build_object('ok', true, 'id', p_target_id, 'active', p_active);
end;
$$;

grant execute on function public.set_staff_active(uuid, boolean) to authenticated;
