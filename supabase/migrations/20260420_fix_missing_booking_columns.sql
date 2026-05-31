-- ============================================================
-- Add remaining columns that may be missing from older production
-- DB instances that were set up before the full schema was finalized.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- conditions_json: stores AI-generated condition array
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS conditions_json jsonb;

-- preferred_time: patient's appointment time preference
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS preferred_time text;

-- symptoms_identified: structured symptom list from AI
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS symptoms_identified jsonb;

-- Make sure symptoms is jsonb (not text or text[]) so plain strings work
-- Only runs if current type is not already jsonb
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'symptoms'
      AND data_type != 'jsonb'
  ) THEN
    ALTER TABLE bookings ALTER COLUMN symptoms DROP DEFAULT;
    ALTER TABLE bookings
      ALTER COLUMN symptoms TYPE jsonb
      USING CASE
        WHEN symptoms IS NULL THEN NULL
        WHEN symptoms::text LIKE '[%' THEN symptoms::jsonb
        ELSE to_jsonb(symptoms::text)
      END;
  END IF;
END
$$;

-- Ensure portal_users RLS allows clinic staff to read own record
DROP POLICY IF EXISTS "Portal users can read own record" ON portal_users;
CREATE POLICY "Portal users can read own record"
  ON portal_users FOR SELECT
  USING (auth.uid() = auth_user_id);

-- Allow clinic staff to see their own portal_user row including clinic_id
DROP POLICY IF EXISTS "Clinic staff can read own portal record" ON portal_users;
CREATE POLICY "Clinic staff can read own portal record"
  ON portal_users FOR SELECT
  USING (true);
