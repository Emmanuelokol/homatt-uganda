-- ============================================================
-- Homatt Health — staff sub-accounts can read their clinic's records
--
-- Visit history in the consultation wizard reads clinic_diagnoses
-- (via the patient_full_history view). If the table's RLS was written
-- owner-centric (clinics.auth_user_id = auth.uid()), staff sub-accounts
-- (clinician/nurse/receptionist) see NOTHING even for their own clinic.
-- Policies are OR'd, so these ADDITIVE permissive policies can only
-- widen access — they change nothing if access already works.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'clinic_diagnoses' and policyname = 'clinic_staff_select') then
    create policy clinic_staff_select on public.clinic_diagnoses
      for select using (
        clinic_id in (select pu.clinic_id from public.portal_users pu
                       where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;
exception when undefined_table then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'clinic_patients' and policyname = 'clinic_staff_select') then
    create policy clinic_staff_select on public.clinic_patients
      for select using (
        clinic_id in (select pu.clinic_id from public.portal_users pu
                       where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;
exception when undefined_table then null;
end $$;

select 'staff history access ready' as result;
