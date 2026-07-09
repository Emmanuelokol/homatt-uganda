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
