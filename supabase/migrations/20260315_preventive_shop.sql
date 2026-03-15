-- Preventive Shop: Products catalog
create table if not exists preventive_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price integer not null,          -- price in UGX
  category text not null,          -- 'malaria' | 'hygiene' | 'nutrition' | 'protection'
  icon text default 'health_and_safety',  -- material icon name
  stock_quantity integer default 100,
  active boolean default true,
  created_at timestamptz default now()
);

-- Preventive Shop: Customer orders
create table if not exists shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  product_id uuid references preventive_products(id) on delete set null,
  product_name text not null,      -- denormalized so name survives product edits
  quantity integer not null default 1,
  unit_price integer not null,
  total_price integer not null,
  delivery_address text not null,
  delivery_district text,
  contact_phone text,
  status text not null default 'pending',
    -- pending → processing → shipped → delivered → completed
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: users can insert their own orders and read them
alter table shop_orders enable row level security;

create policy "Users can place orders"
  on shop_orders for insert
  with check (auth.uid() = user_id);

create policy "Users can view own orders"
  on shop_orders for select
  using (auth.uid() = user_id);

create policy "Users can mark order received"
  on shop_orders for update
  using (auth.uid() = user_id)
  with check (status = 'completed');

-- RLS: products are readable by all authenticated users
alter table preventive_products enable row level security;

create policy "Anyone can read active products"
  on preventive_products for select
  using (active = true);

-- Seed: initial product catalog
insert into preventive_products (name, description, price, category, icon) values
  ('Mosquito Net',             'Long-lasting insecticidal net (LLIN). Protects the whole family while sleeping.', 15000, 'malaria',    'bed'),
  ('Mosquito Repellent Spray', 'DEET-free body spray. Effective for 6 hours. Safe for children above 2 years.', 8000,  'malaria',    'spray'),
  ('Insect Coils (12 pcs)',    'Smoke coils that keep mosquitoes away indoors overnight.',                        3000,  'malaria',    'local_fire_department'),
  ('Hand Sanitizer 500ml',     '70% alcohol-based hand sanitizer. Kills 99.9% of germs without water.',          5000,  'hygiene',    'soap'),
  ('Face Masks (10 pcs)',      '3-ply surgical masks. Protection against dust, pollen, and airborne particles.', 6000,  'hygiene',    'masks'),
  ('ORS Sachets (20 pcs)',     'Oral rehydration salts. Essential for diarrhoea and dehydration recovery.',      4000,  'nutrition',  'water_drop'),
  ('Water Purif. Tablets (50)', 'Purify drinking water in 30 mins. 1 tablet treats 1 litre of water.',          7000,  'hygiene',    'water'),
  ('Vitamin C 500mg (30 tabs)', 'Daily immune-booster. Supports white blood cell production.',                   10000, 'nutrition',  'medication'),
  ('Sunscreen SPF 30 100ml',   'Broad-spectrum sun protection. Reduces skin cancer risk for outdoor workers.',   12000, 'protection', 'wb_sunny'),
  ('Condoms (3 pcs)',          'High-quality latex condoms. Prevents HIV, STIs, and unwanted pregnancy.',        2000,  'protection', 'shield');
