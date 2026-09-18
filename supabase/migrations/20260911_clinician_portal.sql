-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — the CLINICIAN portal
--
-- A clinician is a person, not a seat at one clinic. They sign up once,
-- carry their own profile and their own work record, and attach
-- TEMPORARILY to a clinic by scanning that clinic's QR code. When the
-- attachment ends the record stays with them and goes to the next
-- clinic; the patients do not.
--
-- ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────
-- PATIENT IDENTITY NEVER TRAVELS WITH THE CLINICIAN.
-- clinician_activity — the table that follows a clinician from clinic
-- to clinic — has NO patient name, NO phone, NO patient id, and no
-- column that could carry one. It records that a condition was treated,
-- at which clinic, on which day. That is a professional record. A list
-- of the people someone treated is a medical record, and it belongs to
-- the clinic that made it.
--
-- This is structural, not a policy: there is no column to leak. A
-- future change that adds one is the change to stop in review.
--
-- Tables
--   clinicians           the standalone professional identity
--   clinic_link_codes    the QR handshake — short-lived, revocable
--   clinic_clinicians    one attachment (a stint) of a clinician to a clinic
--   clinician_activity   automatic, patient-free log of work done
--   clinician_ratings    what an owner says when somebody leaves
--
-- Idempotent — safe to run more than once.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── 1. The clinician ────────────────────────────────────────────────
create table if not exists public.clinicians (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users(id) on delete cascade,
  full_name         text not null,
  profession        text,          -- Doctor / Clinical Officer / Nurse / Midwife / Lab
  cadre             text,          -- Medical Officer, Senior CO, Enrolled Nurse …
  registration_no   text,          -- UMDPC / UNMC / AHPC number
  registration_body text,
  qualification     text,          -- MBChB, Dip CM, BScN …
  years_experience  integer,
  phone             text,
  email             text,
  district          text,          -- where they stay
  sub_county        text,
  village           text,
  address           text,
  languages         text,
  bio               text,
  photo_url         text,
  is_active         boolean default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists clinicians_auth_idx on public.clinicians(auth_user_id);
create index if not exists clinicians_reg_idx  on public.clinicians(lower(registration_no));

comment on table public.clinicians is
  'A clinician''s own account. Independent of any clinic — it outlives every attachment.';

-- ── 2. The handshake code a clinic shows as a QR ────────────────────
create table if not exists public.clinic_link_codes (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  code         text not null unique,
  created_by   uuid,                       -- auth.users id of the owner
  role         text default 'visiting_clinician',
  access_days  integer default 30,         -- how long the access it grants lasts
  expires_at   timestamptz not null,       -- how long the CODE itself is good for
  max_uses     integer default 1,
  uses         integer default 0,
  revoked      boolean default false,
  created_at   timestamptz default now()
);

create index if not exists clinic_link_codes_clinic_idx on public.clinic_link_codes(clinic_id);
create index if not exists clinic_link_codes_code_idx   on public.clinic_link_codes(upper(code));

comment on table public.clinic_link_codes is
  'Short-lived codes a clinic shows as a QR. Scanning one attaches a clinician temporarily.';

-- ── 3. The attachment — one stint at one clinic ─────────────────────
create table if not exists public.clinic_clinicians (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  clinician_id  uuid not null references public.clinicians(id) on delete cascade,
  auth_user_id  uuid,                      -- denormalised: RLS reads it without a join
  status        text default 'active' check (status in ('active','ended','revoked','expired')),
  role          text default 'visiting_clinician',
  started_at    timestamptz default now(),
  expires_at    timestamptz,               -- TEMPORARY by default
  ended_at      timestamptz,
  ended_by      text check (ended_by in ('owner','clinician','expired','system')),
  end_reason    text,
  joined_via    text default 'qr',         -- 'qr' | 'code'
  link_code_id  uuid references public.clinic_link_codes(id) on delete set null,
  created_at    timestamptz default now()
);

create index if not exists clinic_clinicians_clinic_idx    on public.clinic_clinicians(clinic_id);
create index if not exists clinic_clinicians_clinician_idx on public.clinic_clinicians(clinician_id);
create index if not exists clinic_clinicians_auth_idx      on public.clinic_clinicians(auth_user_id);

comment on table public.clinic_clinicians is
  'One period of work by one clinician at one clinic. Temporary and revocable.';

-- ── 4. The work record that travels ─────────────────────────────────
-- Read the header of this file before adding a column here.
create table if not exists public.clinician_activity (
  id            uuid primary key default gen_random_uuid(),
  clinician_id  uuid not null references public.clinicians(id) on delete cascade,
  clinic_id     uuid references public.clinics(id) on delete set null,
  stint_id      uuid references public.clinic_clinicians(id) on delete set null,
  kind          text default 'treatment',
  condition     text,            -- WHAT was treated. Never WHO.
  severity      text,
  occurred_at   timestamptz default now(),
  created_at    timestamptz default now()
);

create index if not exists clinician_activity_clinician_idx on public.clinician_activity(clinician_id, occurred_at desc);
create index if not exists clinician_activity_clinic_idx    on public.clinician_activity(clinic_id, occurred_at desc);

comment on table public.clinician_activity is
  'Patient-free professional log. Deliberately has no column that can hold a patient identity.';
comment on column public.clinician_activity.condition is
  'The condition treated — never the person treated.';

-- ── 5. What an owner says when somebody leaves ──────────────────────
create table if not exists public.clinician_ratings (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  clinician_id   uuid not null references public.clinicians(id) on delete cascade,
  stint_id       uuid references public.clinic_clinicians(id) on delete set null,
  rated_by       uuid,
  rater_name     text,
  rating         integer check (rating between 1 and 5),
  care           integer check (care between 1 and 5),
  punctuality    integer check (punctuality between 1 and 5),
  record_keeping integer check (record_keeping between 1 and 5),
  teamwork       integer check (teamwork between 1 and 5),
  would_rehire   boolean,
  reference_note text,
  created_at     timestamptz default now(),
  unique (stint_id)
);

create index if not exists clinician_ratings_clinician_idx on public.clinician_ratings(clinician_id);

comment on table public.clinician_ratings is
  'An owner''s reference for a clinician who worked at their clinic. Travels with the clinician.';

-- ════════════════════════════════════════════════════════════════════
-- Row level security
--
-- These five tables are written tight, and deliberately so. The older
-- tables in this database carry permissive `using (true)` policies from
-- an earlier stage of the project; nothing here relies on them.
-- ════════════════════════════════════════════════════════════════════

alter table public.clinicians         enable row level security;
alter table public.clinic_link_codes  enable row level security;
alter table public.clinic_clinicians  enable row level security;
alter table public.clinician_activity enable row level security;
alter table public.clinician_ratings  enable row level security;

-- Is the caller an active owner of this clinic?
create or replace function public.is_clinic_owner(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.portal_users pu
     where pu.auth_user_id = auth.uid()
       and pu.clinic_id    = p_clinic_id
       and pu.is_active    = true
       and coalesce(pu.staff_role, 'owner') = 'owner'
  );
$$;
grant execute on function public.is_clinic_owner(uuid) to authenticated;

-- The caller's own clinician row id, if they have one.
create or replace function public.my_clinician_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.clinicians c where c.auth_user_id = auth.uid() limit 1;
$$;
grant execute on function public.my_clinician_id() to authenticated;

-- ── clinicians ──
-- A clinician reads and writes their own row. A clinic owner may read the
-- row of anybody who is, or has been, attached to their clinic — that is
-- how they see who they are letting in, and how a reference is checked.
drop policy if exists "clinician reads own record"      on public.clinicians;
drop policy if exists "clinician writes own record"     on public.clinicians;
drop policy if exists "clinician creates own record"    on public.clinicians;
drop policy if exists "owner reads attached clinicians" on public.clinicians;

create policy "clinician creates own record" on public.clinicians
  for insert to authenticated with check (auth_user_id = auth.uid());
create policy "clinician reads own record" on public.clinicians
  for select to authenticated using (auth_user_id = auth.uid());
create policy "clinician writes own record" on public.clinicians
  for update to authenticated using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
create policy "owner reads attached clinicians" on public.clinicians
  for select to authenticated using (
    exists (
      select 1 from public.clinic_clinicians cc
       where cc.clinician_id = clinicians.id
         and public.is_clinic_owner(cc.clinic_id)
    )
  );

-- ── clinic_link_codes ── owners only. A clinician never reads the table;
-- they redeem a code through an RPC, which is why a stolen code alone
-- tells an attacker nothing about the clinic.
drop policy if exists "owner manages link codes" on public.clinic_link_codes;
create policy "owner manages link codes" on public.clinic_link_codes
  for all to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id));

-- ── clinic_clinicians ──
drop policy if exists "clinician reads own attachments" on public.clinic_clinicians;
drop policy if exists "owner reads clinic attachments"  on public.clinic_clinicians;
drop policy if exists "owner ends attachments"          on public.clinic_clinicians;

create policy "clinician reads own attachments" on public.clinic_clinicians
  for select to authenticated using (auth_user_id = auth.uid());
create policy "owner reads clinic attachments" on public.clinic_clinicians
  for select to authenticated using (public.is_clinic_owner(clinic_id));
create policy "owner ends attachments" on public.clinic_clinicians
  for update to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id));

-- ── clinician_activity ── the clinician owns their record; the owner sees
-- what happened in their own clinic and nothing from anywhere else.
drop policy if exists "clinician reads own activity" on public.clinician_activity;
drop policy if exists "owner reads clinic activity"  on public.clinician_activity;

create policy "clinician reads own activity" on public.clinician_activity
  for select to authenticated using (clinician_id = public.my_clinician_id());
create policy "owner reads clinic activity" on public.clinician_activity
  for select to authenticated using (public.is_clinic_owner(clinic_id));

-- ── clinician_ratings ── an owner writes one for their own clinic; the
-- clinician can always read what was said about them.
drop policy if exists "clinician reads own ratings" on public.clinician_ratings;
drop policy if exists "owner writes ratings"        on public.clinician_ratings;

create policy "clinician reads own ratings" on public.clinician_ratings
  for select to authenticated using (clinician_id = public.my_clinician_id());
create policy "owner writes ratings" on public.clinician_ratings
  for all to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id));

-- ════════════════════════════════════════════════════════════════════
-- The clinician's own profile
-- ════════════════════════════════════════════════════════════════════

create or replace function public.save_my_clinician_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(trim(coalesce(p->>'full_name', '')), '');
  v_id   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in first');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'Your name is required');
  end if;

  insert into public.clinicians (
    auth_user_id, full_name, profession, cadre, registration_no, registration_body,
    qualification, years_experience, phone, email, district, sub_county, village,
    address, languages, bio, updated_at
  ) values (
    v_uid, v_name, p->>'profession', p->>'cadre', p->>'registration_no', p->>'registration_body',
    p->>'qualification', nullif(p->>'years_experience','')::integer, p->>'phone', lower(nullif(p->>'email','')),
    p->>'district', p->>'sub_county', p->>'village', p->>'address', p->>'languages', p->>'bio', now()
  )
  on conflict (auth_user_id) do update set
    full_name         = excluded.full_name,
    profession        = coalesce(excluded.profession,        public.clinicians.profession),
    cadre             = coalesce(excluded.cadre,             public.clinicians.cadre),
    registration_no   = coalesce(excluded.registration_no,   public.clinicians.registration_no),
    registration_body = coalesce(excluded.registration_body, public.clinicians.registration_body),
    qualification     = coalesce(excluded.qualification,     public.clinicians.qualification),
    years_experience  = coalesce(excluded.years_experience,  public.clinicians.years_experience),
    phone             = coalesce(excluded.phone,             public.clinicians.phone),
    email             = coalesce(excluded.email,             public.clinicians.email),
    district          = coalesce(excluded.district,          public.clinicians.district),
    sub_county        = coalesce(excluded.sub_county,        public.clinicians.sub_county),
    village           = coalesce(excluded.village,           public.clinicians.village),
    address           = coalesce(excluded.address,           public.clinicians.address),
    languages         = coalesce(excluded.languages,         public.clinicians.languages),
    bio               = coalesce(excluded.bio,               public.clinicians.bio),
    updated_at        = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
grant execute on function public.save_my_clinician_profile(jsonb) to authenticated;

-- Everything the clinician's own home screen needs, in one round trip —
-- because it is opened on a phone on a Ugandan connection.
create or replace function public.my_clinician_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := public.my_clinician_id();
  v_profile jsonb;
  v_links   jsonb;
  v_stats   jsonb;
  v_ratings jsonb;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'no clinician profile');
  end if;

  select to_jsonb(c) into v_profile from public.clinicians c where c.id = v_id;

  -- Expire anything whose time has quietly run out before reporting it as live.
  update public.clinic_clinicians
     set status = 'expired', ended_at = coalesce(ended_at, expires_at), ended_by = 'expired'
   where clinician_id = v_id and status = 'active'
     and expires_at is not null and expires_at < now();

  select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) into v_links
    from (
      select jsonb_build_object(
        'id', cc.id, 'clinic_id', cc.clinic_id, 'clinic_name', cl.name,
        'clinic_district', cl.district, 'status', cc.status, 'role', cc.role,
        'started_at', cc.started_at, 'expires_at', cc.expires_at, 'ended_at', cc.ended_at,
        'ended_by', cc.ended_by,
        'treatments', (select count(*) from public.clinician_activity a where a.stint_id = cc.id)
      ) as x
      from public.clinic_clinicians cc
      left join public.clinics cl on cl.id = cc.clinic_id
      where cc.clinician_id = v_id
    ) s;

  select jsonb_build_object(
    'treatments',  count(*),
    'clinics',     count(distinct clinic_id),
    'first_seen',  min(occurred_at),
    'last_seen',   max(occurred_at),
    'conditions',  (
      select coalesce(jsonb_agg(jsonb_build_object('condition', cond, 'n', n) order by n desc), '[]'::jsonb)
        from (select condition as cond, count(*) as n
                from public.clinician_activity
               where clinician_id = v_id and condition is not null
               group by condition order by count(*) desc limit 12) t
    )
  ) into v_stats
  from public.clinician_activity where clinician_id = v_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'clinic_name', cl.name, 'rating', r.rating, 'care', r.care,
      'punctuality', r.punctuality, 'record_keeping', r.record_keeping,
      'teamwork', r.teamwork, 'would_rehire', r.would_rehire,
      'reference_note', r.reference_note, 'rater_name', r.rater_name,
      'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into v_ratings
    from public.clinician_ratings r
    left join public.clinics cl on cl.id = r.clinic_id
   where r.clinician_id = v_id;

  return jsonb_build_object('ok', true, 'profile', v_profile,
    'links', v_links, 'stats', v_stats, 'ratings', v_ratings);
end;
$$;
grant execute on function public.my_clinician_home() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- The handshake
-- ════════════════════════════════════════════════════════════════════

-- Confusable characters are left out on purpose: this code gets read off
-- a screen and typed by somebody whose camera would not focus.
create or replace function public.gen_link_code()
returns text
language plpgsql
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out_code text := '';
  i        int;
begin
  for i in 1..8 loop
    out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out_code;
end;
$$;

create or replace function public.create_clinic_link_code(
  p_hours       integer default 24,
  p_max_uses    integer default 1,
  p_access_days integer default 30,
  p_role        text    default 'visiting_clinician'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_code      text;
  v_id        uuid;
  v_try       int := 0;
begin
  select pu.clinic_id into v_clinic_id
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
     and coalesce(pu.staff_role,'owner') = 'owner'
   limit 1;

  if v_clinic_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only the clinic owner can invite a clinician');
  end if;
  if p_role not in ('visiting_clinician','clinician','nurse') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role');
  end if;

  loop
    v_try := v_try + 1;
    v_code := public.gen_link_code();
    begin
      insert into public.clinic_link_codes
        (clinic_id, code, created_by, role, access_days, expires_at, max_uses)
      values
        (v_clinic_id, v_code, auth.uid(), p_role,
         greatest(1, least(coalesce(p_access_days, 30), 365)),
         now() + (greatest(1, least(coalesce(p_hours, 24), 720)) || ' hours')::interval,
         greatest(1, least(coalesce(p_max_uses, 1), 50)))
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 6 then
        return jsonb_build_object('ok', false, 'error', 'Could not make a code, try again');
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code,
    'clinic_id', v_clinic_id,
    'clinic_name', (select name from public.clinics where id = v_clinic_id),
    'expires_at', (select expires_at from public.clinic_link_codes where id = v_id),
    'access_days', (select access_days from public.clinic_link_codes where id = v_id));
end;
$$;
grant execute on function public.create_clinic_link_code(integer, integer, integer, text) to authenticated;

-- Scanning the QR, or typing the code, lands here.
create or replace function public.redeem_clinic_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   public.clinic_link_codes%rowtype;
  v_cid    uuid := public.my_clinician_id();
  v_stint  uuid;
  v_exp    timestamptz;
begin
  if v_cid is null then
    return jsonb_build_object('ok', false, 'error', 'Finish your clinician profile first');
  end if;

  select * into v_code from public.clinic_link_codes
   where upper(code) = upper(trim(coalesce(p_code, ''))) limit 1;

  -- One message for "no such code" and "expired code": a stranger holding a
  -- guess must not be told which of the two it was.
  if v_code.id is null or v_code.revoked or v_code.expires_at < now()
     or v_code.uses >= v_code.max_uses then
    return jsonb_build_object('ok', false, 'error', 'That code is not valid. Ask the clinic for a new one.');
  end if;

  v_exp := now() + (v_code.access_days || ' days')::interval;

  -- Coming back to a clinic you already work at renews the access rather
  -- than making a second record of the same job.
  select id into v_stint from public.clinic_clinicians
   where clinician_id = v_cid and clinic_id = v_code.clinic_id
     and status = 'active' limit 1;

  if v_stint is not null then
    update public.clinic_clinicians
       set expires_at = greatest(coalesce(expires_at, now()), v_exp),
           role = v_code.role
     where id = v_stint;
  else
    insert into public.clinic_clinicians
      (clinic_id, clinician_id, auth_user_id, status, role, started_at, expires_at,
       joined_via, link_code_id)
    values
      (v_code.clinic_id, v_cid, auth.uid(), 'active', v_code.role, now(), v_exp,
       'qr', v_code.id)
    returning id into v_stint;
  end if;

  update public.clinic_link_codes set uses = uses + 1 where id = v_code.id;

  return jsonb_build_object('ok', true,
    'stint_id',   v_stint,
    'clinic_id',  v_code.clinic_id,
    'clinic_name', (select name from public.clinics where id = v_code.clinic_id),
    'role',       v_code.role,
    'expires_at', v_exp);
end;
$$;
grant execute on function public.redeem_clinic_link_code(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- What the owner sees, and what they may say
-- ════════════════════════════════════════════════════════════════════

create or replace function public.clinic_clinicians_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_out       jsonb;
begin
  select pu.clinic_id into v_clinic_id
    from public.portal_users pu
   where pu.auth_user_id = auth.uid() and pu.is_active = true
     and coalesce(pu.staff_role,'owner') = 'owner' limit 1;

  if v_clinic_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only the clinic owner can see this');
  end if;

  update public.clinic_clinicians
     set status = 'expired', ended_at = coalesce(ended_at, expires_at), ended_by = 'expired'
   where clinic_id = v_clinic_id and status = 'active'
     and expires_at is not null and expires_at < now();

  select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object(
        'stint_id', cc.id, 'clinician_id', c.id, 'full_name', c.full_name,
        'profession', c.profession, 'cadre', c.cadre, 'phone', c.phone,
        'registration_no', c.registration_no, 'district', c.district,
        'status', cc.status, 'role', cc.role, 'started_at', cc.started_at,
        'expires_at', cc.expires_at, 'ended_at', cc.ended_at, 'ended_by', cc.ended_by,
        'treatments', (select count(*) from public.clinician_activity a
                        where a.stint_id = cc.id),
        'last_seen',  (select max(a.occurred_at) from public.clinician_activity a
                        where a.stint_id = cc.id),
        'rated',      exists (select 1 from public.clinician_ratings r where r.stint_id = cc.id),
        'rating',     (select r.rating from public.clinician_ratings r where r.stint_id = cc.id)
      ) as x
      from public.clinic_clinicians cc
      join public.clinicians c on c.id = cc.clinician_id
      where cc.clinic_id = v_clinic_id
    ) s;

  return jsonb_build_object('ok', true, 'clinicians', v_out);
end;
$$;
grant execute on function public.clinic_clinicians_list() to authenticated;

-- Who one clinician treated, INSIDE this clinic. The patient names in this
-- answer come from the clinic's own records and stay in the clinic's own
-- portal — they are not in clinician_activity and do not travel.
create or replace function public.clinic_clinician_detail(p_stint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc   public.clinic_clinicians%rowtype;
  v_work jsonb;
  v_days jsonb;
begin
  select * into v_cc from public.clinic_clinicians where id = p_stint_id;
  if v_cc.id is null or not public.is_clinic_owner(v_cc.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'Not your clinic');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', cd.created_at,
      'patient_name', cd.patient_name,
      'case_code', cd.case_code,
      'diagnosis', cd.confirmed_diagnosis,
      'severity', cd.severity) order by cd.created_at desc), '[]'::jsonb)
    into v_work
    from public.clinic_diagnoses cd
   where cd.clinic_id = v_cc.clinic_id
     and cd.clinician_id = v_cc.auth_user_id
     and cd.created_at >= v_cc.started_at
     and (v_cc.ended_at is null or cd.created_at <= v_cc.ended_at)
   limit 300;

  select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb)
    into v_days
    from (select date_trunc('day', occurred_at)::date as d, count(*) as n
            from public.clinician_activity
           where stint_id = p_stint_id
           group by 1 order by 1 desc limit 60) t;

  return jsonb_build_object('ok', true, 'work', v_work, 'by_day', v_days);
end;
$$;
grant execute on function public.clinic_clinician_detail(uuid) to authenticated;

create or replace function public.end_clinician_stint(
  p_stint_id uuid,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc    public.clinic_clinicians%rowtype;
  v_who   text;
begin
  select * into v_cc from public.clinic_clinicians where id = p_stint_id;
  if v_cc.id is null then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;

  if public.is_clinic_owner(v_cc.clinic_id) then
    v_who := 'owner';
  elsif v_cc.auth_user_id = auth.uid() then
    v_who := 'clinician';
  else
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  update public.clinic_clinicians
     set status = 'ended', ended_at = now(), ended_by = v_who,
         end_reason = nullif(trim(coalesce(p_reason,'')), '')
   where id = p_stint_id;

  return jsonb_build_object('ok', true, 'ended_by', v_who);
end;
$$;
grant execute on function public.end_clinician_stint(uuid, text) to authenticated;

create or replace function public.rate_clinician(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc  public.clinic_clinicians%rowtype;
  v_r   int := nullif(p->>'rating','')::int;
begin
  select * into v_cc from public.clinic_clinicians where id = (p->>'stint_id')::uuid;
  if v_cc.id is null or not public.is_clinic_owner(v_cc.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'Not your clinic');
  end if;
  if v_r is null or v_r < 1 or v_r > 5 then
    return jsonb_build_object('ok', false, 'error', 'Give a rating from 1 to 5');
  end if;

  insert into public.clinician_ratings (
    clinic_id, clinician_id, stint_id, rated_by, rater_name, rating,
    care, punctuality, record_keeping, teamwork, would_rehire, reference_note
  ) values (
    v_cc.clinic_id, v_cc.clinician_id, v_cc.id, auth.uid(),
    (select full_name from public.portal_users where auth_user_id = auth.uid() limit 1),
    v_r,
    nullif(p->>'care','')::int, nullif(p->>'punctuality','')::int,
    nullif(p->>'record_keeping','')::int, nullif(p->>'teamwork','')::int,
    nullif(p->>'would_rehire','')::boolean,
    nullif(trim(coalesce(p->>'reference_note','')), '')
  )
  on conflict (stint_id) do update set
    rating = excluded.rating, care = excluded.care,
    punctuality = excluded.punctuality, record_keeping = excluded.record_keeping,
    teamwork = excluded.teamwork, would_rehire = excluded.would_rehire,
    reference_note = excluded.reference_note;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
grant execute on function public.rate_clinician(jsonb) to authenticated;

-- The reference an owner reads BEFORE letting somebody in. Counts,
-- conditions and what other owners said — and not one patient.
create or replace function public.clinician_reference(p_clinician_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  -- Readable by the clinician themselves, or by an owner whose clinic they
  -- are (or were) attached to. Not by the world.
  select (c.auth_user_id = auth.uid())
      or exists (select 1 from public.clinic_clinicians cc
                  where cc.clinician_id = c.id and public.is_clinic_owner(cc.clinic_id))
    into v_ok
    from public.clinicians c where c.id = p_clinician_id;

  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  return jsonb_build_object('ok', true,
    'profile', (select jsonb_build_object(
        'full_name', full_name, 'profession', profession, 'cadre', cadre,
        'qualification', qualification, 'registration_no', registration_no,
        'registration_body', registration_body, 'years_experience', years_experience,
        'district', district, 'languages', languages, 'bio', bio)
      from public.clinicians where id = p_clinician_id),
    'stints', (select coalesce(jsonb_agg(jsonb_build_object(
        'clinic_name', cl.name, 'district', cl.district,
        'started_at', cc.started_at, 'ended_at', cc.ended_at, 'status', cc.status,
        'treatments', (select count(*) from public.clinician_activity a where a.stint_id = cc.id)
      ) order by cc.started_at desc), '[]'::jsonb)
      from public.clinic_clinicians cc left join public.clinics cl on cl.id = cc.clinic_id
      where cc.clinician_id = p_clinician_id),
    'totals', (select jsonb_build_object(
        'treatments', count(*), 'clinics', count(distinct clinic_id))
      from public.clinician_activity where clinician_id = p_clinician_id),
    'conditions', (select coalesce(jsonb_agg(jsonb_build_object('condition', cond, 'n', n) order by n desc), '[]'::jsonb)
      from (select condition as cond, count(*) as n from public.clinician_activity
             where clinician_id = p_clinician_id and condition is not null
             group by condition order by count(*) desc limit 12) t),
    'ratings', (select coalesce(jsonb_agg(jsonb_build_object(
        'clinic_name', cl.name, 'rating', r.rating, 'would_rehire', r.would_rehire,
        'reference_note', r.reference_note, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
      from public.clinician_ratings r left join public.clinics cl on cl.id = r.clinic_id
      where r.clinician_id = p_clinician_id),
    'average', (select round(avg(rating)::numeric, 1) from public.clinician_ratings
                 where clinician_id = p_clinician_id)
  );
end;
$$;
grant execute on function public.clinician_reference(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- "Every single thing is logged automatically"
--
-- A trigger, not a client call. A log the phone is asked to write is a
-- log that is missing exactly when it matters — the consultation that
-- was saved from the offline outbox, the one the app crashed after, the
-- one a future screen forgets to call. The row goes in beside the
-- treatment or not at all.
--
-- It copies the CONDITION and the DAY. It does not copy the patient,
-- and there is nowhere in clinician_activity to put one.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.log_clinician_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cid   uuid;
  v_stint uuid;
begin
  if new.clinician_id is null then return new; end if;

  select id into v_cid from public.clinicians where auth_user_id = new.clinician_id limit 1;
  if v_cid is null then return new; end if;   -- clinic staff, not a portal clinician

  select id into v_stint from public.clinic_clinicians
   where clinician_id = v_cid and clinic_id = new.clinic_id
   order by (status = 'active') desc, started_at desc limit 1;

  insert into public.clinician_activity
    (clinician_id, clinic_id, stint_id, kind, condition, severity, occurred_at)
  values
    (v_cid, new.clinic_id, v_stint, 'treatment',
     nullif(trim(coalesce(new.confirmed_diagnosis, '')), ''),
     new.severity, coalesce(new.created_at, now()));

  return new;
exception when others then
  -- A failed log must never cost a clinic the consultation it was logging.
  return new;
end;
$$;

drop trigger if exists trg_log_clinician_activity on public.clinic_diagnoses;
create trigger trg_log_clinician_activity
  after insert on public.clinic_diagnoses
  for each row execute function public.log_clinician_activity();

-- ── The role a visiting clinician holds ─────────────────────────────
-- portal_users.staff_role is constrained to a known list. A clinician who
-- arrives by QR is not a member of staff and has no row there, but the
-- constraint is widened so an owner can convert one into permanent staff
-- later without a second migration.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'portal_users_staff_role_check') then
    alter table public.portal_users drop constraint portal_users_staff_role_check;
  end if;
  alter table public.portal_users
    add constraint portal_users_staff_role_check
    check (staff_role in ('owner','clinician','nurse','receptionist','salesperson','visiting_clinician'));
end $$;

select 'clinician portal ready' as result;
