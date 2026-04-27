-- ═══════════════════════════════════════════════════════════════════════════
-- Homatt Health — Core operational tables (clinic / pharmacy / rider / admin)
-- ═══════════════════════════════════════════════════════════════════════════
-- The portals already query these tables; they previously fell back to demo
-- data when the tables didn't exist. This migration creates them so every
-- portal has a real backend.
--
-- Tables:
--   bookings           clinic appointments triggered from the patient app
--   escalations        emergency / urgent triage flags admins review
--   clinics            registry of partner clinics
--   pharmacies         registry of partner pharmacies
--   riders             registered boda boda delivery riders
--   pharmacy_orders    prescription routed to a partner pharmacy
--   rider_deliveries   pharmacy → patient delivery jobs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── bookings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code    TEXT UNIQUE NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  patient_name    TEXT NOT NULL,
  patient_age     INTEGER,
  patient_sex     TEXT,
  symptoms        JSONB,
  ai_diagnosis    TEXT,
  ai_diagnoses    JSONB,                       -- top-3 differential array
  ai_confidence   INTEGER,
  urgency_level   TEXT CHECK (urgency_level IN ('low','medium','urgent','emergency')),
  status          TEXT DEFAULT 'pending'       -- pending | confirmed | in_progress | completed | cancelled
                  CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
  clinic_id       UUID,
  clinic_name     TEXT,
  scheduled_for   TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user     ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created  ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_clinic   ON bookings(clinic_id);

-- ── escalations (urgent / emergency triage flags) ────────────────────────────
CREATE TABLE IF NOT EXISTS escalations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID REFERENCES bookings(id) ON DELETE CASCADE,
  patient_name        TEXT NOT NULL,
  symptoms            JSONB,
  ai_diagnosis        TEXT,
  confidence_percent  INTEGER,
  urgency_level       TEXT CHECK (urgency_level IN ('urgent','emergency')) NOT NULL,
  location_district   TEXT,
  action_taken        TEXT,                    -- call_emergency | book_clinic | self_care
  resolved            BOOLEAN DEFAULT FALSE,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_resolved ON escalations(resolved);
CREATE INDEX IF NOT EXISTS idx_escalations_created  ON escalations(created_at DESC);

-- ── clinics registry ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT UNIQUE NOT NULL,
  district        TEXT,
  phone           TEXT,
  email           TEXT,
  license_number  TEXT,
  specialties     TEXT[],
  verified        BOOLEAN DEFAULT TRUE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── pharmacies registry ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT UNIQUE NOT NULL,
  district        TEXT,
  phone           TEXT,
  license_number  TEXT,
  delivery        BOOLEAN DEFAULT FALSE,        -- offers home delivery
  verified        BOOLEAN DEFAULT TRUE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── riders registry ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  phone             TEXT,
  plate_number      TEXT,
  national_id       TEXT,
  district          TEXT,
  total_deliveries  INTEGER DEFAULT 0,
  rating            NUMERIC(3,2) DEFAULT 5.00,
  available         BOOLEAN DEFAULT TRUE,
  online            BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_riders_user      ON riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_available ON riders(available, online) WHERE available = TRUE;

-- ── pharmacy_orders (e-prescriptions routed to a pharmacy) ───────────────────
CREATE TABLE IF NOT EXISTS pharmacy_orders (
  id                  TEXT PRIMARY KEY,        -- e.g. ORD-001
  prescription_id     TEXT,                    -- references doctor_prescriptions.rx_id
  doctor_prescription UUID REFERENCES doctor_prescriptions(id) ON DELETE SET NULL,
  patient_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  patient_name        TEXT NOT NULL,
  patient_phone       TEXT,
  delivery_address    TEXT,
  doctor_name         TEXT,
  doctor_license      TEXT,
  digital_signature   TEXT,
  final_diagnosis     TEXT,
  drugs               JSONB NOT NULL,
  medication_cost     INTEGER DEFAULT 0,       -- UGX
  delivery_fee        INTEGER DEFAULT 5000,    -- UGX
  pharmacy_id         UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  pharmacy_name       TEXT,
  status              TEXT DEFAULT 'incoming'  -- incoming | ready | dispatched | delivered | rejected
                      CHECK (status IN ('incoming','ready','dispatched','delivered','rejected')),
  reject_reason       TEXT,
  delivery_choice     TEXT CHECK (delivery_choice IN ('pickup','deliver')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_status   ON pharmacy_orders(status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_patient  ON pharmacy_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_created  ON pharmacy_orders(created_at DESC);

-- ── rider_deliveries (pharmacy → patient delivery jobs) ──────────────────────
CREATE TABLE IF NOT EXISTS rider_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_order_id TEXT REFERENCES pharmacy_orders(id) ON DELETE CASCADE,
  rider_id          UUID REFERENCES riders(id) ON DELETE SET NULL,
  patient_name      TEXT,
  pickup_address    TEXT,
  delivery_address  TEXT,
  district          TEXT,
  drugs_summary     TEXT,
  distance_km       NUMERIC(5,2),
  eta_minutes       INTEGER,
  earnings          INTEGER DEFAULT 3000,
  urgent            BOOLEAN DEFAULT FALSE,
  status            TEXT DEFAULT 'available'   -- available | accepted | at_pharmacy | in_transit | delivered | declined
                    CHECK (status IN ('available','accepted','at_pharmacy','in_transit','delivered','declined')),
  picked_up_at      TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status  ON rider_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_rider   ON rider_deliveries(rider_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_created ON rider_deliveries(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_deliveries  ENABLE ROW LEVEL SECURITY;

-- bookings: a patient sees their own; service role sees all
CREATE POLICY "Patients read own bookings"
  ON bookings FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Patients create own bookings"
  ON bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Staff manage all bookings"
  ON bookings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- escalations: only staff (service role) reads
CREATE POLICY "Staff manage escalations"
  ON escalations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- clinics & pharmacies: anyone can read the registry (used by the booking app)
CREATE POLICY "Anyone reads clinics"     ON clinics    FOR SELECT USING (active = TRUE);
CREATE POLICY "Anyone reads pharmacies"  ON pharmacies FOR SELECT USING (active = TRUE);
CREATE POLICY "Staff manage clinics"     ON clinics    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Staff manage pharmacies"  ON pharmacies FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- riders: rider sees their own row; staff sees all
CREATE POLICY "Riders read own row"  ON riders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Riders update own row"
  ON riders FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Staff manage riders"
  ON riders FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- pharmacy_orders: patients see their own
CREATE POLICY "Patients read own pharmacy orders"
  ON pharmacy_orders FOR SELECT
  USING (patient_id = auth.uid());
CREATE POLICY "Staff manage pharmacy orders"
  ON pharmacy_orders FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- rider_deliveries: assigned rider sees their own + open jobs
CREATE POLICY "Riders read own deliveries"
  ON rider_deliveries FOR SELECT
  USING (
    rider_id IN (SELECT id FROM riders WHERE user_id = auth.uid())
    OR status = 'available'
  );
CREATE POLICY "Riders update own deliveries"
  ON rider_deliveries FOR UPDATE
  USING (rider_id IN (SELECT id FROM riders WHERE user_id = auth.uid()));
CREATE POLICY "Staff manage deliveries"
  ON rider_deliveries FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed clinics, pharmacies, riders so the registries aren't empty in prod
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO clinics (name, district, phone, license_number, specialties) VALUES
  ('Kampala Medical Center',           'Kampala', '+256700123456', 'KMC-2024-001', ARRAY['General Medicine','Emergency','Pediatrics']),
  ('Mulago National Referral Hospital','Kampala', '+256414531000', 'MNR-2024-002', ARRAY['Emergency','Surgery','Obstetrics']),
  ('Case Medical Center',              'Kampala', '+256312202100', 'CMC-2024-003', ARRAY['General Medicine','Diagnostics']),
  ('Nakasero Hospital',                'Kampala', '+256312103000', 'NKS-2024-004', ARRAY['Emergency','Cardiac','Orthopedics']),
  ('International Hospital Kampala',   'Kampala', '+256417200400', 'IHK-2024-005', ARRAY['Emergency','ICU','Oncology'])
ON CONFLICT (name) DO NOTHING;

INSERT INTO pharmacies (name, district, phone, license_number, delivery) VALUES
  ('Kampala Central Pharmacy', 'Kampala', '+256700111222', 'PHM-2024-001', TRUE),
  ('Mulago Hospital Pharmacy', 'Kampala', '+256700333444', 'PHM-2024-002', FALSE),
  ('Nakasero Medical Pharmacy','Kampala', '+256700555666', 'PHM-2024-003', TRUE),
  ('Homatt Partner Pharmacy',  'Kampala', '+256700000123', 'PHM-2024-004', TRUE)
ON CONFLICT (name) DO NOTHING;
