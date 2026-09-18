-- ============================================================
-- Homatt Health — patient search that works for EVERY staff role
--
-- The consultation wizard's patient search queried profiles and
-- clinic_patients directly; row-level security let the OWNER see them
-- but gave sub-accounts (clinician/nurse/receptionist) empty results —
-- "the memory is not there". This security-definer RPC verifies the
-- caller is ACTIVE staff of a clinic, then searches by phone OR name:
--   • the caller's clinic's own patient book (clinic_patients)
--   • registered Homatt app users (profiles)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create or replace function public.search_clinic_patients(p_q text)
returns table (
  profile_id        uuid,
  clinic_patient_id uuid,
  full_name         text,
  phone             text,
  registered        boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_q text := trim(coalesce(p_q, ''));
begin
  -- Caller must be active staff (any role) of a clinic
  select pu.clinic_id into v_clinic
    from portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic is null or length(v_q) < 2 then
    return;
  end if;

  -- Registered Homatt app users, matched by phone or name
  return query
  select p.id,
         null::uuid,
         nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
         coalesce(p.phone_number, p.phone),
         true
    from profiles p
   where coalesce(p.phone_number, p.phone) ilike '%' || v_q || '%'
      or (coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) ilike '%' || v_q || '%'
   limit 5;

  -- This clinic's own patient book (walk-ins registered at the desk)
  return query
  select null::uuid,
         cp.id,
         cp.full_name,
         cp.phone,
         false
    from clinic_patients cp
   where cp.clinic_id = v_clinic
     and (cp.phone ilike '%' || v_q || '%' or cp.full_name ilike '%' || v_q || '%')
   limit 5;
end;
$$;

grant execute on function public.search_clinic_patients(text) to authenticated;

select 'staff patient search ready' as result;
