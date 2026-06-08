-- ============================================================
-- Homatt Health — Clinic staff roles & access control
--
-- Adds a fine-grained staff_role to portal_users so each clinic can
-- decide what every staff member may access in the portal:
--   • owner        — full access to everything
--   • clinician     — consultations, patient history, bookings, meds
--   • nurse         — same as clinician
--   • receptionist  — bookings, history, payments, quick sale (front desk)
--
-- The capability → section mapping lives in the client (clinic.js).
-- This migration only stores the role and gives owners the RPCs to
-- list staff and re-assign roles within their own clinic.
--
-- SAFE DEFAULT: existing accounts become 'owner' so nobody is locked
-- out. An owner then downgrades other staff from the Settings page.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── 1. The role column ──────────────────────────────────────
alter table public.portal_users
  add column if not exists staff_role text;

-- Backfill: anyone without an explicit role becomes an owner (full access)
update public.portal_users
   set staff_role = 'owner'
 where staff_role is null;

alter table public.portal_users
  alter column staff_role set default 'owner';

-- Constrain to the known roles (drop old constraint first if present)
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'portal_users_staff_role_check'
  ) then
    alter table public.portal_users drop constraint portal_users_staff_role_check;
  end if;
  alter table public.portal_users
    add constraint portal_users_staff_role_check
    check (staff_role in ('owner','clinician','nurse','receptionist'));
end $$;

comment on column public.portal_users.staff_role is
  'Fine-grained clinic portal role controlling which sections this staff member can access.';

-- ── 2. RPC: list staff in the caller''s clinic (owner only) ──
create or replace function public.get_clinic_staff()
returns table (
  id           uuid,
  full_name    text,
  email        text,
  staff_role   text,
  is_active    boolean,
  is_self      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_is_owner  boolean;
begin
  -- Resolve the caller''s clinic + ownership
  select pu.clinic_id, (pu.staff_role = 'owner')
    into v_clinic_id, v_is_owner
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic_id is null or coalesce(v_is_owner, false) = false then
    return;  -- non-owners get an empty set
  end if;

  return query
    select
      pu.id,
      pu.full_name,
      pu.email,
      coalesce(pu.staff_role, 'owner') as staff_role,
      coalesce(pu.is_active, true)     as is_active,
      (pu.auth_user_id = auth.uid())   as is_self
    from public.portal_users pu
   where pu.clinic_id = v_clinic_id
   order by (pu.auth_user_id = auth.uid()) desc, pu.full_name nulls last;
end;
$$;

grant execute on function public.get_clinic_staff() to authenticated;

-- ── 3. RPC: set a staff member''s role (owner only, same clinic) ──
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
  if p_role not in ('owner','clinician','nurse','receptionist') then
    return jsonb_build_object('ok', false, 'error', 'invalid role');
  end if;

  -- Caller must be an active owner
  select pu.clinic_id, (pu.staff_role = 'owner')
    into v_clinic_id, v_is_owner
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic_id is null or coalesce(v_is_owner, false) = false then
    return jsonb_build_object('ok', false, 'error', 'only owners can change roles');
  end if;

  -- Target must be in the same clinic
  select pu.clinic_id into v_target_clinic
    from public.portal_users pu
   where pu.id = p_target_id;

  if v_target_clinic is null or v_target_clinic <> v_clinic_id then
    return jsonb_build_object('ok', false, 'error', 'staff member not in your clinic');
  end if;

  -- Never allow removing the last owner (avoid locking the clinic out)
  if p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.portal_users
     where clinic_id = v_clinic_id
       and staff_role = 'owner'
       and is_active = true;

    if v_owner_count <= 1
       and exists (
         select 1 from public.portal_users
          where id = p_target_id and staff_role = 'owner'
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

-- Refresh PostgREST so the new RPCs are callable immediately
notify pgrst, 'reload schema';
