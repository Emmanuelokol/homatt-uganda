-- ============================================================
-- Homatt Health — clinic-specific custom lab tests
--
-- Clinicians add missing lab tests RIGHT INSIDE the consultation
-- wizard (works offline via the outbox; client-generated ids make
-- replays idempotent). This replaces managing the test list from the
-- Clinic Profile page.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create table if not exists public.clinic_custom_lab_tests (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  test_name  text not null,
  created_at timestamptz default now()
);

-- One entry per clinic per test (case-insensitive)
create unique index if not exists idx_clinic_custom_lab_tests_name
  on public.clinic_custom_lab_tests (clinic_id, lower(test_name));

alter table public.clinic_custom_lab_tests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'clinic_custom_lab_tests' and policyname = 'clinic_staff_rw') then
    create policy clinic_staff_rw on public.clinic_custom_lab_tests
      for all using (
        clinic_id in (
          select pu.clinic_id from public.portal_users pu
           where pu.auth_user_id = auth.uid() and pu.is_active = true
        )
      ) with check (
        clinic_id in (
          select pu.clinic_id from public.portal_users pu
           where pu.auth_user_id = auth.uid() and pu.is_active = true
        )
      );
  end if;
end $$;

select 'custom lab tests ready' as result;
