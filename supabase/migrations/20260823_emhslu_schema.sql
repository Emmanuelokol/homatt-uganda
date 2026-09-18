-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 1 of 4 — SCHEMA
--
-- Essential Medicines & Health Supplies List for Uganda (EMHSLU 2023),
-- the clinic's learned care packages, the facility level, and the patient
-- identifier — as real SQL tables.
--
-- Run this file FIRST, on its own. Then run, in order:
--     20260823_emhslu_seed_1_reference.sql   (sections + categories)
--     20260823_emhslu_seed_2_items.sql       (items 1 … 1200)
--     20260823_emhslu_seed_3_items.sql       (items 1201 … end)
--
-- Everything here is idempotent — running it twice is safe.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The national list (reference data, shared by every clinic) ──────────
-- This is published Ministry of Health data. Every signed-in user may READ it;
-- nobody may write it from the app — it is replaced only by re-running the
-- seed files (or from the SQL editor / service role).

create table if not exists public.emhslu_sections (
  code        text primary key,                    -- A | B | C | D
  title       text not null
);

create table if not exists public.emhslu_categories (
  id          integer primary key,                 -- stable id from the source build
  section     text references public.emhslu_sections(code),
  number      text,                                -- '1', '1.1', '6.2.3' …
  title       text
);

create table if not exists public.emhslu_items (
  id              integer primary key,             -- stable id from the source build
  section         text,
  category_id     integer references public.emhslu_categories(id),
  category_number text,
  category_title  text,
  item_type       text not null
                  check (item_type in ('medicine','health_supply','lab_supply')),
  name            text not null,
  dosage_form     text,                            -- Tablet, Capsule, Injection …
  strength        text,                            -- '250 mg', '600mg+25mg' …
  specification   text,                            -- supplies: the spec text
  level_of_care   text                             -- LOWEST level allowed to stock it
                  check (level_of_care in ('HC1','HC2','HC3','HC4','H','RR','NR')),
  ven_class       text check (ven_class in ('V','E','N')),
  specialist      boolean not null default false,
  source_line     text
);

-- An item allowed at HC2 is also allowed at HC3, HC4, H, RR and NR.
-- This table spells that out so "what may MY level stock?" is one index hit.
create table if not exists public.emhslu_item_levels (
  item_id     integer not null references public.emhslu_items(id) on delete cascade,
  level       text    not null
              check (level in ('HC1','HC2','HC3','HC4','H','RR','NR')),
  primary key (item_id, level)
);

create index if not exists idx_emhslu_items_name
  on public.emhslu_items (lower(name));
create index if not exists idx_emhslu_items_type_level
  on public.emhslu_items (item_type, level_of_care);
create index if not exists idx_emhslu_items_ven
  on public.emhslu_items (ven_class);
create index if not exists idx_emhslu_items_category
  on public.emhslu_items (category_id);
create index if not exists idx_emhslu_levels_level
  on public.emhslu_item_levels (level);

-- Fast "type-ahead" search: trigram index so 'amo' finds Amoxicillin instantly
-- even in the middle of a word. Falls back to a plain prefix index if the
-- pg_trgm extension is not available on this project.
do $$
begin
  create extension if not exists pg_trgm;
  execute 'create index if not exists idx_emhslu_items_trgm '
       || 'on public.emhslu_items using gin (name gin_trgm_ops)';
exception when others then
  execute 'create index if not exists idx_emhslu_items_name_prefix '
       || 'on public.emhslu_items (name text_pattern_ops)';
end $$;

alter table public.emhslu_sections    enable row level security;
alter table public.emhslu_categories  enable row level security;
alter table public.emhslu_items       enable row level security;
alter table public.emhslu_item_levels enable row level security;

drop policy if exists "emhslu_read_all" on public.emhslu_sections;
create policy "emhslu_read_all" on public.emhslu_sections
  for select to authenticated using (true);

drop policy if exists "emhslu_read_all" on public.emhslu_categories;
create policy "emhslu_read_all" on public.emhslu_categories
  for select to authenticated using (true);

drop policy if exists "emhslu_read_all" on public.emhslu_items;
create policy "emhslu_read_all" on public.emhslu_items
  for select to authenticated using (true);

drop policy if exists "emhslu_read_all" on public.emhslu_item_levels;
create policy "emhslu_read_all" on public.emhslu_item_levels
  for select to authenticated using (true);


-- ── 2. The clinic's own facility level ─────────────────────────────────────
-- Decides which part of the national list applies to this clinic.

alter table public.clinics
  add column if not exists facility_level text;

do $$
begin
  alter table public.clinics drop constraint if exists clinics_facility_level_check;
  alter table public.clinics add constraint clinics_facility_level_check
    check (facility_level is null
           or facility_level in ('HC1','HC2','HC3','HC4','H','RR','NR'));
exception when others then null;
end $$;

comment on column public.clinics.facility_level is
  'EMHSLU level of care: HC1 … HC4, H (general hospital), RR (regional referral), NR (national referral).';


-- ── 3. Learned care packages (the one-tap package) ────────────────────────
-- The app already writes here through the offline outbox; the table was
-- missing, so those writes had nowhere to land. Each row is ONE clinic's
-- remembered package for one condition at one severity.

create table if not exists public.clinic_care_packages (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  condition_id  text not null,                     -- UCG condition id, or the typed name
  severity      text not null default 'any',
  title         text,
  package       jsonb not null default '{}'::jsonb, -- tests, drugs, fees, followUpDays, uses
  uses          integer not null default 0,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- The client upserts on exactly this key.
create unique index if not exists idx_care_pkg_unique
  on public.clinic_care_packages (clinic_id, condition_id, severity);
create index if not exists idx_care_pkg_clinic
  on public.clinic_care_packages (clinic_id, updated_at desc);

alter table public.clinic_care_packages enable row level security;

drop policy if exists "care_pkg_read"  on public.clinic_care_packages;
create policy "care_pkg_read" on public.clinic_care_packages
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_care_packages.clinic_id
    )
  );

drop policy if exists "care_pkg_write" on public.clinic_care_packages;
create policy "care_pkg_write" on public.clinic_care_packages
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_care_packages.clinic_id
    )
  ) with check (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_care_packages.clinic_id
    )
  );

create or replace function public._touch_care_pkg()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_care_pkg on public.clinic_care_packages;
create trigger trg_touch_care_pkg before update on public.clinic_care_packages
  for each row execute function public._touch_care_pkg();


-- ── 4. The patient identifier (HP-XXXXXX) ─────────────────────────────────
-- The app computes this on the phone so it works with no network. This is the
-- SAME calculation in SQL, so the server and every device always agree.
--
-- Ugandan numbers get written 0788…, +256788…, 256788… or 788… — they are one
-- patient, so all four reduce to the bare 9-digit subscriber number first.
-- A patient with no usable phone falls back to their name.

create or replace function public.homatt_patient_id(p_src text)
returns text
language plpgsql
immutable
as $$
declare
  k     text;
  h     bigint := 2166136261;      -- FNV-1a 32-bit offset basis (0x811c9dc5)
  i     integer;
  n     bigint;
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  out36 text := '';
begin
  if p_src is null or btrim(p_src) = '' then
    return null;
  end if;

  k := regexp_replace(p_src, '[^0-9]', '', 'g');
  k := regexp_replace(k, '^0+', '');
  k := regexp_replace(k, '^256', '');
  if length(k) > 9 then
    k := right(k, 9);
  end if;
  if length(k) < 6 then
    k := regexp_replace(lower(p_src), '[^a-z0-9]', '', 'g');
  end if;
  if k = '' then
    return null;
  end if;

  for i in 1 .. length(k) loop
    h := (h # ascii(substr(k, i, 1)));
    h := (h * 16777619) % 4294967296;
  end loop;

  n := h;
  while n > 0 loop
    out36 := substr(digits, (n % 36)::int + 1, 1) || out36;
    n := n / 36;
  end loop;
  if out36 = '' then out36 := '0'; end if;
  out36 := upper(out36);
  -- Pad short codes, but never let lpad() TRUNCATE a long one — a 32-bit hash
  -- can be 7 base-36 digits and we keep the LAST six, exactly as the app does.
  if length(out36) < 6 then
    out36 := lpad(out36, 6, '0');
  end if;

  return 'HP-' || right(out36, 6);
end $$;

comment on function public.homatt_patient_id(text) is
  'Short, offline-stable patient code (HP-XXXXXX) from a phone number or, failing that, a name. Matches homattPatientId() in app/clinic/js/clinic.js exactly.';


-- ── 5. Convenience views and lookups ──────────────────────────────────────

-- Medicines only, tidy columns.
create or replace view public.v_emhslu_medicines as
  select id, name, dosage_form, strength, level_of_care, ven_class,
         category_number, category_title, specialist
    from public.emhslu_items
   where item_type = 'medicine';

-- One row per item per level it is allowed at.
create or replace view public.v_emhslu_by_level as
  select l.level, i.*
    from public.emhslu_item_levels l
    join public.emhslu_items i on i.id = l.item_id;

-- What may THIS clinic stock and prescribe? Uses the caller's own facility
-- level unless one is passed in. Returns an empty set until the clinic has
-- picked its level in Clinic Profile.
create or replace function public.emhslu_for_my_level(
  p_type  text default 'medicine',
  p_level text default null,
  p_limit integer default 2000)
returns table (
  id integer, name text, dosage_form text, strength text, specification text,
  level_of_care text, ven_class text, category_number text, category_title text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lvl text := p_level;
begin
  if lvl is null then
    select c.facility_level into lvl
      from portal_users pu
      join clinics c on c.id = pu.clinic_id
     where pu.auth_user_id = auth.uid()
       and pu.is_active = true
     limit 1;
  end if;
  if lvl is null then
    return;
  end if;

  return query
    select i.id, i.name, i.dosage_form, i.strength, i.specification,
           i.level_of_care, i.ven_class, i.category_number, i.category_title
      from emhslu_item_levels l
      join emhslu_items i on i.id = l.item_id
     where l.level = lvl
       and (p_type is null or i.item_type = p_type)
     order by i.name
     limit p_limit;
end $$;

-- Type-ahead search. Prefix matches come first, then anything containing the
-- text. `above_level` is true when the clinic's own level may not stock it.
create or replace function public.emhslu_search(
  p_q     text,
  p_type  text default 'medicine',
  p_level text default null,
  p_limit integer default 20)
returns table (
  id integer, name text, dosage_form text, strength text, specification text,
  level_of_care text, ven_class text, category_title text, above_level boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lvl  text := p_level;
  q    text := btrim(coalesce(p_q, ''));
  ord  constant text[] := array['HC1','HC2','HC3','HC4','H','RR','NR'];
begin
  if length(q) < 2 then
    return;
  end if;
  if lvl is null then
    select c.facility_level into lvl
      from portal_users pu
      join clinics c on c.id = pu.clinic_id
     where pu.auth_user_id = auth.uid()
       and pu.is_active = true
     limit 1;
  end if;

  return query
    select i.id, i.name, i.dosage_form, i.strength, i.specification,
           i.level_of_care, i.ven_class, i.category_title,
           (lvl is not null
            and i.level_of_care is not null
            and array_position(ord, i.level_of_care) > array_position(ord, lvl))
      from emhslu_items i
     where (p_type is null or i.item_type = p_type)
       and i.name ilike '%' || q || '%'
     order by (case when i.name ilike q || '%' then 0 else 1 end),
              length(i.name), i.name
     limit p_limit;
end $$;

grant execute on function public.homatt_patient_id(text)                   to authenticated;
grant execute on function public.emhslu_for_my_level(text, text, integer)  to authenticated;
grant execute on function public.emhslu_search(text, text, text, integer)  to authenticated;
