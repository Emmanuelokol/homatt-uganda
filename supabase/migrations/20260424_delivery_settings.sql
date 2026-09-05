-- Delivery Settings Table
-- Stores admin-configured delivery fee rates.
-- Mobile app reads base_fee (and min_fee) to display the delivery charge at checkout.
-- Admin portal writes to this table via the Delivery Cost Settings panel.

create table if not exists public.delivery_settings (
  id          uuid primary key default gen_random_uuid(),
  base_fee    integer not null default 5000,   -- flat fee on every order (UGX)
  per_km_rate integer not null default 500,    -- per-km surcharge (UGX/km)
  min_fee     integer not null default 2000,   -- floor — never charge less than this
  updated_at  timestamptz not null default now()
);

-- Seed one default row so the app always has something to read
insert into public.delivery_settings (base_fee, per_km_rate, min_fee)
values (5000, 500, 2000)
on conflict do nothing;

-- RLS: allow anyone (incl. anon mobile app) to read; only service_role can write
alter table public.delivery_settings enable row level security;

drop policy if exists "delivery_settings_read_all" on public.delivery_settings;
create policy "delivery_settings_read_all"
  on public.delivery_settings for select
  using (true);

-- Admin write: authenticated users whose profile has is_admin = true may insert/update
drop policy if exists "delivery_settings_admin_write" on public.delivery_settings;
create policy "delivery_settings_admin_write"
  on public.delivery_settings for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );
