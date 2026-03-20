-- ============================================================
-- Homatt Health Uganda — Preventive Shop Upgrade
-- Adds marketplace tables, health triggers, product seeds,
-- AI triage sessions, and admin notification support.
-- Run after: 20260308_homatt_full_schema.sql
-- ============================================================

-- ── MARKETPLACE CATEGORIES ───────────────────────────────────
create table if not exists marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text default 'storefront',
  color text default '#388E3C',
  sort_order integer default 99,
  created_at timestamptz default now()
);
alter table marketplace_categories enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketplace_categories_name_key'
  ) then
    alter table marketplace_categories add constraint marketplace_categories_name_key unique (name);
  end if;
end $$;

create policy "Anyone can read categories"
  on marketplace_categories for select using (true);
create policy "Admin can manage categories"
  on marketplace_categories for all using (true);

-- ── MARKETPLACE ITEMS ────────────────────────────────────────
create table if not exists marketplace_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references marketplace_categories(id),
  manufacturer text,
  price integer not null default 0,
  unit text default 'piece',
  description text,
  image_url text,
  in_stock boolean default true,
  stock_count integer,
  featured boolean default false,
  active boolean default true,
  sort_order integer default 99,
  trigger_tags text[] default '{}',  -- health context tags e.g. ARRAY['malaria_diagnosis','malaria_season']
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table marketplace_items enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketplace_items_name_key'
  ) then
    alter table marketplace_items add constraint marketplace_items_name_key unique (name);
  end if;
end $$;

create policy "Anyone can read active items"
  on marketplace_items for select using (active = true);
create policy "Admin can manage items"
  on marketplace_items for all using (true);

-- ── MARKETPLACE ORDERS ───────────────────────────────────────
create table if not exists marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  patient_name text,
  patient_phone text,
  delivery_address text,
  items jsonb not null default '[]',
  total_amount integer default 0,
  delivery_fee integer default 2000,
  payment_method text default 'cash_on_delivery',
  pharmacy_id uuid references pharmacies(id),
  rider_id uuid,
  status text default 'pending' check (status in ('pending','confirmed','dispatched','delivered','cancelled')),
  user_latitude numeric,
  user_longitude numeric,
  district text,
  confirmed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  health_trigger text,  -- which health moment triggered this order (analytics)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table marketplace_orders enable row level security;
create policy "Users can insert marketplace orders"
  on marketplace_orders for insert with check (true);
create policy "Users can read own marketplace orders"
  on marketplace_orders for select using (auth.uid() = user_id);
create policy "Admin can manage marketplace orders"
  on marketplace_orders for all using (true);

-- ── RIDER DELIVERIES ─────────────────────────────────────────
create table if not exists rider_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references marketplace_orders(id),
  rider_user_id uuid references auth.users(id),
  status text default 'pending' check (status in ('pending','picked_up','delivered','failed')),
  earnings integer default 0,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz default now()
);
alter table rider_deliveries enable row level security;
create policy "Admin can manage rider deliveries"
  on rider_deliveries for all using (true);

-- ── AI TRIAGE SESSIONS ───────────────────────────────────────
create table if not exists ai_triage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  patient_name text,
  patient_age integer,
  patient_sex text,
  symptoms_text text,
  followup_answers jsonb,
  ai_conditions jsonb,
  ai_confidence integer,
  top_diagnosis text,
  overall_risk text,
  should_visit_clinic boolean default false,
  clinic_urgency text default 'none',
  clinician_confirmed_diagnosis text,
  ai_was_correct boolean,
  created_at timestamptz default now()
);
alter table ai_triage_sessions enable row level security;
create policy "Users can insert triage sessions"
  on ai_triage_sessions for insert with check (true);
create policy "Users can read own triage sessions"
  on ai_triage_sessions for select using (auth.uid() = user_id);
create policy "Admin can read all triage sessions"
  on ai_triage_sessions for all using (true);

-- ── SITE CONTENT ─────────────────────────────────────────────
create table if not exists site_content (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text,
  content text,
  updated_at timestamptz default now()
);
alter table site_content enable row level security;
create policy "Anyone can read site content"
  on site_content for select using (true);
create policy "Admin can manage site content"
  on site_content for all using (true);

-- ── HEALTH TRIGGERS ──────────────────────────────────────────
-- Tracks health context signals per user for shop personalisation
create table if not exists health_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  trigger_type text not null,
  -- Values: malaria_diagnosis | diarrhoea_child | pregnancy | diabetes_family | malaria_season
  trigger_data jsonb default '{}',
  active boolean default true,
  expires_at timestamptz,
  created_at timestamptz default now()
);
alter table health_triggers enable row level security;
create policy "Users can manage own health triggers"
  on health_triggers for all using (auth.uid() = user_id);

-- ── EXTEND EXISTING TABLES ───────────────────────────────────
-- profiles: add phone shorthand, pregnancy flag, avatar url
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists is_pregnant boolean default false;
alter table profiles add column if not exists avatar_url text;

-- family_members: add health_conditions for diabetes/chronic disease tracking
alter table family_members add column if not exists health_conditions text[] default '{}';

-- riders: add vehicle details and availability
alter table riders add column if not exists vehicle_type text default 'Boda';
alter table riders add column if not exists plate_number text;
alter table riders add column if not exists available boolean default true;

-- ── deduct_stock RPC ─────────────────────────────────────────
create or replace function deduct_stock(item_id uuid, qty integer)
returns void language plpgsql as $$
begin
  update marketplace_items
  set
    stock_count = greatest(0, coalesce(stock_count, 0) - qty),
    in_stock    = (greatest(0, coalesce(stock_count, 0) - qty) > 0)
  where id = item_id and stock_count is not null;
end;
$$;

-- ════════════════════════════════════════════════════════════
-- SEED MARKETPLACE CATEGORIES
-- ════════════════════════════════════════════════════════════
insert into marketplace_categories (name, icon, color, sort_order) values
  ('All',               'grid_view',       '#388E3C', 0),
  ('Malaria Protection','pest_control',    '#B71C1C', 1),
  ('Maternal Health',   'pregnant_woman',  '#880E4F', 2),
  ('Diarrhoea & Water', 'water_drop',      '#0277BD', 3),
  ('Diabetes Care',     'monitor_heart',   '#E65100', 4),
  ('Child Health',      'child_care',      '#6A1B9A', 5),
  ('Hygiene & Safety',  'sanitizer',       '#00796B', 6),
  ('First Aid',         'medical_services','C62828',   7)
on conflict (name) do nothing;

-- ════════════════════════════════════════════════════════════
-- SEED MARKETPLACE ITEMS — THE FIVE HEALTH MOMENTS
--
-- MOMENT 1: After malaria diagnosis → nets, coils, spray, RDT
-- MOMENT 2: After diarrhoea (child)  → ORS, zinc, water purification
-- MOMENT 3: Pregnancy logged          → prenatal vitamins, iron, maternal kit
-- MOMENT 4: Malaria season alert      → (overlaps moment 1, featured more)
-- MOMENT 5: Family member w/ diabetes → glucometer, strips, snacks
-- ════════════════════════════════════════════════════════════

-- MOMENT 1 + 4 — Malaria Protection
insert into marketplace_items
  (name, category_id, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
select v.name, c.id, v.manufacturer, v.price, v.unit, v.description, v.featured, v.sort_order, v.trigger_tags
from (values
  ('LLIN Mosquito Net (Treated)',
    'Malaria Protection', 'Vestergaard PermaNet', 28000, 'piece',
    'Long-lasting insecticidal net (LLIN) — WHO-recommended protection against malaria. Kills and repels Anopheles mosquitoes. Lasts up to 5 years even after repeated washing.',
    true, 1,
    ARRAY['malaria_diagnosis','malaria_season']),

  ('Mosquito Repellent Coil (10-pack)',
    'Malaria Protection', 'Mortein', 4500, 'pack of 10',
    'Slow-burning coils that repel mosquitoes for up to 8 hours. Ideal for evenings when Anopheles mosquitoes are most active. Use in well-ventilated rooms.',
    false, 2,
    ARRAY['malaria_diagnosis','malaria_season']),

  ('Indoor Insecticide Spray (300ml)',
    'Malaria Protection', 'Doom', 9500, 'bottle',
    'Fast-acting indoor spray. Kills mosquitoes, flies and other insects. Safe for sleeping rooms after 15 minutes ventilation. One spray protects a room for up to 6 weeks.',
    false, 3,
    ARRAY['malaria_diagnosis','malaria_season']),

  ('Malaria Rapid Test Kit (RDT)',
    'Malaria Protection', 'SD Bioline', 3500, 'test',
    'WHO-prequalified rapid diagnostic test. Results in 15 minutes from a finger-prick blood sample. Detects P. falciparum and mixed malaria infections. No lab needed.',
    true, 4,
    ARRAY['malaria_diagnosis','malaria_season']),

  ('Mosquito Repellent Lotion (60ml)',
    'Malaria Protection', 'Ultrathon', 7500, 'bottle',
    'DEET-based long-lasting skin repellent. Protects for up to 8 hours outdoors. Suitable for adults and children over 2 months old. Water-resistant formula.',
    false, 5,
    ARRAY['malaria_diagnosis','malaria_season'])
) as v(name, cat_name, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
join marketplace_categories c on c.name = v.cat_name
on conflict (name) do nothing;

-- MOMENT 2 — Diarrhoea & Water Safety
insert into marketplace_items
  (name, category_id, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
select v.name, c.id, v.manufacturer, v.price, v.unit, v.description, v.featured, v.sort_order, v.trigger_tags
from (values
  ('ORS Sachet (20-pack)',
    'Diarrhoea & Water', 'WHO/Electral', 3500, 'pack of 20',
    'Oral Rehydration Salts — first-line treatment for diarrhoea dehydration. WHO-standard formula. Mix 1 sachet in 1L of clean water. Safe for all ages including infants.',
    true, 1,
    ARRAY['diarrhoea_child','gastro_diagnosis']),

  ('Zinc Tablets 10mg (20-pack)',
    'Diarrhoea & Water', 'WHO/Zinc-Kid', 2800, 'pack of 20',
    'Zinc supplementation reduces duration and severity of diarrhoea in children under 5 by up to 25%. Give 1 tablet daily for 10–14 days alongside ORS. WHO/UNICEF recommended.',
    true, 2,
    ARRAY['diarrhoea_child']),

  ('Water Purification Drops (30ml)',
    'Diarrhoea & Water', 'Aquatabs', 4500, 'bottle',
    'Chlorine-based water purification solution. Each bottle treats up to 1,000 litres. Kills cholera, typhoid, E. coli and other waterborne pathogens in 30 minutes.',
    false, 3,
    ARRAY['diarrhoea_child','typhoid_diagnosis','gastro_diagnosis']),

  ('Water Purification Tablets (50-pack)',
    'Diarrhoea & Water', 'Aquatabs', 3200, 'pack of 50',
    'Emergency water purification tablets. Each tablet treats 10L of water. Eliminates bacteria, viruses, and Giardia. Essential for safe drinking water in any household.',
    false, 4,
    ARRAY['diarrhoea_child','typhoid_diagnosis']),

  ('Paediatric ORS + Electrolyte Syrup',
    'Child Health', 'Renalyte', 6500, 'bottle',
    'Flavoured oral rehydration solution for infants and toddlers. Pre-mixed with balanced electrolytes. Easier for children to accept. Replaces lost salts and fluids quickly.',
    true, 1,
    ARRAY['diarrhoea_child'])
) as v(name, cat_name, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
join marketplace_categories c on c.name = v.cat_name
on conflict (name) do nothing;

-- MOMENT 3 — Maternal Health / Pregnancy
insert into marketplace_items
  (name, category_id, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
select v.name, c.id, v.manufacturer, v.price, v.unit, v.description, v.featured, v.sort_order, v.trigger_tags
from (values
  ('Prenatal Multivitamin (30 tabs)',
    'Maternal Health', 'Pregnacare', 18000, 'pack of 30',
    'Complete prenatal formula with folic acid, iron, calcium, zinc, iodine, and vitamins A/D/C/B12. Essential for healthy foetal development and reducing birth defects. Take 1 daily with food.',
    true, 1,
    ARRAY['pregnancy']),

  ('Iron + Folic Acid Supplement (30 tabs)',
    'Maternal Health', 'Ferroglobin', 8500, 'pack of 30',
    'Combined iron (60mg) and folic acid (400mcg) — recommended throughout pregnancy and 6 weeks postpartum. Prevents maternal anaemia and neural tube defects. MOH Uganda standard.',
    true, 2,
    ARRAY['pregnancy']),

  ('Maternal Delivery Kit',
    'Maternal Health', 'MOH Uganda', 35000, 'kit',
    'Government-approved safe delivery kit containing: sterile gloves, plastic sheet, umbilical cord ties, blade, gauze, and postnatal care guide. For use by trained birth attendants.',
    false, 3,
    ARRAY['pregnancy']),

  ('Calcium + Vitamin D3 (30 tabs)',
    'Maternal Health', 'Calcigard', 7500, 'pack of 30',
    'Supports baby bone development and reduces risk of pre-eclampsia. WHO recommends 1.5–2g calcium daily for pregnant women in low-intake settings like Uganda. Vitamin D3 aids absorption.',
    false, 4,
    ARRAY['pregnancy']),

  ('Pregnancy Test Kit (2-pack)',
    'Maternal Health', 'Clearblue', 4500, 'pack of 2',
    'Over 99% accurate from the day of expected period. Easy midstream format. Fast 3-minute result. FDA-cleared and CE-marked. Discrete packaging.',
    false, 5,
    ARRAY['pregnancy'])
) as v(name, cat_name, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
join marketplace_categories c on c.name = v.cat_name
on conflict (name) do nothing;

-- MOMENT 5 — Diabetes Care (family member with diabetes)
insert into marketplace_items
  (name, category_id, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
select v.name, c.id, v.manufacturer, v.price, v.unit, v.description, v.featured, v.sort_order, v.trigger_tags
from (values
  ('Blood Glucose Meter (Glucometer)',
    'Diabetes Care', 'Accu-Check Performa', 65000, 'device',
    'Digital blood glucose meter with 5-second result. Memory stores 360 readings with date and time. Includes 10 test strips and 10 sterile lancets. No coding required.',
    true, 1,
    ARRAY['diabetes_family']),

  ('Blood Glucose Test Strips (50-pack)',
    'Diabetes Care', 'Accu-Check', 45000, 'pack of 50',
    'Compatible with Accu-Check Performa meters. Each strip provides accurate blood glucose measurement within 5 seconds. Store at room temperature, away from humidity.',
    true, 2,
    ARRAY['diabetes_family']),

  ('Lancets / Finger-Prick Needles (100-pack)',
    'Diabetes Care', 'BD Ultra-Fine', 8500, 'pack of 100',
    'Ultra-thin 28G lancets for near-painless blood glucose testing. Single-use, individually sterile. Compatible with most lancing devices.',
    false, 3,
    ARRAY['diabetes_family']),

  ('Low-GI Diabetic Snack Bars (5-pack)',
    'Diabetes Care', 'Glucerna', 6500, 'pack of 5',
    'Slow-release carbohydrate bars formulated for people with diabetes. Low glycaemic index formula helps stabilise blood sugar between meals. High in fibre and protein.',
    false, 4,
    ARRAY['diabetes_family']),

  ('Diabetic Foot Care Cream (100g)',
    'Diabetes Care', 'Flexitol', 12000, 'tube',
    'Intensive moisturising cream for diabetic foot care. Prevents skin cracking and reduces risk of infection in feet with reduced sensation. Apply daily to clean, dry feet.',
    false, 5,
    ARRAY['diabetes_family'])
) as v(name, cat_name, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
join marketplace_categories c on c.name = v.cat_name
on conflict (name) do nothing;

-- General Hygiene, First Aid, and Child Health
insert into marketplace_items
  (name, category_id, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
select v.name, c.id, v.manufacturer, v.price, v.unit, v.description, v.featured, v.sort_order, v.trigger_tags
from (values
  ('Hand Sanitiser 70% Alcohol (250ml)',
    'Hygiene & Safety', 'Dettol', 5500, 'bottle',
    'WHO-formula 70% alcohol hand sanitiser. Kills 99.9% of bacteria and viruses without water. Gentle on skin with added moisturiser. Ideal for use when soap and water are unavailable.',
    false, 1,
    ARRAY[]::text[]),

  ('Surgical Face Masks (10-pack)',
    'Hygiene & Safety', 'Comfort Plus', 3500, 'pack of 10',
    '3-layer surgical masks with bacterial filtration efficiency (BFE) >95%. Comfortable nose wire and ear loops. For clinical visits, public transport, and high-risk environments.',
    false, 2,
    ARRAY[]::text[]),

  ('Digital Thermometer (Fast-read)',
    'First Aid', 'Rossmax', 12000, 'piece',
    'Oral/axillary thermometer with 30-second reading and fever alarm above 37.5°C. Memory recalls last reading. Flexible tip for comfort. Beeps when measurement complete.',
    false, 1,
    ARRAY[]::text[]),

  ('Basic First Aid Kit (30-piece)',
    'First Aid', 'St John', 28000, 'kit',
    'Comprehensive kit: assorted bandages, antiseptic wipes, plasters, latex gloves, scissors, gauze, triangular bandage and first-aid guide. Wall-mountable case. Essential for every home.',
    false, 2,
    ARRAY[]::text[]),

  ('Children Multivitamin Syrup (200ml)',
    'Child Health', 'Revivol-C', 8500, 'bottle',
    'Vitamin A, C, D, iron and zinc syrup for children aged 1–12 years. Supports immune function, healthy growth, and cognitive development. Orange flavour. Give 5ml daily with food.',
    true, 2,
    ARRAY[]::text[]),

  ('Baby Growth Chart + Health Record',
    'Child Health', 'MOH Uganda', 1500, 'booklet',
    'Official MOH Uganda child health card and growth monitoring chart. Track weight, height, immunisations, and developmental milestones from birth to age 5.',
    false, 3,
    ARRAY[]::text[])
) as v(name, cat_name, manufacturer, price, unit, description, featured, sort_order, trigger_tags)
join marketplace_categories c on c.name = v.cat_name
on conflict (name) do nothing;
