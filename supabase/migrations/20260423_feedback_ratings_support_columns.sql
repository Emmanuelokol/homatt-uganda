-- Feedback, Ratings, and Support Ticket extra columns
-- Run in Supabase SQL Editor — safe to run multiple times (idempotent)

-- ── support_tickets: add missing columns ────────────────────────
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS user_phone      text,
  ADD COLUMN IF NOT EXISTS admin_response  text,
  ADD COLUMN IF NOT EXISTS responded_at    timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by    text,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- ── platform_feedback: user-submitted app feedback & ratings ────
CREATE TABLE IF NOT EXISTS platform_feedback (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  overall_score int         CHECK (overall_score BETWEEN 1 AND 5),
  category      text        DEFAULT 'general',
  message       text,
  contact_email text,
  status        text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','resolved')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "platform_feedback_insert" ON platform_feedback FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "platform_feedback_select" ON platform_feedback FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "platform_feedback_update" ON platform_feedback FOR UPDATE USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ratings: clinic / pharmacy / delivery ratings ───────────────
CREATE TABLE IF NOT EXISTS ratings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  rating_type  text        NOT NULL DEFAULT 'clinic' CHECK (rating_type IN ('clinic','pharmacy','delivery')),
  target_id    uuid,        -- clinic_id, pharmacy_id, or order_id depending on type
  score        int         CHECK (score BETWEEN 1 AND 5),
  score_speed  int         CHECK (score_speed BETWEEN 1 AND 5),
  score_quality int        CHECK (score_quality BETWEEN 1 AND 5),
  score_cost   int         CHECK (score_cost BETWEEN 1 AND 5),
  score_comms  int         CHECK (score_comms BETWEEN 1 AND 5),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "ratings_insert" ON ratings FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "ratings_select" ON ratings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ratings_type   ON ratings (rating_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings (target_id);
