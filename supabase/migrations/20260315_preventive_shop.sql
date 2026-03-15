-- ================================================================
-- Homatt Health — Preventive Shop
-- Run this in Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. Products Catalog ──────────────────────────────────────────
create table if not exists preventive_products (
  id             uuid primary key default gen_random_uuid(),
  name           text    not null,
  description    text,
  price          integer not null,         -- price in UGX
  category       text    not null,         -- malaria | hygiene | nutrition | protection
  icon           text    default 'health_and_safety',  -- material icon name
  stock_quantity integer default 100,
  active         boolean default true,
  created_at     timestamptz default now()
);

-- Products: anyone can read active products (no login needed)
alter table preventive_products enable row level security;

drop policy if exists "Anyone can read active products" on preventive_products;
create policy "Anyone can read active products"
  on preventive_products for select using (active = true);

-- ── 2. Shop Orders ───────────────────────────────────────────────
create table if not exists shop_orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references profiles(id) on delete set null,
  product_id       uuid references preventive_products(id) on delete set null,
  product_name     text    not null,   -- denormalized: survives product edits
  quantity         integer not null default 1,
  unit_price       integer not null,
  total_price      integer not null,
  delivery_address text    not null,
  delivery_district text,
  contact_phone    text,
  status           text    not null default 'pending',
    -- lifecycle: pending → processing → shipped → delivered → completed
  admin_notes      text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table shop_orders enable row level security;

-- Users: insert own orders
drop policy if exists "Users can place orders" on shop_orders;
create policy "Users can place orders"
  on shop_orders for insert
  with check (auth.uid() = user_id);

-- Users: read own orders
drop policy if exists "Users can view own orders" on shop_orders;
create policy "Users can view own orders"
  on shop_orders for select
  using (auth.uid() = user_id);

-- Users: mark their own delivered order as completed
drop policy if exists "Users can mark order received" on shop_orders;
create policy "Users can mark order received"
  on shop_orders for update
  using (auth.uid() = user_id AND status = 'delivered')
  with check (status = 'completed');

-- !! IMPORTANT for admin portal !!
-- The admin portal uses the anon key, so we need a permissive
-- policy for selecting all orders (admin handles auth themselves).
-- In production, replace this with a proper service-role or JWT check.
drop policy if exists "Admin can view all orders" on shop_orders;
create policy "Admin can view all orders"
  on shop_orders for select
  using (true);   -- anon key can read — RLS is by-passed only for service role

drop policy if exists "Admin can update order status" on shop_orders;
create policy "Admin can update order status"
  on shop_orders for update
  using (true)
  with check (true);

-- ── 3. Add OneSignal player ID column to profiles ────────────────
alter table profiles
  add column if not exists onesignal_player_id text;

-- ── 4. Seed: 10 preventive product catalog ───────────────────────
insert into preventive_products (name, description, price, category, icon)
select name, description, price, category, icon from (values
  ('Mosquito Net',              'Long-lasting insecticidal net (LLIN). Protects your whole family while sleeping. Reduces malaria by up to 90%.', 15000, 'malaria',    'bed'),
  ('Mosquito Repellent Spray',  'DEET-free body spray. Effective for 6 hours. Safe for children above 2 years.',                                  8000,  'malaria',    'air'),
  ('Insect Coils (12 pcs)',     'Smoke coils that keep mosquitoes away indoors overnight. One pack lasts 12 nights.',                              3000,  'malaria',    'local_fire_department'),
  ('Hand Sanitizer 500ml',      '70% alcohol-based. Kills 99.9% of germs without water.',                                                         5000,  'hygiene',    'soap'),
  ('Face Masks (10 pcs)',       '3-ply surgical masks. Filters dust, pollen, and airborne particles.',                                             6000,  'hygiene',    'masks'),
  ('ORS Sachets (20 pcs)',      'Oral rehydration salts. Essential for diarrhoea and dehydration. WHO recommended.',                               4000,  'nutrition',  'water_drop'),
  ('Water Purif. Tablets (50)', 'Purify drinking water in 30 minutes. 1 tablet treats 1 litre.',                                                  7000,  'hygiene',    'water'),
  ('Vitamin C 500mg (30 tabs)', 'Daily immune-booster. Supports white blood cells and faster recovery.',                                          10000, 'nutrition',  'medication'),
  ('Sunscreen SPF 30 100ml',    'Broad-spectrum sun protection for outdoor workers. Water-resistant 80 min.',                                     12000, 'protection', 'wb_sunny'),
  ('Condoms (3 pcs)',           'High-quality latex condoms. Prevents HIV, STIs, and unwanted pregnancy.',                                         2000,  'protection', 'shield')
) as t(name, description, price, category, icon)
where not exists (select 1 from preventive_products limit 1);
