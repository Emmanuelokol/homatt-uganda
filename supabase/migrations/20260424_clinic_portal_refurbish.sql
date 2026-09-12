-- ════════════════════════════════════════════════════════════════════
-- Clinic Portal Refurbish — simplified 4-screen workflow
-- ────────────────────────────────────────────────────────────────────
-- Introduces:
--   1. formulary             — Uganda National Formulary for drug autocomplete
--   2. clinic_orders         — post-consultation delivery / care orders
--   3. clinic_followups      — automated patient reminders per order
-- ════════════════════════════════════════════════════════════════════

-- ── 1. FORMULARY ─────────────────────────────────────────────────
-- Drug list with standard dosing presets. Used for the autocomplete
-- on the "New Order" form so clinicians just tap the right option.
create table if not exists public.formulary (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,              -- 'Amoxicillin 500mg'
  generic_name   text,                              -- 'Amoxicillin'
  category       text,                              -- 'antibiotic'
  default_dosage text,                              -- '500mg three times daily'
  common_dosages text[] default '{}',               -- ['500mg TDS','250mg BD','1g BD']
  default_days   integer default 5,                 -- typical course length
  rx_only        boolean default true,
  created_at     timestamptz default now()
);

alter table public.formulary enable row level security;

drop policy if exists "formulary_read_all" on public.formulary;
create policy "formulary_read_all" on public.formulary for select using (true);

-- Seed a starter Uganda National Formulary subset. Extend as needed.
insert into public.formulary (name, generic_name, category, default_dosage, common_dosages, default_days, rx_only) values
  ('Amoxicillin 500mg',       'Amoxicillin',      'antibiotic',       '500mg three times daily',  array['500mg three times daily','250mg three times daily','1g twice daily'], 5, true),
  ('Amoxicillin 250mg',       'Amoxicillin',      'antibiotic',       '250mg three times daily',  array['250mg three times daily','500mg twice daily'], 5, true),
  ('Ampiclox 500mg',          'Ampicillin+Cloxacillin','antibiotic',  '500mg four times daily',   array['500mg four times daily','250mg four times daily'], 5, true),
  ('Ciprofloxacin 500mg',     'Ciprofloxacin',    'antibiotic',       '500mg twice daily',        array['500mg twice daily','250mg twice daily'], 7, true),
  ('Metronidazole 400mg',     'Metronidazole',    'antibiotic',       '400mg three times daily',  array['400mg three times daily','500mg three times daily'], 7, true),
  ('Azithromycin 500mg',      'Azithromycin',     'antibiotic',       '500mg once daily',         array['500mg once daily (3 days)','250mg once daily (5 days)'], 3, true),
  ('Doxycycline 100mg',       'Doxycycline',      'antibiotic',       '100mg twice daily',        array['100mg twice daily','100mg once daily'], 7, true),
  ('Erythromycin 500mg',      'Erythromycin',     'antibiotic',       '500mg four times daily',   array['500mg four times daily','250mg four times daily'], 7, true),

  ('Coartem 20/120mg',        'Artemether+Lumefantrine','antimalarial','4 tabs twice daily',      array['4 tabs twice daily','3 tabs twice daily','2 tabs twice daily'], 3, false),
  ('Quinine 300mg',           'Quinine',          'antimalarial',     '600mg three times daily',  array['600mg three times daily','300mg three times daily'], 7, true),
  ('Artesunate 50mg',         'Artesunate',       'antimalarial',     '2.4mg/kg at 0, 12, 24h',   array['IV/IM loading dose'], 1, true),
  ('Fansidar (SP)',           'Sulfadoxine+Pyrimethamine','antimalarial','3 tabs single dose',    array['3 tabs single dose'], 1, false),

  ('Paracetamol 500mg',       'Paracetamol',      'analgesic',        '1g four times daily',      array['1g four times daily','500mg four times daily'], 3, false),
  ('Ibuprofen 400mg',         'Ibuprofen',        'analgesic',        '400mg three times daily',  array['400mg three times daily','200mg three times daily'], 3, false),
  ('Diclofenac 50mg',         'Diclofenac',       'analgesic',        '50mg three times daily',   array['50mg three times daily','75mg twice daily'], 5, false),
  ('Aspirin 300mg',           'Aspirin',          'analgesic',        '300mg three times daily',  array['300mg three times daily','75mg once daily (cardio)'], 3, false),

  ('ORS Sachet',              'Oral Rehydration', 'hydration',        'After each loose stool',   array['1 sachet after each loose stool'], 3, false),
  ('Zinc Sulphate 20mg',      'Zinc',             'hydration',        '20mg once daily',          array['20mg once daily','10mg once daily (<6 months)'], 10, false),

  ('Omeprazole 20mg',         'Omeprazole',       'gastro',           '20mg once daily',          array['20mg once daily','40mg once daily','20mg twice daily'], 14, false),
  ('Ranitidine 150mg',        'Ranitidine',       'gastro',           '150mg twice daily',        array['150mg twice daily','300mg at night'], 14, false),
  ('Hyoscine butylbromide 10mg','Hyoscine',       'gastro',           '10mg three times daily',   array['10mg three times daily','20mg three times daily'], 3, false),

  ('Chlorpheniramine 4mg',    'Chlorpheniramine', 'antihistamine',    '4mg three times daily',    array['4mg three times daily','4mg at night'], 5, false),
  ('Cetirizine 10mg',         'Cetirizine',       'antihistamine',    '10mg once daily',          array['10mg once daily','5mg once daily'], 7, false),
  ('Loratadine 10mg',         'Loratadine',       'antihistamine',    '10mg once daily',          array['10mg once daily'], 7, false),

  ('Salbutamol Inhaler',      'Salbutamol',       'respiratory',      '2 puffs as needed',        array['2 puffs as needed','2 puffs four times daily'], 30, true),
  ('Prednisolone 5mg',        'Prednisolone',     'anti-inflammatory','20mg once daily',          array['20mg once daily','10mg once daily','5mg once daily'], 5, true),

  ('Metformin 500mg',         'Metformin',        'chronic',          '500mg twice daily',        array['500mg twice daily','500mg three times daily','1g twice daily'], 30, true),
  ('Glibenclamide 5mg',       'Glibenclamide',    'chronic',          '5mg once daily',           array['5mg once daily','5mg twice daily'], 30, true),
  ('Amlodipine 5mg',          'Amlodipine',       'chronic',          '5mg once daily',           array['5mg once daily','10mg once daily'], 30, true),
  ('Nifedipine 20mg',         'Nifedipine',       'chronic',          '20mg twice daily',         array['20mg twice daily','10mg three times daily'], 30, true),
  ('Atenolol 50mg',           'Atenolol',         'chronic',          '50mg once daily',          array['50mg once daily','100mg once daily','25mg once daily'], 30, true),
  ('Losartan 50mg',           'Losartan',         'chronic',          '50mg once daily',          array['50mg once daily','100mg once daily'], 30, true),
  ('Hydrochlorothiazide 25mg','Hydrochlorothiazide','chronic',        '25mg once daily',          array['25mg once daily','12.5mg once daily'], 30, true),
  ('Insulin (Actrapid 10ml)', 'Insulin (Regular)', 'chronic',         'As prescribed',            array['Pre-meal short-acting','Basal-bolus regimen'], 30, true),

  ('Folic Acid 5mg',          'Folic Acid',       'maternal',         '5mg once daily',           array['5mg once daily','5mg once weekly'], 30, false),
  ('Ferrous Sulphate 200mg',  'Iron',             'maternal',         '200mg twice daily',        array['200mg twice daily','200mg once daily'], 30, false),
  ('Multivitamin',            'Multivitamin',     'maternal',         '1 tab once daily',         array['1 tab once daily'], 30, false),

  ('Albendazole 400mg',       'Albendazole',      'antihelminthic',   '400mg single dose',        array['400mg single dose','400mg once daily x 3 days'], 1, false),
  ('Mebendazole 500mg',       'Mebendazole',      'antihelminthic',   '500mg single dose',        array['500mg single dose','100mg twice daily x 3 days'], 1, false),
  ('Praziquantel 600mg',      'Praziquantel',     'antihelminthic',   '40mg/kg single dose',      array['40mg/kg single dose'], 1, true)
on conflict (name) do update set
  default_dosage = excluded.default_dosage,
  common_dosages = excluded.common_dosages,
  default_days   = excluded.default_days;


-- ── 2. CLINIC ORDERS ─────────────────────────────────────────────
-- Every post-consultation delivery/pickup prescription order.
-- These flow to the nearest partner pharmacy automatically.
create table if not exists public.clinic_orders (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid references public.clinics(id),
  issued_by          uuid references auth.users(id),         -- clinician who created the order
  issued_by_name     text,                                    -- cached for the UI list
  patient_id         uuid references auth.users(id),          -- nullable if patient isn't on Homatt yet
  patient_name       text not null,
  patient_phone      text not null,
  drug_name          text not null,
  dosage             text not null,                           -- '500mg three times daily'
  duration_days      integer not null default 5,
  delivery_method    text not null default 'delivery' check (delivery_method in ('delivery','pickup')),
  delivery_address   text,
  pharmacy_id        uuid references public.pharmacies(id),  -- auto-selected nearest
  status             text default 'pending' check (status in ('pending','confirmed','preparing','dispatched','delivered','completed','cancelled')),
  course_completed   boolean default false,                   -- set true when follow-ups confirm full course taken
  followup_enabled   boolean default true,
  followup_schedule  jsonb default '[]',                      -- [{day:3,type:'check_in'},{day:5,...}]
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.clinic_orders enable row level security;

-- Clinic staff can read + write their own clinic's orders
drop policy if exists "clinic_orders_staff_manage" on public.clinic_orders;
create policy "clinic_orders_staff_manage" on public.clinic_orders
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.role = 'clinic_staff'
        and (pu.clinic_id = clinic_orders.clinic_id or pu.clinic_id is null)
        and pu.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.role = 'clinic_staff'
        and pu.is_active = true
    )
  );

-- Patients can read their own orders
drop policy if exists "clinic_orders_patient_read" on public.clinic_orders;
create policy "clinic_orders_patient_read" on public.clinic_orders
  for select using (auth.uid() = patient_id);

-- Admins can do anything
drop policy if exists "clinic_orders_admin_all" on public.clinic_orders;
create policy "clinic_orders_admin_all" on public.clinic_orders
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create index if not exists idx_clinic_orders_clinic_created
  on public.clinic_orders (clinic_id, created_at desc);

create index if not exists idx_clinic_orders_patient_phone
  on public.clinic_orders (patient_phone);


-- ── 3. CLINIC FOLLOW-UPS ─────────────────────────────────────────
-- Scheduled SMS/push reminders per clinic_order. pg_cron can iterate
-- this table hourly and push through OneSignal / Africa's Talking.
create table if not exists public.clinic_followups (
  id                uuid primary key default gen_random_uuid(),
  clinic_order_id   uuid references public.clinic_orders(id) on delete cascade,
  scheduled_at      timestamptz not null,
  message           text not null,
  type              text default 'check_in' check (type in ('check_in','refill','course_complete')),
  sent              boolean default false,
  sent_at           timestamptz,
  response          text,                     -- 'better','same','worse', or free text
  created_at        timestamptz default now()
);

alter table public.clinic_followups enable row level security;

drop policy if exists "clinic_followups_read_all_related" on public.clinic_followups;
create policy "clinic_followups_read_all_related" on public.clinic_followups
  for select using (
    exists (
      select 1 from public.clinic_orders co
      where co.id = clinic_followups.clinic_order_id
        and (co.patient_id = auth.uid() or co.issued_by = auth.uid())
    )
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

drop policy if exists "clinic_followups_staff_manage" on public.clinic_followups;
create policy "clinic_followups_staff_manage" on public.clinic_followups
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.role = 'clinic_staff'
        and pu.is_active = true
    )
  );

create index if not exists idx_clinic_followups_pending
  on public.clinic_followups (scheduled_at)
  where sent = false;


-- ── 4. Helper view for clinic dashboard ──────────────────────────
create or replace view public.clinic_orders_today as
select
  co.*,
  p.name as pharmacy_name
from public.clinic_orders co
left join public.pharmacies p on p.id = co.pharmacy_id
where co.created_at >= date_trunc('day', now());

comment on table public.clinic_orders     is 'Post-consultation delivery/pickup prescription orders from clinic portal';
comment on table public.clinic_followups  is 'Automated patient check-in reminders per clinic_order';
comment on table public.formulary         is 'Uganda National Formulary subset for drug autocomplete';
