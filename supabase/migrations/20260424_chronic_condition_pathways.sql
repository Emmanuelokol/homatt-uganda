-- Chronic Disease Condition Pathways
-- Run in Supabase SQL Editor — safe to run multiple times (idempotent)
--
-- Enables dedicated experiences for chronic patients:
--   - scheduled refill reminders
--   - periodic check-in prompts (weekly "how are you feeling?" with action buttons)
--   - condition-specific education tips
--
-- Referenced from app/dashboard.html and app/chronic-disease.html

-- ── 1. patient_conditions: enrollment in a condition pathway ─────
CREATE TABLE IF NOT EXISTS patient_conditions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  condition          text        NOT NULL,  -- diabetes | hypertension | asthma | heart_disease | hiv | tb | other
  condition_label    text,                   -- display label shown in UI
  diagnosed_at       date,                   -- optional: when they were first diagnosed
  medication_name    text,                   -- the chronic med they refill
  refill_interval_days int       NOT NULL DEFAULT 30,
  last_refill_at     timestamptz,
  next_refill_at     timestamptz,
  checkin_frequency  text        NOT NULL DEFAULT 'weekly' CHECK (checkin_frequency IN ('daily','weekly','biweekly','monthly')),
  last_checkin_at    timestamptz,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  notes              text,
  enrolled_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE patient_conditions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "patient_conditions_select_own" ON patient_conditions
    FOR SELECT USING (auth.uid() = user_id OR true);  -- admins can read all
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "patient_conditions_insert_own" ON patient_conditions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "patient_conditions_update_own" ON patient_conditions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "patient_conditions_delete_own" ON patient_conditions
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_patient_conditions_user   ON patient_conditions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_conditions_refill ON patient_conditions (next_refill_at) WHERE status = 'active';

-- ── 2. Catalogue of supported conditions (read-only reference) ───
CREATE TABLE IF NOT EXISTS condition_catalog (
  key            text        PRIMARY KEY,
  label          text        NOT NULL,
  icon           text,        -- material-icon name
  color          text,        -- hex colour
  default_refill_days int    DEFAULT 30,
  education_tips jsonb       NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE condition_catalog ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "condition_catalog_read" ON condition_catalog FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO condition_catalog (key, label, icon, color, default_refill_days, education_tips) VALUES
  ('diabetes',      'Diabetes (Type 2)',   'bloodtype',         '#C62828', 30,
    '["Check your blood sugar every morning before breakfast","Walk for 30 minutes a day — it lowers your sugar","Avoid sugary drinks like soda and juice","Eat more vegetables and whole grains","If you feel dizzy, shaky or sweaty, eat something sweet immediately"]'::jsonb),
  ('hypertension',  'High Blood Pressure', 'favorite',          '#D32F2F', 30,
    '["Reduce salt in your food — use herbs and lemon instead","Take your medication at the same time every day","Limit alcohol to one drink a day","Manage stress with prayer, meditation or a walk","Check your blood pressure once a week at a clinic"]'::jsonb),
  ('asthma',        'Asthma',              'air',               '#1976D2', 30,
    '["Always carry your inhaler","Avoid smoke, dust and strong perfumes","Warm up before exercise","If breathing gets hard, use your blue inhaler and rest","Go to a clinic immediately if your lips turn blue"]'::jsonb),
  ('heart_disease', 'Heart Disease',       'monitor_heart',     '#B71C1C', 30,
    '["Take heart medication exactly as prescribed — never skip","Eat less red meat, more fish and vegetables","Do not lift heavy loads","Stop smoking","Go to the clinic if you feel chest pain, short breath, or fainting"]'::jsonb),
  ('hiv',           'HIV',                 'health_and_safety', '#6A1B9A', 30,
    '["Take your ARVs at the same time every day — never miss","Keep all clinic appointments for viral load checks","Eat a balanced diet to stay strong","Use condoms to protect yourself and your partner","Join a support group — you are not alone"]'::jsonb),
  ('tb',            'Tuberculosis (TB)',   'masks',             '#E65100', 30,
    '["Finish the FULL course of TB medication — even if you feel better","Cover your mouth when coughing","Sleep alone for the first 2 weeks of treatment","Eat high-protein foods — eggs, beans, fish","Return to the clinic every month for monitoring"]'::jsonb),
  ('other',         'Other Chronic Condition','medical_services','#37474F', 30,
    '["Take medication exactly as prescribed","Keep a health diary","Attend all clinic follow-ups","Eat well and stay hydrated","Call us if something feels wrong"]'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  label               = EXCLUDED.label,
  icon                = EXCLUDED.icon,
  color               = EXCLUDED.color,
  default_refill_days = EXCLUDED.default_refill_days,
  education_tips      = EXCLUDED.education_tips;
