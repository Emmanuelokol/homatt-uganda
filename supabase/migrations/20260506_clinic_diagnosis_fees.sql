-- Add fee/charge columns to clinic_diagnoses
-- Clinicians can record what was charged for consultation, labs, and meds.
-- All amounts are in UGX. Safe to run multiple times.

ALTER TABLE public.clinic_diagnoses
  ADD COLUMN IF NOT EXISTS consultation_fee_ugx  numeric  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_fee_ugx           numeric  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meds_fee_ugx          numeric  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_charged_ugx     numeric  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status        text     DEFAULT 'pending'
    CHECK (payment_status IN ('paid','pending','credit','waived'));

COMMENT ON COLUMN public.clinic_diagnoses.consultation_fee_ugx IS 'Consultation/doctor fee charged in UGX';
COMMENT ON COLUMN public.clinic_diagnoses.lab_fee_ugx          IS 'Total lab / diagnostic tests fee in UGX';
COMMENT ON COLUMN public.clinic_diagnoses.meds_fee_ugx         IS 'Medications dispensed from clinic stock in UGX';
COMMENT ON COLUMN public.clinic_diagnoses.total_charged_ugx    IS 'Total amount charged to the patient in UGX';
COMMENT ON COLUMN public.clinic_diagnoses.payment_status       IS 'Whether the bill has been paid, is pending, on credit, or waived';
