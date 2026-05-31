-- Adds a free-text follow-up reason to clinic_diagnoses so clinicians can
-- record WHY a patient should return (e.g. "Review BP & refill Amlodipine",
-- "Re-check malaria smear", "Wound dressing change").
--
-- The follow-up DATE is already derivable from (created_at + follow_up_days),
-- but the reason was previously buried in patient_instructions. This adds
-- a dedicated column so it can be surfaced in the Active Treatments view.

alter table clinic_diagnoses
  add column if not exists follow_up_reason text;

comment on column clinic_diagnoses.follow_up_reason is
  'Free-text reason for the follow-up visit (e.g. "Review BP & refill"). '
  'Shown alongside the computed follow-up date in the clinic Active Treatments list.';
