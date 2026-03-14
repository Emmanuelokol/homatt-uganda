-- ============================================================
-- Homatt Health Uganda — Full Schema Migration
-- Run this in the Supabase SQL editor
-- ============================================================

-- ── CLINICS ─────────────────────────────────────────────────
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  district text,
  address text,
  phone text,
  email text,
  auth_user_id uuid references auth.users(id),
  status text default 'active' check (status in ('active','inactive','pending','suspended')),
  active boolean default true,
  verified boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table clinics enable row level security;
create policy "Admin can manage clinics" on clinics for all using (true);

-- ── PHARMACIES ───────────────────────────────────────────────
create table if not exists pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  district text,
  address text,
  phone text,
  email text,
  latitude numeric,
  longitude numeric,
  auth_user_id uuid references auth.users(id),
  status text default 'active' check (status in ('active','inactive','pending','suspended')),
  active boolean default true,
  verified boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table pharmacies enable row level security;
create policy "Anyone can read active pharmacies" on pharmacies for select using (active = true);
create policy "Admin can manage pharmacies" on pharmacies for all using (true);

-- ── PORTAL USERS ─────────────────────────────────────────────
create table if not exists portal_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  full_name text,
  email text,
  role text check (role in ('clinic_staff','pharmacy_staff','rider','admin')),
  clinic_id uuid references clinics(id),
  pharmacy_id uuid references pharmacies(id),
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table portal_users enable row level security;
create policy "Portal users can read own record" on portal_users for select using (auth.uid() = auth_user_id);

-- ── BOOKINGS ─────────────────────────────────────────────────
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text unique,
  patient_user_id uuid references auth.users(id),
  patient_name text,
  patient_age integer,
  patient_sex text,
  symptoms text,
  symptoms_identified jsonb,
  ai_diagnosis text,
  conditions_json jsonb,
  ai_confidence integer,
  urgency_level text default 'normal' check (urgency_level in ('high','medium','normal','low')),
  risk_score integer default 0,
  clinic_id uuid references clinics(id),
  status text default 'pending' check (status in ('pending','confirmed','in_progress','attended','completed','cancelled')),
  pin_token text,
  pin_expires_at timestamptz,
  clinic_diagnosis_id uuid,
  attended_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table bookings enable row level security;
create policy "Patients can insert bookings" on bookings for insert with check (true);
create policy "Patients can read own bookings" on bookings for select using (auth.uid() = patient_user_id);
create policy "Clinics can read/update their bookings" on bookings for all using (true);

-- ── CLINIC DIAGNOSES ─────────────────────────────────────────
create table if not exists clinic_diagnoses (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id),
  clinic_id uuid references clinics(id),
  clinician_id uuid,
  ai_suggested_diagnosis text,
  ai_confidence integer,
  ai_match boolean,
  confirmed_diagnosis text not null,
  icd10_code text,
  lab_tests_ordered text[] default '{}',
  severity text check (severity in ('mild','moderate','severe','critical')),
  treatment_plan text,
  follow_up_days integer default 7,
  prescription_items jsonb default '[]',
  routed_pharmacy_id uuid references pharmacies(id),
  created_at timestamptz default now()
);
alter table clinic_diagnoses enable row level security;
create policy "Clinics can manage diagnoses" on clinic_diagnoses for all using (true);

-- ── E-PRESCRIPTIONS ──────────────────────────────────────────
create table if not exists e_prescriptions (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid references clinic_diagnoses(id),
  booking_id uuid references bookings(id),
  patient_id uuid references auth.users(id),
  clinic_id uuid references clinics(id),
  issued_by uuid,
  items jsonb not null default '[]',
  status text default 'active' check (status in ('active','dispensed','expired','cancelled')),
  start_date date,
  end_date date,
  routed_to_pharmacy_id uuid references pharmacies(id),
  notes text,
  created_at timestamptz default now()
);
alter table e_prescriptions enable row level security;
create policy "Prescriptions readable by patient and clinic" on e_prescriptions for all using (true);

-- ── SYMPTOM CACHE ─────────────────────────────────────────────
-- Stores clinician-confirmed diagnoses for reuse before calling AI
create table if not exists symptom_cache (
  id uuid primary key default gen_random_uuid(),
  symptoms_key text unique not null,  -- normalized, sorted symptom words
  symptoms_text text,
  confirmed_diagnosis text,
  conditions_json jsonb,
  ai_match text check (ai_match in ('yes','partial','no')),
  times_used integer default 1,
  source text default 'clinician',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table symptom_cache enable row level security;
create policy "Anyone can read symptom cache" on symptom_cache for select using (true);
create policy "Clinics can insert/update cache" on symptom_cache for all using (true);

-- ── PHARMACY INVENTORY ───────────────────────────────────────
create table if not exists pharmacy_inventory (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references pharmacies(id),
  medicine_name text not null,
  drug_type text default 'otc' check (drug_type in ('otc','rx','both')),
  category text,  -- e.g. antimalarial, antibiotic, analgesic
  retail_price integer not null default 0,  -- in UGX
  quantity integer default 0,
  reorder_threshold integer default 20,
  is_available boolean default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table pharmacy_inventory enable row level security;
create policy "Anyone can read available inventory" on pharmacy_inventory for select using (is_available = true);
create policy "Pharmacies can manage their inventory" on pharmacy_inventory for all using (true);

-- ── PHARMACY ORDERS ──────────────────────────────────────────
create table if not exists pharmacy_orders (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references pharmacies(id),
  patient_user_id uuid references auth.users(id),
  patient_name text,
  patient_phone text,
  delivery_address text,
  items jsonb not null default '[]',
  medication_cost integer default 0,
  delivery_cost integer default 5000,
  total_cost integer default 0,
  urgency text default 'standard' check (urgency in ('standard','urgent')),
  payment_method text default 'cash_on_delivery',
  status text default 'incoming' check (status in ('incoming','confirmed','preparing','dispatched','delivered','cancelled')),
  order_type text default 'otc' check (order_type in ('otc','prescription','mixed')),
  e_prescription_id uuid references e_prescriptions(id),
  drug_type text default 'otc',
  rx_doctor_name text,
  booking_code text,  -- links to a clinic booking/prescription code
  notes text,
  rider_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table pharmacy_orders enable row level security;
create policy "Patients can insert orders" on pharmacy_orders for insert with check (true);
create policy "Patients can read own orders" on pharmacy_orders for select using (auth.uid() = patient_user_id);
create policy "Pharmacies can manage orders" on pharmacy_orders for all using (true);

-- ── PREVENTIVE RECOMMENDATIONS ───────────────────────────────
create table if not exists preventive_recommendations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id),
  diagnosis text,
  recommended_product text,
  recommendation_text text,
  sent_to_patient boolean default false,
  created_at timestamptz default now()
);
alter table preventive_recommendations enable row level security;
create policy "Clinics can insert recommendations" on preventive_recommendations for all using (true);

-- ── RIDERS ───────────────────────────────────────────────────
create table if not exists riders (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  full_name text,
  phone text,
  status text default 'pending' check (status in ('pending','active','suspended')),
  active boolean default false,
  total_deliveries integer default 0,
  rating numeric default 5.0,
  total_earnings integer default 0,
  created_at timestamptz default now()
);
alter table riders enable row level security;
create policy "Riders can read own record" on riders for select using (auth.uid() = auth_user_id);
create policy "Admin can manage riders" on riders for all using (true);

-- ── MEDICINE CATALOG ─────────────────────────────────────────
create table if not exists medicine_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  drug_type text default 'otc' check (drug_type in ('otc','rx','both')),
  category text,
  retail_price integer default 500,
  description text,
  created_at timestamptz default now()
);
alter table medicine_catalog enable row level security;
create policy "Anyone can read catalog" on medicine_catalog for select using (true);

-- Seed basic medicine catalog
insert into medicine_catalog (name, drug_type, category, retail_price) values
  ('Paracetamol 500mg',        'otc', 'analgesic',      500),
  ('Ibuprofen 400mg',          'otc', 'analgesic',      600),
  ('ORS Sachet',               'otc', 'hydration',     1200),
  ('Coartem 20/120mg',         'otc', 'antimalarial',  3200),
  ('Amoxicillin 500mg',        'rx',  'antibiotic',     850),
  ('Ciprofloxacin 500mg',      'rx',  'antibiotic',    1000),
  ('Metronidazole 400mg',      'otc', 'antibiotic',     900),
  ('Omeprazole 20mg',          'otc', 'gastro',         800),
  ('Folic Acid 5mg',           'otc', 'maternal',       300),
  ('Ferrous Sulphate 200mg',   'otc', 'maternal',       400),
  ('Metformin 500mg',          'rx',  'chronic',        600),
  ('Amlodipine 5mg',           'rx',  'chronic',        700),
  ('Prednisolone 5mg',         'rx',  'anti-inflammatory', 400),
  ('Insulin (Actrapid 10ml)',  'rx',  'chronic',       28000),
  ('Salbutamol Inhaler',       'rx',  'respiratory',   9500)
on conflict (name) do nothing;

-- ── SUPPORT TICKETS ──────────────────────────────────────────
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  user_name text,
  subject text not null,
  message text,
  category text default 'general',
  priority text default 'normal' check (priority in ('low','normal','high','urgent')),
  status text default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz default now()
);
alter table support_tickets enable row level security;
create policy "Users can create tickets" on support_tickets for insert with check (true);
create policy "Users can read own tickets" on support_tickets for select using (auth.uid() = user_id);
create policy "Admin can manage tickets" on support_tickets for all using (true);

-- ── PROFILES (extend existing) ───────────────────────────────
-- If profiles table doesn't exist, create it
create table if not exists profiles (
  id uuid primary key references auth.users(id),
  first_name text,
  last_name text,
  phone_number text,
  dob date,
  sex text,
  district text,
  city text,
  has_family boolean default false,
  family_size integer default 1,
  health_goals text[] default '{}',
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users can manage own profile" on profiles for all using (auth.uid() = id);
create policy "Admin can read all profiles" on profiles for select using (true);

-- ── FAMILY MEMBERS ───────────────────────────────────────────
create table if not exists family_members (
  id uuid primary key default gen_random_uuid(),
  primary_user_id uuid references auth.users(id),
  name text not null,
  relationship text,
  dob date,
  sex text,
  created_at timestamptz default now()
);
alter table family_members enable row level security;
create policy "Users can manage own family" on family_members for all using (auth.uid() = primary_user_id);

-- ════════════════════════════════════════════════════════════
-- REQUIRED EXTERNAL APIs  (configure in Supabase Edge Functions)
-- ════════════════════════════════════════════════════════════
--
-- 1. AFRICA'S TALKING SMS API (for booking OTP codes in Uganda)
--    Sign up: https://africastalking.com
--    Uganda sandbox: api.sandbox.africastalking.com
--    Production: api.africastalking.com/version1/messaging
--    Env vars needed: AT_API_KEY, AT_USERNAME
--    Used for: sending HO-XXX booking codes via SMS to patients
--
-- 2. MTN MOBILE MONEY API (clinic payment after treatment)
--    Sign up: https://momodeveloper.mtn.com
--    Uganda collection API: sandbox.momodeveloper.mtn.com
--    Env vars needed: MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY
--    Used for: patient pays clinic after confirmed treatment
--
-- 3. AIRTEL MONEY API (alternative payment)
--    Sign up: https://developers.airtel.africa
--    Uganda: openapi.airtel.africa/merchant/v2/payments
--    Env vars needed: AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET
--    Used for: Airtel money payment option
--
-- 4. GOOGLE MAPS / OPEN STREET MAP (clinic/pharmacy locator)
--    For showing nearest clinic/pharmacy to patient
--    Env vars needed: GOOGLE_MAPS_API_KEY (optional, OSM is free)
--
-- Note: Configure these in Supabase Dashboard → Edge Functions → Secrets
-- ════════════════════════════════════════════════════════════
