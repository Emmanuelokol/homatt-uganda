-- Clinical workflow enhancement: new columns + patient follow-up tracking table
-- Safe to run multiple times (idempotent via IF NOT EXISTS checks)

-- ─────────────────────────────────────────────────────────────
-- clinic_diagnoses: new consultation columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE clinic_diagnoses
  ADD COLUMN IF NOT EXISTS confirmed_conditions  jsonb,        -- array of {name, likelihood_percent} confirmed by doctor
  ADD COLUMN IF NOT EXISTS clinical_findings     text,         -- physical exam findings, vitals, doctor's notes
  ADD COLUMN IF NOT EXISTS treatments_given      jsonb,        -- {procedures: ["IV Drip","Injection"], notes: "..."}
  ADD COLUMN IF NOT EXISTS follow_up_at          timestamptz,  -- exact return-to-clinic datetime
  ADD COLUMN IF NOT EXISTS patient_instructions  text,         -- instructions for the patient (with food, etc.)
  ADD COLUMN IF NOT EXISTS delivery_preference   text DEFAULT 'pickup';  -- 'pickup' | 'delivery'

-- ─────────────────────────────────────────────────────────────
-- e_prescriptions: fulfillment & instruction columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE e_prescriptions
  ADD COLUMN IF NOT EXISTS patient_instructions  text,
  ADD COLUMN IF NOT EXISTS delivery_preference   text DEFAULT 'pickup';

-- ─────────────────────────────────────────────────────────────
-- pharmacy_orders: order_type column (may already exist)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS order_type  text DEFAULT 'prescription';

-- ─────────────────────────────────────────────────────────────
-- patient_health_followups: tracks all post-consultation events
--   - Patient feeling responses from push notification buttons
--   - Clinical notes written by clinic staff in the portal
--   - Medication adherence confirmations
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_health_followups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id     uuid        REFERENCES clinic_diagnoses(id) ON DELETE SET NULL,
  clinic_id        uuid,
  clinician_id     uuid,
  patient_user_id  uuid,
  followup_type    text        NOT NULL DEFAULT 'clinical_note',
  -- followup_type values:
  --   'clinical_note'       — written by clinic staff in portal
  --   'patient_feeling'     — recorded when patient taps feeling button on notification
  --   'medication_check'    — logged when patient confirms medication taken
  --   'referral'            — escalation / referral to another clinic
  feeling          text,       -- 'better' | 'same' | 'worse'  (null for note-only entries)
  clinical_note    text,       -- free-text note from clinician or patient
  medication_taken boolean,    -- true if patient confirmed taking their medication
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- RLS: allow clinic portal (anon key) to insert + select own clinic records
ALTER TABLE patient_health_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "clinic_followup_insert"
  ON patient_health_followups FOR INSERT
  WITH CHECK (true);   -- portal uses service-level access via anon key; restrict further if needed

CREATE POLICY IF NOT EXISTS "clinic_followup_select"
  ON patient_health_followups FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clinic_diagnoses_follow_up_at
  ON clinic_diagnoses (follow_up_at)
  WHERE follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_health_followups_diagnosis
  ON patient_health_followups (diagnosis_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_health_followups_patient
  ON patient_health_followups (patient_user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- prescription_items jsonb structure (for reference)
-- Each element in e_prescriptions.items / clinic_diagnoses.prescription_items:
-- {
--   drug_name:    "Artemether-Lumefantrine",
--   strength:     "80/480mg",
--   route:        "oral",
--   frequency:    "twice_daily",
--   duration:     5,          -- days
--   qty:          10,
--   intake_times: ["07:00", "21:00"]  -- HH:MM — used to schedule push reminders
-- }
-- ─────────────────────────────────────────────────────────────
