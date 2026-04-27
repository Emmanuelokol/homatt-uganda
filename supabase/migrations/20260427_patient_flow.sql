-- ═══════════════════════════════════════════════════════════════════════════
-- Homatt Health — Patient Flow & Clinical Notifications schema
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds:
--   • doctor_prescriptions          full clinician prescription record
--   • clinic_settings               per-clinic settings (operating hours, etc.)
--   • medication_schedules          one row per scheduled dose reminder
--   • health_checkins               patient response to "how do you feel?"
-- ═══════════════════════════════════════════════════════════════════════════

-- ── doctor_prescriptions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_prescriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rx_id                   TEXT UNIQUE,
  booking_code            TEXT,
  patient_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  patient_name            TEXT NOT NULL,
  patient_age             INTEGER,
  patient_sex             TEXT,

  -- AI assessment
  ai_diagnoses            JSONB,            -- array of top-3 diagnoses
  ai_diagnosis_selected   TEXT,             -- which one the doctor opened
  ai_diagnosis_confirmed  BOOLEAN DEFAULT FALSE,
  ai_confirmed_level      TEXT CHECK (ai_confirmed_level IN ('yes','partial','no')),

  -- Clinician confirmed diagnosis after testing
  final_diagnosis         TEXT NOT NULL,
  modification_reason     TEXT,

  -- Patient classification
  patient_type            TEXT CHECK (patient_type IN ('inpatient','outpatient')) NOT NULL,
  ward_name               TEXT,
  bed_number              TEXT,
  admission_notes         TEXT,

  -- Medications: array of { generic_name, strength, frequency, times_per_day, dose_times, duration }
  drugs                   JSONB NOT NULL,

  -- Pharmacy routing
  rx_route                TEXT CHECK (rx_route IN ('clinic','partner')) DEFAULT 'clinic',
  partner_pharmacy        TEXT,
  delivery_choice         TEXT CHECK (delivery_choice IN ('pickup','deliver')),

  -- Recovery plan
  recovery_date           DATE,
  followup_date           DATE,
  recovery_notes          TEXT,
  special_instructions    TEXT,

  -- Doctor signature
  doctor_name             TEXT NOT NULL,
  doctor_license          TEXT NOT NULL,
  clinic_name             TEXT,
  digital_signature       TEXT,

  status                  TEXT DEFAULT 'issued',  -- issued | dispensed | completed | cancelled
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_rx_patient   ON doctor_prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_booking   ON doctor_prescriptions(booking_code);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_status    ON doctor_prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_doctor_rx_created   ON doctor_prescriptions(created_at DESC);

-- ── clinic_settings (operating hours, etc.) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS clinic_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name     TEXT NOT NULL,
  setting_key     TEXT NOT NULL,            -- e.g. 'operating_hours', 'partner_pharmacies'
  setting_value   JSONB NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (clinic_name, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_clinic_settings_lookup ON clinic_settings(clinic_name, setting_key);

-- ── medication_schedules (per-dose reminders, optional server-side tracking) ──
CREATE TABLE IF NOT EXISTS medication_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID REFERENCES doctor_prescriptions(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  drug_name       TEXT NOT NULL,
  strength        TEXT,
  dose_time       TIME NOT NULL,            -- e.g. '08:00'
  scheduled_for   TIMESTAMPTZ NOT NULL,     -- exact point-in-time the reminder fires
  status          TEXT DEFAULT 'pending',   -- pending | sent | acknowledged | skipped
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_med_sched_prescription ON medication_schedules(prescription_id);
CREATE INDEX IF NOT EXISTS idx_med_sched_due          ON medication_schedules(scheduled_for) WHERE status = 'pending';

-- ── health_checkins (24h "how do you feel?" responses) ───────────────────────
CREATE TABLE IF NOT EXISTS health_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID REFERENCES doctor_prescriptions(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feeling         TEXT CHECK (feeling IN ('better','same','worse')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkins_prescription ON health_checkins(prescription_id);
CREATE INDEX IF NOT EXISTS idx_checkins_patient      ON health_checkins(patient_id);

-- ── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE doctor_prescriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_checkins        ENABLE ROW LEVEL SECURITY;

-- Patients can read their own prescriptions; staff (service role) can do anything.
CREATE POLICY "Patients read own prescriptions"
  ON doctor_prescriptions FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "Staff manage prescriptions"
  ON doctor_prescriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Anyone reads clinic settings"
  ON clinic_settings FOR SELECT
  USING (true);

CREATE POLICY "Staff write clinic settings"
  ON clinic_settings FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Staff update clinic settings"
  ON clinic_settings FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "Patients read own schedules"
  ON medication_schedules FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "Patients ack own schedules"
  ON medication_schedules FOR UPDATE
  USING (patient_id = auth.uid());

CREATE POLICY "Patients read own checkins"
  ON health_checkins FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "Patients write own checkins"
  ON health_checkins FOR INSERT
  WITH CHECK (patient_id = auth.uid());

-- ── Seed default operating hours for the demo clinic ─────────────────────────
INSERT INTO clinic_settings (clinic_name, setting_key, setting_value)
VALUES (
  'Kampala Medical Center',
  'operating_hours',
  '{
    "mon": {"open":"08:00","close":"17:00","enabled":true},
    "tue": {"open":"08:00","close":"17:00","enabled":true},
    "wed": {"open":"08:00","close":"17:00","enabled":true},
    "thu": {"open":"08:00","close":"17:00","enabled":true},
    "fri": {"open":"08:00","close":"17:00","enabled":true},
    "sat": {"open":"09:00","close":"13:00","enabled":true},
    "sun": {"open":"","close":"","enabled":false}
  }'::jsonb
)
ON CONFLICT (clinic_name, setting_key) DO NOTHING;
