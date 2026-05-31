-- Feedback, Ratings, and Support Ticket columns
-- Run in Supabase SQL Editor — safe to run multiple times (idempotent)
-- Handles pre-existing tables by adding missing columns with ALTER TABLE.

-- ── 1. support_tickets: add missing columns ────────────────────────
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS user_phone      text,
  ADD COLUMN IF NOT EXISTS admin_response  text,
  ADD COLUMN IF NOT EXISTS responded_at    timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by    text,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- ── 2. platform_feedback: user-submitted app feedback & ratings ────
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

-- If the table already existed from an older partial run, ensure every column is present
ALTER TABLE platform_feedback
  ADD COLUMN IF NOT EXISTS patient_id    uuid,
  ADD COLUMN IF NOT EXISTS overall_score int,
  ADD COLUMN IF NOT EXISTS category      text DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS message       text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS status        text DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz DEFAULT now();

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

-- ── 3. ratings: clinic / pharmacy / delivery ratings ───────────────
CREATE TABLE IF NOT EXISTS ratings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  rating_type   text        NOT NULL DEFAULT 'clinic',
  target_id     uuid,
  score         int,
  score_speed   int,
  score_quality int,
  score_cost    int,
  score_comms   int,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- If ratings existed from an older run, fill in any missing columns
ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS patient_id    uuid,
  ADD COLUMN IF NOT EXISTS rating_type   text DEFAULT 'clinic',
  ADD COLUMN IF NOT EXISTS target_id     uuid,
  ADD COLUMN IF NOT EXISTS score         int,
  ADD COLUMN IF NOT EXISTS score_speed   int,
  ADD COLUMN IF NOT EXISTS score_quality int,
  ADD COLUMN IF NOT EXISTS score_cost    int,
  ADD COLUMN IF NOT EXISTS score_comms   int,
  ADD COLUMN IF NOT EXISTS comment       text,
  ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "ratings_insert" ON ratings FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "ratings_select" ON ratings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ratings_type   ON ratings (rating_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings (target_id);
