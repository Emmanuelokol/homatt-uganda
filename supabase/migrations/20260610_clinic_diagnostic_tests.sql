-- Add diagnostic_tests column to clinics for the new Services section
-- Safe to run multiple times.
alter table public.clinics
  add column if not exists diagnostic_tests jsonb default '[]';

select 'diagnostic_tests column ready' as result;
