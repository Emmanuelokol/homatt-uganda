-- ════════════════════════════════════════════════════════════════════
-- Fix: clinic settings save — ensure portal staff can update their clinic
-- ────────────────────────────────────────────────────────────────────
-- The existing policy "Admin can manage clinics" (`for all using (true)`)
-- is broad and works, but PostgREST sometimes drops permissive `for all`
-- policies applied through PUBLIC when a more specific `to authenticated`
-- policy is also present for the same operation.
--
-- This adds a scoped UPDATE + SELECT policy for authenticated clinic
-- staff (matched via portal_users) so saves are never silently rejected.
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- Allow portal staff to read their own clinic (even if active = false)
drop policy if exists "clinic_staff_read_own" on public.clinics;
create policy "clinic_staff_read_own" on public.clinics
  for select
  to authenticated
  using (
    id in (
      select pu.clinic_id
      from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
    )
  );

-- Allow portal staff to update ONLY their own clinic's row
drop policy if exists "clinic_staff_update_own" on public.clinics;
create policy "clinic_staff_update_own" on public.clinics
  for update
  to authenticated
  using (
    id in (
      select pu.clinic_id
      from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
    )
  )
  with check (
    id in (
      select pu.clinic_id
      from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
    )
  );

-- Verify the policies are in place
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'clinics'
order by policyname;
