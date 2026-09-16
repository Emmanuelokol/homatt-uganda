-- The vital flowsheet, driven against a real Postgres.
--
-- Everything worth checking here is an RLS policy, a generated column, a
-- constraint or a security-definer function, and a browser test that mocks the
-- network can reach none of them.
--
-- The important half is not "a nurse can record a reading". It is:
--   • that NOBODY can delete one, by any route, including the owner;
--   • that a stranger holding the ids cannot read, write or strike out this
--     clinic's observations through the security-definer functions, which is
--     the hole that was found in adjust_inventory;
--   • that MAP cannot be made to disagree with the numbers it came from.
--
-- Every direct-row attempt runs `set role authenticated` first. Without it the
-- test connects as postgres, which is a superuser, bypasses RLS completely,
-- and reports every policy as broken.

\set ON_ERROR_STOP on
set client_min_messages to notice;

create or replace function ck(name text, ok boolean, got text default null) returns void
language plpgsql as $$
begin
  raise notice '%', (case when ok then 'PASS' else 'FAIL' end) || '  ' || name ||
    (case when got is null or got = '' then '' else '  — ' || got end);
end $$;

do $$
declare
  v_clinic   uuid := '66666666-6666-4666-8666-111111111111';
  v_other    uuid := '66666666-6666-4666-8666-222222222222';
  v_owner    uuid := '77777777-7777-4777-8777-111111111111';
  v_nurse    uuid := '77777777-7777-4777-8777-222222222222';
  v_nurse2   uuid := '77777777-7777-4777-8777-333333333333';
  v_guest    uuid := '77777777-7777-4777-8777-444444444444';
  v_outsider uuid := '77777777-7777-4777-8777-555555555555';
  v_pat      uuid;
  v_log      uuid;
  v_log2     uuid;
  v_note     uuid;
  v_watch    uuid;
  r          jsonb;
  n          numeric;
  t          text;
  i          integer;
begin
  -- ── the cast ──────────────────────────────────────────────────────
  insert into auth.users(id, email) values
    (v_owner, 'vowner@c.ug'), (v_nurse, 'vnurse@c.ug'), (v_nurse2, 'vnurse2@c.ug'),
    (v_guest, 'vguest@c.ug'), (v_outsider, 'vout@c.ug')
  on conflict do nothing;

  insert into public.clinics(id, name) values
    (v_clinic, 'Jinja Clinic'), (v_other, 'Mbale Clinic')
  on conflict do nothing;

  insert into public.portal_users(auth_user_id, clinic_id, is_active, staff_role, full_name) values
    (v_owner,    v_clinic, true, 'owner',              'Owner'),
    (v_nurse,    v_clinic, true, 'nurse',              'Nurse A'),
    (v_nurse2,   v_clinic, true, 'nurse',              'Nurse B'),
    (v_guest,    v_clinic, true, 'visiting_clinician', 'Guest'),
    (v_outsider, v_other,  true, 'owner',              'Stranger')
  on conflict do nothing;

  insert into public.clinic_patients(clinic_id, full_name, phone)
  values (v_clinic, 'Nakato Sarah', '0700000111')
  returning id into v_pat;

  -- ── 1. Recording a reading ────────────────────────────────────────
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_logs
    (clinic_id, clinic_patient_id, systolic, diastolic, pulse, recorded_by, recorded_by_name)
  values (v_clinic, v_pat, 190, 110, 104, v_nurse, 'Nurse A')
  returning id into v_log;
  perform ck('a nurse can record a reading', v_log is not null);
  reset role;

  -- MAP is generated and cannot be written. 110 + (190-110)/3 = 136.7
  select map_mmhg into n from public.vital_logs where id = v_log;
  perform ck('MAP is computed by the database', n = 136.7, coalesce(n::text, 'null'));

  begin
    set local role authenticated;
    update public.vital_logs set map_mmhg = 1 where id = v_log;
    reset role;
    perform ck('MAP cannot be overwritten', false, 'the update was accepted');
  exception when others then
    reset role;
    perform ck('MAP cannot be overwritten', true);
  end;

  -- A visiting clinician takes observations too — that IS the work.
  perform test_as(v_guest);
  set local role authenticated;
  insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic, recorded_by)
  values (v_clinic, v_pat, 170, 100, v_guest) returning id into v_log2;
  perform ck('a visiting clinician can record a reading', v_log2 is not null);
  reset role;

  -- ...but not under somebody else's name.
  begin
    perform test_as(v_guest);
    set local role authenticated;
    insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic, recorded_by)
    values (v_clinic, v_pat, 120, 80, v_nurse);
    reset role;
    perform ck('a reading cannot be filed under somebody else', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('a reading cannot be filed under somebody else', true);
  end;

  -- ── 2. A stranger is a stranger ───────────────────────────────────
  perform test_as(v_outsider);
  set local role authenticated;
  select count(*) into i from public.vital_logs where clinic_id = v_clinic;
  perform ck('another clinic cannot READ these readings', i = 0, i::text);
  reset role;

  begin
    perform test_as(v_outsider);
    set local role authenticated;
    insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic)
    values (v_clinic, v_pat, 120, 80);
    reset role;
    perform ck('another clinic cannot WRITE a reading here', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('another clinic cannot WRITE a reading here', true);
  end;

  -- Through the security-definer function, which RLS never sees. This is the
  -- shape of the adjust_inventory hole: the ids are all it would have needed.
  perform test_as(v_outsider);
  select count(*) into i from public.get_vital_flowsheet(v_clinic, v_pat);
  perform ck('get_vital_flowsheet checks the CALLER, not just the ids', i = 0, i::text);

  perform test_as(v_nurse);
  select count(*) into i from public.get_vital_flowsheet(v_clinic, v_pat);
  perform ck('...and returns the readings to this clinic''s own staff', i = 2, i::text);

  -- ── 3. Nobody can delete an observation ───────────────────────────
  begin
    perform test_as(v_owner);
    set local role authenticated;
    delete from public.vital_logs where id = v_log;
    reset role;
    select count(*) into i from public.vital_logs where id = v_log;
    perform ck('even the OWNER cannot delete a reading', i = 1, 'rows left: ' || i::text);
  exception when others then
    reset role;
    perform ck('even the OWNER cannot delete a reading', true);
  end;

  begin
    perform test_as(v_nurse);
    set local role authenticated;
    update public.vital_logs set systolic = 120 where id = v_log;
    reset role;
    select systolic into i from public.vital_logs where id = v_log;
    perform ck('a reading cannot be edited in place', i = 190, 'systolic is now ' || i::text);
  exception when others then
    reset role;
    perform ck('a reading cannot be edited in place', true);
  end;

  -- ── 4. Striking one out ───────────────────────────────────────────
  perform test_as(v_nurse2);
  r := public.void_vital_log(v_log, 'cuff was on the wrong arm');
  perform ck('another nurse cannot strike out this one''s observation',
             (r->>'ok') = 'false', r::text);

  perform test_as(v_outsider);
  r := public.void_vital_log(v_log, 'mine now');
  perform ck('a stranger cannot strike one out at all', (r->>'ok') = 'false', r->>'error');
  perform ck('...and is told it is not their clinic',
             (r->>'error') like 'Not your clinic%', r->>'error');

  perform test_as(v_nurse);
  r := public.void_vital_log(v_log, '');
  perform ck('a strike-out with no reason is refused', (r->>'ok') = 'false', r->>'error');

  perform test_as(v_nurse);
  r := public.void_vital_log(v_log, 'cuff was on the wrong arm');
  perform ck('the person who recorded it can strike it out', (r->>'ok') = 'true', r::text);

  select void_reason into t from public.vital_logs where id = v_log;
  perform ck('the reason is kept with it', t = 'cuff was on the wrong arm', t);

  select count(*) into i from public.vital_logs where id = v_log;
  perform ck('THE ROW IS STILL THERE — struck through, not erased', i = 1, i::text);

  select systolic into i from public.vital_logs where id = v_log;
  perform ck('...with the wrong number still readable', i = 190, i::text);

  -- The main account may strike out anybody's.
  perform test_as(v_owner);
  r := public.void_vital_log(v_log2, 'duplicate entry');
  perform ck('the main account can strike out anybody''s', (r->>'ok') = 'true', r::text);

  perform test_as(v_nurse);
  r := public.void_vital_log(v_log, 'again');
  perform ck('striking out twice is harmless', (r->>'ok') = 'true', r::text);

  -- ── 5. The note tied to the reading ───────────────────────────────
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_notes (vital_log_id, clinic_id, note_text, action_type, author_id, author_name)
  values (v_log, v_clinic, 'Gave hydralazine 10mg IV', 'MEDICATION_GIVEN', v_nurse, 'Nurse A')
  returning id into v_note;
  perform ck('a note can be tied to a reading', v_note is not null);
  reset role;

  begin
    perform test_as(v_nurse);
    set local role authenticated;
    insert into public.vital_notes (vital_log_id, clinic_id, note_text, author_id)
    values (v_log, v_clinic, '   ', v_nurse);
    reset role;
    perform ck('an empty note is refused', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('an empty note is refused', true);
  end;

  begin
    perform test_as(v_outsider);
    set local role authenticated;
    insert into public.vital_notes (vital_log_id, clinic_id, note_text, author_id)
    values (v_log, v_other, 'not mine', v_outsider);
    reset role;
    perform ck('a note cannot be hung off another clinic''s reading', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('a note cannot be hung off another clinic''s reading', true);
  end;

  -- ── 6. What the database refuses to store ─────────────────────────
  begin
    perform test_as(v_nurse);
    set local role authenticated;
    insert into public.vital_logs (clinic_id, clinic_patient_id, recorded_by)
    values (v_clinic, v_pat, v_nurse);
    reset role;
    perform ck('a reading with nothing measured is refused', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('a reading with nothing measured is refused', true);
  end;

  begin
    perform test_as(v_nurse);
    set local role authenticated;
    insert into public.vital_logs (clinic_id, clinic_patient_id, temp_c, recorded_by)
    values (v_clinic, v_pat, 385, v_nurse);            -- 38.5 with the point lost
    reset role;
    perform ck('a temperature of 385 is refused', false, 'it was accepted');
  exception when others then
    reset role;
    perform ck('a temperature of 385 is refused', true);
  end;

  -- ...but the constraint is LOOSE on purpose: a real patient in extremis must
  -- never have their observation rejected. 60/30 is survivable and recordable.
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic, pulse, recorded_by)
  values (v_clinic, v_pat, 60, 30, 150, v_nurse);
  reset role;
  perform ck('a shocked patient''s reading is still accepted', true);

  -- A diastolic above the systolic is a typo, and MAP declines to guess.
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic, recorded_by)
  values (v_clinic, v_pat, 80, 120, v_nurse) returning id into v_log2;
  reset role;
  select map_mmhg into n from public.vital_logs where id = v_log2;
  perform ck('MAP is null when the diastolic is above the systolic', n is null,
             coalesce(n::text, 'null'));

  -- ── 7. The monitoring order ───────────────────────────────────────
  perform test_as(v_outsider);
  r := public.start_vital_watch(v_clinic, v_pat, null, 15, 'nope');
  perform ck('a stranger cannot set a monitoring order', (r->>'ok') = 'false', r->>'error');

  perform test_as(v_nurse);
  r := public.start_vital_watch(v_clinic, v_pat, null, 15, 'severe hypertension');
  perform ck('a nurse can set one', (r->>'ok') = 'true', r::text);
  v_watch := (r->>'id')::uuid;

  perform test_as(v_nurse);
  r := public.start_vital_watch(v_clinic, v_pat, null, 0, 'zero');
  perform ck('an interval of zero is refused', (r->>'ok') = 'false', r->>'error');
  r := public.start_vital_watch(v_clinic, v_pat, null, 2000, 'a day and a half');
  perform ck('an interval beyond a day is refused', (r->>'ok') = 'false', r->>'error');

  -- A second order ends the first: two running intervals is an argument.
  perform test_as(v_owner);
  r := public.start_vital_watch(v_clinic, v_pat, null, 30, 'settling');
  perform ck('a second order can be set', (r->>'ok') = 'true', r::text);
  select count(*) into i from public.vital_watch
   where clinic_id = v_clinic and clinic_patient_id = v_pat and stopped_at is null;
  perform ck('only ONE watch is ever running on a patient', i = 1, i::text);
  select stopped_at is not null into t from public.vital_watch where id = v_watch;
  perform ck('...and the first one was stopped, not abandoned', t = 'true', t);

  perform test_as(v_nurse);
  r := public.stop_vital_watch((select id from public.vital_watch
        where clinic_id = v_clinic and stopped_at is null limit 1));
  perform ck('a nurse can stop a watch', (r->>'ok') = 'true', r::text);
  select count(*) into i from public.vital_watch
   where clinic_id = v_clinic and clinic_patient_id = v_pat and stopped_at is null;
  perform ck('nothing is running afterwards', i = 0, i::text);

  -- ── 8. The retroactive timestamp is a separate fact ───────────────
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_logs
    (clinic_id, clinic_patient_id, systolic, diastolic, recorded_by, logged_at, back_entered)
  values (v_clinic, v_pat, 150, 95, v_nurse, now() - interval '3 hours', true)
  returning id into v_log2;
  reset role;
  select (logged_at < created_at) into t from public.vital_logs where id = v_log2;
  perform ck('a reading can be logged for when it was TAKEN, not when it was typed',
             t = 'true', t);
  select back_entered into t from public.vital_logs where id = v_log2;
  perform ck('...and it is marked as entered after the fact', t = 'true', t);

  /* ── 8b. THE CONTROL FOR THE DELETE CHECK ─────────────────────────
   *
   * "The row is still there" is also what a test reports when it deleted the
   * wrong id, or ran a statement that never touched the table. So the very
   * same statement is run once with RLS out of the way — as the superuser this
   * test connects as, with no `set role` — and it MUST remove the row. If it
   * does not, the delete assertions above were proving nothing. */
  perform test_as(v_nurse);
  set local role authenticated;
  insert into public.vital_logs (clinic_id, clinic_patient_id, systolic, diastolic, recorded_by)
  values (v_clinic, v_pat, 118, 76, v_nurse) returning id into v_log2;
  reset role;
  delete from public.vital_logs where id = v_log2;    -- superuser: RLS does not apply
  select count(*) into i from public.vital_logs where id = v_log2;
  perform ck('CONTROL: the delete statement CAN remove a row when nothing stops it',
             i = 0, 'rows left: ' || i::text);

  -- ── 9. Nothing here follows a clinician between clinics ───────────
  -- The clinician portal's one rule: patient identity never travels. These
  -- tables are the clinic's own record and must not have leaked into the
  -- portable one.
  select count(*) into i from information_schema.columns
   where table_schema = 'public' and table_name = 'clinician_activity'
     and column_name in ('systolic', 'diastolic', 'vital_log_id', 'clinic_patient_id');
  perform ck('no reading and no patient reached clinician_activity', i = 0, i::text);

end $$;
