-- app_config: key-value store for admin-configurable settings
-- Used by: admin/followups.html to persist follow-up rules + message templates
-- Safe to run multiple times (idempotent)

CREATE TABLE IF NOT EXISTS app_config (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default follow-up rules (inserted only if not already present)
INSERT INTO app_config (key, value)
VALUES (
  'followup_rules',
  '{
    "enabled":        true,
    "medReminders":   true,
    "midCourseDay":   3,
    "postCourseDays": 1,
    "escalateAt":     1,
    "referralClinic": "Mulago National Referral Hospital",
    "dailyCap":       10,
    "apptDayBefore":  true,
    "apptDayOf":      true
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_config (key, value)
VALUES (
  'followup_templates',
  '{
    "midCourse":    "You are on day {days} of your {drug} course. How are you feeling so far?",
    "endCourse":    "Your {days}-day course of {drug} is now complete. How are you feeling?",
    "escalate":     "We are concerned about your health. Please visit {referral} as soon as possible for specialist care. Your health matters to us.",
    "sameResponse": "Keep taking your medication as prescribed. If you do not feel better in 2 days, please visit {clinic}."
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- RLS: admin portal reads/writes via anon key
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "app_config_read"   ON app_config FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "app_config_write"  ON app_config FOR ALL    USING (true) WITH CHECK (true);

-- patient_health_followups: created in previous migration, ensure table exists
-- (this file is safe to run independently or alongside 20260421_clinical_workflow_columns.sql)
CREATE TABLE IF NOT EXISTS patient_health_followups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id     uuid        REFERENCES clinic_diagnoses(id) ON DELETE SET NULL,
  clinic_id        uuid,
  clinician_id     uuid,
  patient_user_id  uuid,
  followup_type    text        NOT NULL DEFAULT 'clinical_note',
  feeling          text,
  clinical_note    text,
  medication_taken boolean,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE patient_health_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "followup_insert" ON patient_health_followups FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "followup_select" ON patient_health_followups FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_phf_diagnosis ON patient_health_followups (diagnosis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phf_patient   ON patient_health_followups (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phf_feeling   ON patient_health_followups (feeling) WHERE feeling IS NOT NULL;
