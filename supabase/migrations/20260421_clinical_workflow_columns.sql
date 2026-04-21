-- Clinical workflow enhancement: new columns for comprehensive consultation data
-- Safe to run multiple times (idempotent via IF NOT EXISTS checks)

-- clinic_diagnoses: confirmed conditions list, clinical findings, exact follow-up datetime,
--                   patient instructions, delivery preference
ALTER TABLE clinic_diagnoses
  ADD COLUMN IF NOT EXISTS confirmed_conditions  jsonb,
  ADD COLUMN IF NOT EXISTS clinical_findings     text,
  ADD COLUMN IF NOT EXISTS follow_up_at          timestamptz,
  ADD COLUMN IF NOT EXISTS patient_instructions  text,
  ADD COLUMN IF NOT EXISTS delivery_preference   text DEFAULT 'pickup';

-- e_prescriptions: patient instructions + fulfillment preference per prescription
ALTER TABLE e_prescriptions
  ADD COLUMN IF NOT EXISTS patient_instructions  text,
  ADD COLUMN IF NOT EXISTS delivery_preference   text DEFAULT 'pickup';

-- pharmacy_orders: order_type may already exist; add if missing
ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS order_type  text DEFAULT 'prescription';

-- Index for querying by follow-up date (clinic can list upcoming follow-ups)
CREATE INDEX IF NOT EXISTS idx_clinic_diagnoses_follow_up_at
  ON clinic_diagnoses (follow_up_at)
  WHERE follow_up_at IS NOT NULL;

-- Comment explaining intake_times inside prescription_items jsonb:
-- Each item in prescription_items is:
-- {
--   drug_name, strength, route, frequency, duration, qty,
--   intake_times: ["07:00", "13:00", "21:00"]   -- HH:MM strings set by the clinician
-- }
-- The app uses intake_times to schedule OneSignal push notifications via send-notification
-- edge function with send_after = today+day at HH:MM for each day of the medication course.
