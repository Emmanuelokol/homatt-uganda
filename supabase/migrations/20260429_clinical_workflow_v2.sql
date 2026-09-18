-- ════════════════════════════════════════════════════════════════════
-- Clinical Workflow v2
-- Adds the full consultation flow:
--   patient lookup → AI diagnoses (3) → nurse confirms → inpatient/outpatient
--   → medications with intake times → e-prescription → push follow-ups
-- ════════════════════════════════════════════════════════════════════

-- ── clinic_diagnoses: new workflow columns ────────────────────────
ALTER TABLE public.clinic_diagnoses
  ADD COLUMN IF NOT EXISTS patient_phone        text,             -- for walk-in patients without Homatt account
  ADD COLUMN IF NOT EXISTS clinic_patient_id    uuid REFERENCES public.clinic_patients(id),
  ADD COLUMN IF NOT EXISTS ai_diagnoses         jsonb DEFAULT '[]', -- [{name, likelihood_percent, icd10, urgency}] × 3
  ADD COLUMN IF NOT EXISTS ai_source            text DEFAULT 'app', -- 'app'|'clinic_input'
  ADD COLUMN IF NOT EXISTS patient_type         text DEFAULT 'outpatient'
                                                CHECK (patient_type IN ('inpatient','outpatient')),
  ADD COLUMN IF NOT EXISTS ward                 text,             -- inpatient: ward/bed
  ADD COLUMN IF NOT EXISTS lab_results          text,             -- free-text lab findings
  ADD COLUMN IF NOT EXISTS expected_recovery    date,             -- when patient should be well
  ADD COLUMN IF NOT EXISTS intake_schedule      jsonb DEFAULT '[]';
  -- intake_schedule element shape:
  -- { drug_name, dosage, times_per_day, intake_times: ["08:00","20:00"], duration_days }

-- ── e_prescriptions: delivery confirmation tracking ──────────────
ALTER TABLE public.e_prescriptions
  ADD COLUMN IF NOT EXISTS clinic_patient_id       uuid REFERENCES public.clinic_patients(id),
  ADD COLUMN IF NOT EXISTS delivery_method         text DEFAULT 'pickup'
                                                   CHECK (delivery_method IN ('pickup','delivery')),
  ADD COLUMN IF NOT EXISTS delivery_confirmed      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS push_sent_at            timestamptz;

-- ── clinic_followups: intake_time for per-dose reminders ─────────
ALTER TABLE public.clinic_followups
  ADD COLUMN IF NOT EXISTS intake_time text,    -- "08:00" — the specific daily slot this reminder fires for
  ADD COLUMN IF NOT EXISTS day_number  integer, -- which day of the course (day 1 = start date)
  ADD COLUMN IF NOT EXISTS diagnosis_id uuid REFERENCES public.clinic_diagnoses(id) ON DELETE CASCADE;

-- Allow 'medication' as a follow-up type (for per-dose reminders)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clinic_followups_type_check'
  ) THEN
    ALTER TABLE public.clinic_followups DROP CONSTRAINT clinic_followups_type_check;
  END IF;
END $$;

ALTER TABLE public.clinic_followups
  ADD CONSTRAINT clinic_followups_type_check
  CHECK (type IN ('check_in','refill','course_complete','medication','delivery_confirmation'));

-- Index for the cron job that sends due reminders
CREATE INDEX IF NOT EXISTS idx_clinic_followups_diagnosis
  ON public.clinic_followups (diagnosis_id) WHERE diagnosis_id IS NOT NULL;

-- ── Index: find pending delivery confirmations quickly ───────────
CREATE INDEX IF NOT EXISTS idx_epx_delivery_unconfirmed
  ON public.e_prescriptions (created_at)
  WHERE delivery_confirmed = false AND status = 'active';

-- ── Index: clinic orders by patient_phone for walk-ins ───────────
CREATE INDEX IF NOT EXISTS idx_clinic_dx_phone
  ON public.clinic_diagnoses (patient_phone)
  WHERE patient_phone IS NOT NULL;

COMMENT ON COLUMN public.clinic_diagnoses.ai_diagnoses
  IS 'Top-3 AI suggested diagnoses: [{name,likelihood_percent,icd10,urgency}]';
COMMENT ON COLUMN public.clinic_diagnoses.intake_schedule
  IS 'Per-drug medication schedule: [{drug_name,dosage,times_per_day,intake_times,duration_days}]';
