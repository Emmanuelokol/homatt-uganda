-- ════════════════════════════════════════════════════════════════════
-- The vital flowsheet — a reading, the time it was taken, and what was
-- done about it
-- ════════════════════════════════════════════════════════════════════
--
-- "Monitor BP every 5 minutes" and "her pressure every morning for a month"
-- are the same question asked over two timescales: is this person getting
-- worse, holding, or responding? Today the app can answer neither. Vitals are
-- taken once, at intake, and written into `clinical_findings` as a sentence.
-- A sentence cannot be plotted, cannot be compared with the one before it, and
-- cannot be counted.
--
-- So: one row per reading, and a note that belongs to that reading.
--
-- ── A READING IS NEVER EDITED AND NEVER DELETED ─────────────────────
--
-- This is the one design decision in the file and it is deliberate. The rest
-- of this app can correct a sale, a fee or a patient's name, because those are
-- facts about an agreement and an agreement can be wrong. A vital sign is not
-- that. It is an observation of a person at an instant, and the instant is
-- gone. "Her pressure at 10:15 was 190/110" cannot be made untrue later; it
-- can only be marked as having been written down wrongly.
--
-- Rewriting one in place would also destroy the only thing the flowsheet is
-- for. Every delta, every arrow and every trend line is computed from the row
-- BEFORE — so silently changing a reading changes the meaning of its
-- neighbours too, and a chart somebody has already acted on becomes a
-- different chart with no trace.
--
-- So there is no update policy and no delete policy on the readings at all.
-- A mistake is VOIDED — struck through, with a reason and a name against it —
-- and a corrected reading is entered as its own row. The wrong one stays
-- visible and stays out of the arithmetic. That is how a paper observation
-- chart has always worked, and for the same reason.
--
-- ── WHO MAY DO WHAT ─────────────────────────────────────────────────
--
--   record a reading   any active member of this clinic's staff, including a
--                      visiting clinician. Taking observations is the work.
--   void one           the person who recorded it, or the main account. Not
--                      anybody else: striking out somebody else's observation
--                      is not a correction, it is an assertion about what they
--                      saw.
--   read them          this clinic's staff, and nobody else's.
--   destroy one        nobody. There is no delete policy. A row cannot be
--                      removed through the API by any role.
--
-- ── EVERY SECURITY-DEFINER FUNCTION CHECKS ITS CALLER ───────────────
--
-- The hole found in 20260912 — adjust_inventory, deduct_inventory and
-- get_clinic_stock all ran as the function's owner, so RLS never applied to
-- them, and none of the three checked that the CALLER belonged to the clinic
-- whose id was passed in. RLS on a table says nothing about a security-definer
-- function that touches it. Both functions below check the caller first,
-- before they look at anything else.

-- ── 1. The readings ─────────────────────────────────────────────────
create table if not exists public.vital_logs (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,

  -- WHO. A clinic patient where there is one; a walk-in treated once may have
  -- no patient row at all, and the visit is then the only identity there is.
  clinic_patient_id uuid,

  -- WHICH OCCASION. Null on purpose for the chronic case: somebody coming in
  -- every month to have their pressure taken is not a treatment each time, and
  -- requiring one would either invent empty visits or lose the readings.
  diagnosis_id      uuid,

  systolic          integer,
  diastolic         integer,
  pulse             integer,
  temp_c            numeric(4,1),
  resp_rate         integer,
  spo2              integer,
  weight_kg         numeric(5,1),

  /* MAP is GENERATED, not stored by the client and not recomputed on read.
   *
   * A derived number written by the app can disagree with the numbers it came
   * from — after a bad sync, an older build, a hand-written row — and there is
   * nothing on the far side to notice. A generated column cannot: Postgres
   * recomputes it from this row's own systolic and diastolic and there is no
   * way to write a different value into it.
   *
   * MAP = DBP + (SBP − DBP)/3. The same formula the phone uses, so the two can
   * never drift; the phone has it because the flowsheet must work with no
   * connection at all. */
  map_mmhg numeric(5,1) generated always as (
    case
      when systolic is not null and diastolic is not null
       and systolic > 0 and diastolic > 0 and diastolic <= systolic
      then round(diastolic + (systolic - diastolic) / 3.0, 1)
      else null
    end
  ) stored,

  /* WHEN THE READING WAS TAKEN, which is not when the row was written. A nurse
   * on a ward round writes four observations up at the end of it, and a phone
   * with no signal writes them whenever it next has one. `logged_at` is the
   * clinical fact and is what everything sorts and plots by; `created_at` is
   * the database's own bookkeeping. Keeping them apart is what makes a
   * retroactive entry honest rather than a lie about the clock. */
  logged_at         timestamptz not null default now(),
  back_entered      boolean not null default false,

  recorded_by       uuid references auth.users(id),
  recorded_by_name  text,
  -- 'manual' | 'intake' | 'dictation' — where the numbers came from, because
  -- a dictated reading and a typed one are not equally likely to be right.
  source            text not null default 'manual',

  -- Struck through, not erased. See the header.
  voided_at         timestamptz,
  voided_by         uuid references auth.users(id),
  void_reason       text,

  created_at        timestamptz default now(),

  /* A row with nothing measured in it is noise on a chart, and the commonest
   * way to get one is a half-finished form being saved. */
  constraint vital_logs_has_something check (
    systolic is not null or diastolic is not null or pulse is not null or
    temp_c is not null or resp_rate is not null or spo2 is not null or
    weight_kg is not null
  ),

  /* DELIBERATELY LOOSE. These reject what cannot be a living human, not what
   * is unlikely — a constraint tight enough to catch a typo is also tight
   * enough to reject a real reading from a patient in extremis, and a rejected
   * insert loses the observation entirely. The narrow, clinically-interesting
   * ranges are the app's job, where a questionable number can be queried on
   * screen with the patient still in the room. */
  constraint vital_logs_plausible check (
    (systolic  is null or systolic  between 30 and 300) and
    (diastolic is null or diastolic between 10 and 250) and
    (pulse     is null or pulse     between 15 and 320) and
    (temp_c    is null or temp_c    between 20 and 46)  and
    (resp_rate is null or resp_rate between 2  and 99)  and
    (spo2      is null or spo2      between 30 and 100) and
    (weight_kg is null or weight_kg between 0.3 and 400)
  )
);

-- Added separately so the table can gain them on a database that already has
-- an older shape, which `create table if not exists` alone would skip.
alter table public.vital_logs
  add column if not exists back_entered     boolean not null default false,
  add column if not exists recorded_by_name text,
  add column if not exists source           text not null default 'manual',
  add column if not exists voided_at        timestamptz,
  add column if not exists voided_by        uuid,
  add column if not exists void_reason      text,
  add column if not exists spo2             integer,
  add column if not exists resp_rate        integer,
  add column if not exists weight_kg        numeric(5,1);

-- The flowsheet always asks the same question: this patient, newest first.
create index if not exists idx_vital_logs_patient
  on public.vital_logs (clinic_id, clinic_patient_id, logged_at desc);
create index if not exists idx_vital_logs_visit
  on public.vital_logs (diagnosis_id, logged_at desc);

-- ── 2. The note tied to a reading ───────────────────────────────────
--
-- "190/110" and "gave labetalol 20mg IV" are one fact, not two. A note filed
-- against the patient with its own timestamp would end up minutes away from
-- the reading it explains — and on a chart where a fall of 30 mmHg is the
-- thing being judged, "before or after the drug" is the entire question. So
-- the note hangs off the reading's id and moves with it.
create table if not exists public.vital_notes (
  id            uuid primary key default gen_random_uuid(),
  vital_log_id  uuid not null references public.vital_logs(id) on delete cascade,
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  note_text     text not null,
  -- 'MEDICATION_GIVEN' | 'OBSERVATION' | 'DOCTOR_ORDER' | 'EVENT'
  action_type   text not null default 'OBSERVATION',
  author_id     uuid references auth.users(id),
  author_name   text,
  voided_at     timestamptz,
  voided_by     uuid references auth.users(id),
  created_at    timestamptz default now(),
  constraint vital_notes_not_empty check (length(btrim(note_text)) > 0)
);

alter table public.vital_notes
  add column if not exists author_name text,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid;

create index if not exists idx_vital_notes_log
  on public.vital_notes (vital_log_id, created_at);

-- ── 3. The monitoring order ─────────────────────────────────────────
--
-- "Every 15 minutes" is an instruction from one person to whoever is on the
-- ward next, so it cannot live in the phone that received it. One active
-- watch per patient; starting a new one ends the old one, because two
-- intervals running on one patient is an argument, not an order.
create table if not exists public.vital_watch (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  clinic_patient_id uuid,
  diagnosis_id      uuid,
  interval_minutes  integer not null,
  reason            text,
  started_by        uuid references auth.users(id),
  started_by_name   text,
  started_at        timestamptz not null default now(),
  stopped_at        timestamptz,
  stopped_by        uuid references auth.users(id),
  created_at        timestamptz default now(),
  constraint vital_watch_interval check (interval_minutes between 1 and 1440)
);

create index if not exists idx_vital_watch_active
  on public.vital_watch (clinic_id, clinic_patient_id)
  where stopped_at is null;

-- ── 4. Row level security ───────────────────────────────────────────
alter table public.vital_logs  enable row level security;
alter table public.vital_notes enable row level security;
alter table public.vital_watch enable row level security;

-- `is_clinic_staff` comes from 20260912_owner_corrections.sql. Defined again
-- here, identically, so this migration can be applied to a database that has
-- not had that one yet — `create or replace` with the same body is a no-op
-- where it already exists.
create or replace function public.is_clinic_staff(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.portal_users pu
    where pu.auth_user_id = auth.uid()
      and pu.is_active = true
      and pu.clinic_id = p_clinic_id
  );
$$;
grant execute on function public.is_clinic_staff(uuid) to authenticated;

-- Likewise `is_clinic_main_account`, which void_vital_log() calls. plpgsql
-- resolves a missing function at RUN time, not at create time — so without
-- this, a database that skipped 20260912 would accept this whole migration
-- and then fail on the first strike-out, which is exactly the kind of fault
-- that only appears in a clinic.
create or replace function public.is_clinic_main_account(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.portal_users pu
    where pu.auth_user_id = auth.uid()
      and pu.is_active = true
      and pu.clinic_id = p_clinic_id
      and coalesce(pu.staff_role, 'owner') = 'owner'
  );
$$;
grant execute on function public.is_clinic_main_account(uuid) to authenticated;

-- READ: this clinic's staff.
drop policy if exists "vital_logs_read" on public.vital_logs;
create policy "vital_logs_read" on public.vital_logs
  for select using (public.is_clinic_staff(clinic_id));

-- WRITE: this clinic's staff, and only as themselves. `recorded_by` is checked
-- against auth.uid() so a row cannot be filed under somebody else's name —
-- on an observation chart the signature is part of the observation.
drop policy if exists "vital_logs_insert" on public.vital_logs;
create policy "vital_logs_insert" on public.vital_logs
  for insert with check (
    public.is_clinic_staff(clinic_id)
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE policy and no DELETE policy, on purpose. Voiding goes through
-- void_vital_log() below, which is the only path that can write those columns.

drop policy if exists "vital_notes_read" on public.vital_notes;
create policy "vital_notes_read" on public.vital_notes
  for select using (public.is_clinic_staff(clinic_id));

drop policy if exists "vital_notes_insert" on public.vital_notes;
create policy "vital_notes_insert" on public.vital_notes
  for insert with check (
    public.is_clinic_staff(clinic_id)
    and (author_id is null or author_id = auth.uid())
    -- and the reading it hangs off must be one of this clinic's own
    and exists (
      select 1 from public.vital_logs vl
      where vl.id = vital_log_id and vl.clinic_id = vital_notes.clinic_id
    )
  );

drop policy if exists "vital_watch_read" on public.vital_watch;
create policy "vital_watch_read" on public.vital_watch
  for select using (public.is_clinic_staff(clinic_id));

drop policy if exists "vital_watch_insert" on public.vital_watch;
create policy "vital_watch_insert" on public.vital_watch
  for insert with check (public.is_clinic_staff(clinic_id));

-- Stopping a watch is ordinary clinical work — the patient stabilised, or the
-- order was carried out. Any of this clinic's staff may, and the only thing
-- that may be changed is that it stopped.
drop policy if exists "vital_watch_stop" on public.vital_watch;
create policy "vital_watch_stop" on public.vital_watch
  for update using (public.is_clinic_staff(clinic_id))
  with check (public.is_clinic_staff(clinic_id));

-- ── 5. Voiding a reading ────────────────────────────────────────────
create or replace function public.void_vital_log(
  p_log_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.vital_logs%rowtype;
begin
  select * into v_row from public.vital_logs where id = p_log_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No such reading.');
  end if;

  -- THE CALLER CHECK. This function runs as its owner and RLS never sees it,
  -- so without this any authenticated Homatt user — a patient account, a
  -- clinician attached to somewhere else — could strike out this clinic's
  -- observations given an id.
  if not public.is_clinic_staff(v_row.clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'Not your clinic.');
  end if;

  -- Whoever wrote it, or the main account. Striking out somebody else's
  -- observation is a statement about what they saw, and it needs the
  -- authority the clinic actually recognises.
  if v_row.recorded_by is distinct from auth.uid()
     and not public.is_clinic_main_account(v_row.clinic_id) then
    return jsonb_build_object('ok', false, 'error',
      'Only the person who recorded this reading, or the main account, can strike it out.');
  end if;

  if v_row.voided_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'error',
      'Say why it is being struck out.');
  end if;

  update public.vital_logs
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_log_id;

  -- The same audit table the corrections feature writes to, where it exists.
  -- A clinic that has not applied that migration still gets the void; it just
  -- gets no second copy of the record of it.
  begin
    insert into public.clinic_record_edits
      (clinic_id, record_type, record_id, action, before_json, after_json, reason, edited_by)
    values (v_row.clinic_id, 'vital_log', p_log_id, 'void',
            to_jsonb(v_row), null, btrim(p_reason), auth.uid());
  exception when undefined_table then null;
  end;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.void_vital_log(uuid, text) to authenticated;

-- ── 6. Reading a patient's flowsheet ────────────────────────────────
--
-- A plain select would do, and the app uses one. This exists for the case the
-- plain select cannot serve: a patient with no `clinic_patients` row, whose
-- readings are tied to visits instead, where the query is a join the client
-- would otherwise have to get right in four places.
create or replace function public.get_vital_flowsheet(
  p_clinic_id uuid,
  p_patient_id uuid default null,
  p_diagnosis_id uuid default null,
  p_since timestamptz default null,
  p_limit integer default 500
) returns setof public.vital_logs
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Again: security definer, so the caller is checked here or not at all.
  if not public.is_clinic_staff(p_clinic_id) then
    return;
  end if;

  return query
    select vl.* from public.vital_logs vl
    where vl.clinic_id = p_clinic_id
      and (p_patient_id is null or vl.clinic_patient_id = p_patient_id)
      and (p_diagnosis_id is null or vl.diagnosis_id = p_diagnosis_id)
      and (p_since is null or vl.logged_at >= p_since)
    order by vl.logged_at desc
    limit greatest(1, least(coalesce(p_limit, 500), 2000));
end $$;

grant execute on function public.get_vital_flowsheet(uuid, uuid, uuid, timestamptz, integer) to authenticated;

-- ── 7. Starting and stopping a watch ────────────────────────────────
create or replace function public.start_vital_watch(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_diagnosis_id uuid,
  p_interval_minutes integer,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_name text;
begin
  if not public.is_clinic_staff(p_clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'Not your clinic.');
  end if;
  if p_interval_minutes is null or p_interval_minutes < 1 or p_interval_minutes > 1440 then
    return jsonb_build_object('ok', false, 'error', 'Choose an interval between 1 minute and a day.');
  end if;

  select pu.full_name into v_name from public.portal_users pu
   where pu.auth_user_id = auth.uid() and pu.clinic_id = p_clinic_id limit 1;

  -- One order at a time, per patient. Two running intervals is an argument.
  update public.vital_watch
     set stopped_at = now(), stopped_by = auth.uid()
   where clinic_id = p_clinic_id
     and stopped_at is null
     and clinic_patient_id is not distinct from p_patient_id;

  insert into public.vital_watch
    (clinic_id, clinic_patient_id, diagnosis_id, interval_minutes, reason,
     started_by, started_by_name)
  values (p_clinic_id, p_patient_id, p_diagnosis_id, p_interval_minutes,
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), v_name)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.start_vital_watch(uuid, uuid, uuid, integer, text) to authenticated;

create or replace function public.stop_vital_watch(
  p_watch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.vital_watch where id = p_watch_id;
  if v_clinic is null then
    return jsonb_build_object('ok', false, 'error', 'No such watch.');
  end if;
  if not public.is_clinic_staff(v_clinic) then
    return jsonb_build_object('ok', false, 'error', 'Not your clinic.');
  end if;
  update public.vital_watch
     set stopped_at = coalesce(stopped_at, now()), stopped_by = auth.uid()
   where id = p_watch_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.stop_vital_watch(uuid) to authenticated;

-- ── 8. Grants ───────────────────────────────────────────────────────
-- Supabase grants these by default; stated here so a self-hosted database
-- behaves the same. Note there is no delete grant on the readings: the
-- policies already forbid it, and this says the same thing twice on purpose.
grant select, insert on public.vital_logs  to authenticated;
grant select, insert on public.vital_notes to authenticated;
grant select, insert, update on public.vital_watch to authenticated;
