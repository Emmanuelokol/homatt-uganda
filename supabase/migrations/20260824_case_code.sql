-- ── Case number on every consultation ─────────────────────────────────────
-- The label the clinic says out loud, e.g. #001M2208O
--     001   the visit's number for this clinic that day
--     M     first letter of the diagnosis (M for Malaria)
--     2208  day and month
--     O     Outpatient (I for Inpatient)
--
-- It lets a walk-in be identified, treated and billed BEFORE anyone has taken
-- a name or a phone number. Those are filled in later; the case number never
-- changes. The app writes it when present and saves without it when absent,
-- so running this is safe at any time and nothing breaks before you do.

alter table public.clinic_diagnoses
  add column if not exists case_code text;

comment on column public.clinic_diagnoses.case_code is
  'Human-quotable case number, e.g. #001M2208O — seq + diagnosis initial + DDMM + O/I. Assigned once, never regenerated.';

-- One case number per clinic. Partial, so the many rows recorded before this
-- column existed (all null) do not collide with each other.
create unique index if not exists idx_clinic_dx_case_code
  on public.clinic_diagnoses (clinic_id, case_code)
  where case_code is not null;

-- Finding a patient by the number they were given at the door.
create index if not exists idx_clinic_dx_case_code_lookup
  on public.clinic_diagnoses (case_code)
  where case_code is not null;

-- ── Check it worked ───────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'clinic_diagnoses'
   and column_name = 'case_code';
