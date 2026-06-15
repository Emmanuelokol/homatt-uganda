-- ════════════════════════════════════════════════════════════════════
-- Unified Patient Identity
-- ────────────────────────────────────────────────────────────────────
-- One person = one phone number, everywhere. This migration creates a
-- single identity "spine" so that:
--
--   • When a clinic registers a walk-in by name + phone, that identity
--     is remembered centrally.
--   • When that same person later installs the app and signs up with the
--     same phone, the app automatically recognises them — their name and
--     clinic history link up on their own, no manual matching.
--   • When a guest books a clinic visit or orders from the preventive
--     shop, the first time they type their name+phone it is remembered;
--     every time after that the form is pre-filled and personalised.
--
-- The spine is `patient_directory`, keyed by a CANONICAL phone (the last
-- 9 significant digits) so that +256772123456, 0772123456 and 772123456
-- all resolve to the same person.
--
-- Identity only (name / dob / sex / link to app account) lives here.
-- Medical data stays in profiles + clinic_patients behind consent.
--
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Canonical phone normaliser ──
-- Strips spaces, +, country code and leading zero down to the 9 digits
-- that uniquely identify a Ugandan mobile line. The mobile app, clinic
-- portal and shop all funnel through this so formats can never split a
-- person into two identities.
create or replace function public.homatt_norm_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) < 9 then null
    else right(regexp_replace(p, '\D', '', 'g'), 9)
  end;
$$;

comment on function public.homatt_norm_phone is
  'Canonical Ugandan phone key: last 9 significant digits. +256772123456 / 0772123456 / 772123456 all map to 772123456.';

-- ── 2. The identity spine ──
create table if not exists public.patient_directory (
  phone_norm        text primary key,
  full_name         text,
  date_of_birth     date,
  sex               text,
  district          text,
  city              text,
  profile_id        uuid references auth.users(id) on delete set null,
  first_seen_source text default 'app',   -- app | booking | shop | clinic
  visit_count       integer default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

comment on table public.patient_directory is
  'Single source of truth mapping a canonical phone number to a person. Populated by the app, clinic portal, booking and shop flows.';

-- Locked down: reached only through the SECURITY DEFINER RPCs below, never
-- queried directly by the client, so guests can never enumerate identities.
alter table public.patient_directory enable row level security;

create index if not exists idx_patient_directory_profile
  on public.patient_directory (profile_id) where profile_id is not null;

-- Functional indexes so the normalised phone lookup is instant on the
-- existing tables too.
create index if not exists idx_profiles_phone_norm
  on public.profiles (public.homatt_norm_phone(phone_number));
create index if not exists idx_clinic_patients_phone_norm
  on public.clinic_patients (public.homatt_norm_phone(phone));

-- ── 3. get_patient_identity: read-only "do we know this phone?" ──
-- Returns identity only (no medical data) so it is safe for anonymous
-- callers (guest booking / shop). UI uses it to pre-fill and greet.
create or replace function public.get_patient_identity(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.homatt_norm_phone(p_phone);
  v_dir  public.patient_directory%rowtype;
  v_prof record;
begin
  if v_norm is null then
    return jsonb_build_object('found', false, 'invalid', true);
  end if;

  select * into v_dir from public.patient_directory where phone_norm = v_norm;

  -- Fall back to a direct profiles match if the directory has not caught
  -- this person yet (e.g. profile created before this migration).
  if not found then
    select first_name, last_name, dob, sex, district, city, id
      into v_prof
      from public.profiles
     where public.homatt_norm_phone(phone_number) = v_norm
     limit 1;
    if found then
      return jsonb_build_object(
        'found', true,
        'is_new', false,
        'phone_norm', v_norm,
        'full_name', trim(coalesce(v_prof.first_name,'') || ' ' || coalesce(v_prof.last_name,'')),
        'date_of_birth', v_prof.dob,
        'sex', v_prof.sex,
        'district', v_prof.district,
        'city', v_prof.city,
        'has_app_account', true,
        'profile_id', v_prof.id
      );
    end if;
    return jsonb_build_object('found', false, 'is_new', true, 'phone_norm', v_norm);
  end if;

  return jsonb_build_object(
    'found', true,
    'is_new', false,
    'phone_norm', v_dir.phone_norm,
    'full_name', v_dir.full_name,
    'date_of_birth', v_dir.date_of_birth,
    'sex', v_dir.sex,
    'district', v_dir.district,
    'city', v_dir.city,
    'has_app_account', (v_dir.profile_id is not null),
    'profile_id', v_dir.profile_id,
    'visit_count', v_dir.visit_count
  );
end;
$$;

grant execute on function public.get_patient_identity(text) to anon, authenticated;

-- ── 4. find_or_register_patient: the universal find-or-create ──
-- The single "strong point" the whole app checks against. Given a phone
-- (and optionally a name / dob / sex), it tells the caller whether this
-- person is brand new or already known, remembering them either way so
-- the next visit is personalised. Never overwrites details already on
-- file — only fills blanks.
create or replace function public.find_or_register_patient(
  p_phone  text,
  p_name   text default null,
  p_dob    date default null,
  p_sex    text default null,
  p_district text default null,
  p_city   text default null,
  p_source text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.homatt_norm_phone(p_phone);
  v_dir  public.patient_directory%rowtype;
  v_is_new boolean := false;
begin
  if v_norm is null then
    return jsonb_build_object('found', false, 'invalid', true);
  end if;

  select * into v_dir from public.patient_directory where phone_norm = v_norm;

  if not found then
    insert into public.patient_directory
      (phone_norm, full_name, date_of_birth, sex, district, city, first_seen_source, visit_count)
    values
      (v_norm, nullif(trim(coalesce(p_name,'')),''), p_dob, p_sex, p_district, p_city, p_source, 1)
    returning * into v_dir;
    v_is_new := true;
  else
    -- Known person: fill only the blanks, bump the visit counter.
    update public.patient_directory
       set full_name     = coalesce(full_name, nullif(trim(coalesce(p_name,'')),'')),
           date_of_birth = coalesce(date_of_birth, p_dob),
           sex           = coalesce(sex, p_sex),
           district      = coalesce(district, p_district),
           city          = coalesce(city, p_city),
           visit_count   = visit_count + 1,
           updated_at    = now()
     where phone_norm = v_norm
     returning * into v_dir;
  end if;

  return jsonb_build_object(
    'found', not v_is_new,
    'is_new', v_is_new,
    'phone_norm', v_dir.phone_norm,
    'full_name', v_dir.full_name,
    'date_of_birth', v_dir.date_of_birth,
    'sex', v_dir.sex,
    'district', v_dir.district,
    'city', v_dir.city,
    'has_app_account', (v_dir.profile_id is not null),
    'profile_id', v_dir.profile_id,
    'visit_count', v_dir.visit_count
  );
end;
$$;

grant execute on function public.find_or_register_patient(text, text, date, text, text, text, text)
  to anon, authenticated;

-- ── 5. Auto-link triggers ──
-- Keep the directory + clinic_patients + profiles stitched together
-- automatically, so a person seen at a clinic is recognised the instant
-- they create an app account (and vice-versa) — no manual matching.

-- 5a. When a profile is created or its phone changes:
--     • upsert that identity into the directory, claiming the profile_id
--     • back-fill profile_id onto any clinic_patients with the same phone
create or replace function public.sync_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.homatt_norm_phone(new.phone_number);
begin
  if v_norm is null then
    return new;
  end if;

  insert into public.patient_directory
    (phone_norm, full_name, date_of_birth, sex, district, city, profile_id, first_seen_source, visit_count)
  values
    (v_norm,
     nullif(trim(coalesce(new.first_name,'') || ' ' || coalesce(new.last_name,'')),''),
     new.dob, new.sex, new.district, new.city, new.id, 'app', 1)
  on conflict (phone_norm) do update
    set profile_id    = excluded.profile_id,
        full_name     = coalesce(public.patient_directory.full_name, excluded.full_name),
        date_of_birth = coalesce(public.patient_directory.date_of_birth, excluded.date_of_birth),
        sex           = coalesce(public.patient_directory.sex, excluded.sex),
        district      = coalesce(public.patient_directory.district, excluded.district),
        city          = coalesce(public.patient_directory.city, excluded.city),
        updated_at    = now();

  -- Link any clinic walk-in stubs for the same phone that aren't linked yet.
  update public.clinic_patients
     set profile_id = new.id,
         updated_at = now()
   where profile_id is null
     and public.homatt_norm_phone(phone) = v_norm;

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_identity on public.profiles;
create trigger trg_sync_profile_identity
  after insert or update of phone_number, first_name, last_name, dob, sex, district, city
  on public.profiles
  for each row execute function public.sync_profile_identity();

-- 5b. When a clinic registers / updates a walk-in:
--     • upsert into the directory
--     • if an app account already exists for that phone, link it now
create or replace function public.sync_clinic_patient_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.homatt_norm_phone(new.phone);
  v_profile_id uuid;
begin
  if v_norm is null then
    return new;
  end if;

  -- Find an existing app account for this phone.
  select id into v_profile_id
    from public.profiles
   where public.homatt_norm_phone(phone_number) = v_norm
   limit 1;

  if v_profile_id is not null and new.profile_id is null then
    new.profile_id := v_profile_id;
  end if;

  insert into public.patient_directory
    (phone_norm, full_name, date_of_birth, sex, profile_id, first_seen_source, visit_count)
  values
    (v_norm, new.full_name, new.date_of_birth, new.sex,
     coalesce(new.profile_id, v_profile_id), 'clinic', 1)
  on conflict (phone_norm) do update
    set full_name     = coalesce(public.patient_directory.full_name, excluded.full_name),
        date_of_birth = coalesce(public.patient_directory.date_of_birth, excluded.date_of_birth),
        sex           = coalesce(public.patient_directory.sex, excluded.sex),
        profile_id    = coalesce(public.patient_directory.profile_id, excluded.profile_id),
        updated_at    = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_clinic_patient_identity on public.clinic_patients;
create trigger trg_sync_clinic_patient_identity
  before insert or update of phone, full_name, date_of_birth, sex
  on public.clinic_patients
  for each row execute function public.sync_clinic_patient_identity();

-- ── 6. Back-fill the directory from existing data (one-off, idempotent) ──
insert into public.patient_directory
  (phone_norm, full_name, date_of_birth, sex, district, city, profile_id, first_seen_source)
select distinct on (public.homatt_norm_phone(p.phone_number))
  public.homatt_norm_phone(p.phone_number),
  nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')),''),
  p.dob, p.sex, p.district, p.city, p.id, 'app'
from public.profiles p
where public.homatt_norm_phone(p.phone_number) is not null
order by public.homatt_norm_phone(p.phone_number), p.updated_at desc nulls last
on conflict (phone_norm) do update
  set profile_id = coalesce(public.patient_directory.profile_id, excluded.profile_id),
      full_name  = coalesce(public.patient_directory.full_name, excluded.full_name);

insert into public.patient_directory
  (phone_norm, full_name, date_of_birth, sex, profile_id, first_seen_source)
select distinct on (public.homatt_norm_phone(cp.phone))
  public.homatt_norm_phone(cp.phone),
  cp.full_name, cp.date_of_birth, cp.sex, cp.profile_id, 'clinic'
from public.clinic_patients cp
where public.homatt_norm_phone(cp.phone) is not null
order by public.homatt_norm_phone(cp.phone), cp.updated_at desc nulls last
on conflict (phone_norm) do update
  set full_name = coalesce(public.patient_directory.full_name, excluded.full_name);

-- Link existing clinic stubs to existing app accounts by phone.
update public.clinic_patients cp
   set profile_id = p.id, updated_at = now()
  from public.profiles p
 where cp.profile_id is null
   and public.homatt_norm_phone(cp.phone) = public.homatt_norm_phone(p.phone_number);

select 'Unified patient identity ready' as result,
       (select count(*) from public.patient_directory) as identities_indexed;
