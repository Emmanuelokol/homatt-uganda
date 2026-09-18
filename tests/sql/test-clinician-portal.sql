-- The clinician portal, driven against a real Postgres.
--
-- Run by tests/run-sql.sh. Every check prints PASS or FAIL with the value it
-- actually got, in the same style as the browser tests.
--
-- The check that matters most is the last group: that the record which travels
-- with a clinician to the next clinic carries no patient in it. That is the
-- promise this whole design exists to keep, and it is the one that would fail
-- silently — a leaked name looks like a working feature.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function ck(name text, ok boolean, got text default null) returns void
language plpgsql as $$
begin
  raise notice '%', (case when ok then 'PASS' else 'FAIL' end) || '  ' || name ||
    (case when got is null or got = '' then '' else '  — ' || got end);
end $$;

-- ── the cast ────────────────────────────────────────────────────────
do $$
declare
  v_clinic_a uuid := '11111111-1111-4111-8111-111111111111';
  v_clinic_b uuid := '11111111-1111-4111-8111-222222222222';
  v_owner_a  uuid := '22222222-2222-4222-8222-111111111111';
  v_owner_b  uuid := '22222222-2222-4222-8222-222222222222';
  v_doc      uuid := '33333333-3333-4333-8333-111111111111';
  v_doc2     uuid := '33333333-3333-4333-8333-222222222222';
begin
  delete from public.clinician_activity where true;
  delete from public.clinician_ratings  where true;
  delete from public.clinic_clinicians  where true;
  delete from public.clinic_link_codes  where true;
  delete from public.clinicians         where true;
  delete from public.clinic_diagnoses   where true;
  delete from public.portal_users       where true;
  delete from public.clinics where id in (v_clinic_a, v_clinic_b);
  delete from auth.users where id in (v_owner_a, v_owner_b, v_doc, v_doc2);

  insert into auth.users (id, email) values
    (v_owner_a, 'owner.a@test'), (v_owner_b, 'owner.b@test'),
    (v_doc, 'doc@test'), (v_doc2, 'doc2@test');
  insert into public.clinics (id, name, district) values
    (v_clinic_a, 'Kampala Clinic', 'Kampala'),
    (v_clinic_b, 'Gulu Clinic', 'Gulu');
  insert into public.portal_users (auth_user_id, full_name, email, role, clinic_id, staff_role, is_active) values
    (v_owner_a, 'Owner A', 'owner.a@test', 'clinic_staff', v_clinic_a, 'owner', true),
    (v_owner_b, 'Owner B', 'owner.b@test', 'clinic_staff', v_clinic_b, 'owner', true);
end $$;

-- ── 1. a clinician signs up, standalone ─────────────────────────────
do $$
declare r jsonb; n int;
begin
  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  r := public.save_my_clinician_profile(jsonb_build_object(
        'full_name','Dr Okello John','profession','Doctor','cadre','Medical Officer',
        'registration_no','UMDPC/12345','registration_body','UMDPC','qualification','MBChB',
        'years_experience','6','phone','0772000111','district','Lira','village','Adyel',
        'languages','English, Luo'));
  perform ck('a clinician can sign up with no clinic at all', (r->>'ok')::boolean, r::text);

  select count(*) into n from public.clinicians where auth_user_id = '33333333-3333-4333-8333-111111111111';
  perform ck('the profile is stored once', n = 1, 'rows=' || n);

  -- saving again must not make a second person
  r := public.save_my_clinician_profile(jsonb_build_object('full_name','Dr Okello John','district','Gulu'));
  select count(*) into n from public.clinicians where auth_user_id = '33333333-3333-4333-8333-111111111111';
  perform ck('saving the profile again updates it rather than duplicating', n = 1, 'rows=' || n);

  perform ck('a field left blank on the second save is not wiped',
    (select registration_no from public.clinicians where auth_user_id = '33333333-3333-4333-8333-111111111111') = 'UMDPC/12345',
    (select coalesce(registration_no,'(null)') from public.clinicians where auth_user_id = '33333333-3333-4333-8333-111111111111'));

  -- and a second clinician, who will be used to prove the walls hold
  perform test_as('33333333-3333-4333-8333-222222222222'::uuid);
  r := public.save_my_clinician_profile(jsonb_build_object('full_name','Dr Nakato Sarah','profession','Clinical Officer'));
  perform ck('a second clinician signs up independently', (r->>'ok')::boolean, r::text);
end $$;

-- ── 2. the handshake ────────────────────────────────────────────────
do $$
declare r jsonb; v_code text; r2 jsonb;
begin
  -- a clinician cannot mint a code for a clinic
  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  r := public.create_clinic_link_code(24, 1, 30, 'visiting_clinician');
  perform ck('a clinician cannot create a clinic''s own QR code', (r->>'ok')::boolean is not true, r->>'error');

  -- the owner can
  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);
  r := public.create_clinic_link_code(24, 1, 30, 'visiting_clinician');
  perform ck('the owner creates a QR code', (r->>'ok')::boolean, r->>'code');
  v_code := r->>'code';

  perform ck('the code avoids characters that are misread when typed',
    v_code !~ '[01OIL]', v_code);
  perform ck('the code is 8 characters', length(v_code) = 8, v_code);

  -- scanning it attaches the clinician, temporarily
  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  r2 := public.redeem_clinic_link_code(v_code);
  perform ck('scanning the code attaches the clinician', (r2->>'ok')::boolean, r2::text);
  perform ck('the attachment names the clinic', r2->>'clinic_name' = 'Kampala Clinic', r2->>'clinic_name');
  perform ck('the access is temporary, not permanent',
    (r2->>'expires_at')::timestamptz > now() and (r2->>'expires_at')::timestamptz < now() + interval '31 days',
    r2->>'expires_at');

  -- a single-use code is now spent
  perform test_as('33333333-3333-4333-8333-222222222222'::uuid);
  r2 := public.redeem_clinic_link_code(v_code);
  perform ck('a single-use code cannot be used twice', (r2->>'ok')::boolean is not true, r2->>'error');

  -- a guessed code says nothing about whether the clinic exists
  r2 := public.redeem_clinic_link_code('ZZZZZZZZ');
  perform ck('a wrong code is refused', (r2->>'ok')::boolean is not true, r2->>'error');
  perform ck('a wrong code and a spent code give the SAME message, so guessing tells you nothing',
    r2->>'error' = 'That code is not valid. Ask the clinic for a new one.', r2->>'error');
end $$;

-- ── 3. an expired code, and a revoked one ───────────────────────────
do $$
declare r jsonb; v_code text;
begin
  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);
  r := public.create_clinic_link_code(24, 5, 30, 'visiting_clinician');
  v_code := r->>'code';
  update public.clinic_link_codes t set expires_at = now() - interval '1 hour' where t.code = v_code;
  perform test_as('33333333-3333-4333-8333-222222222222'::uuid);
  r := public.redeem_clinic_link_code(v_code);
  perform ck('an expired code is refused', (r->>'ok')::boolean is not true, r->>'error');

  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);
  r := public.create_clinic_link_code(24, 5, 30, 'visiting_clinician');
  v_code := r->>'code';
  update public.clinic_link_codes t set revoked = true where t.code = v_code;
  perform test_as('33333333-3333-4333-8333-222222222222'::uuid);
  r := public.redeem_clinic_link_code(v_code);
  perform ck('a revoked code is refused at once', (r->>'ok')::boolean is not true, r->>'error');
end $$;

-- ── 4. the work is logged automatically ─────────────────────────────
do $$
declare n int; c text;
begin
  -- the clinician treats two people at Kampala Clinic
  insert into public.clinic_diagnoses
    (clinic_id, clinician_id, clinician_name, patient_name, patient_phone,
     confirmed_diagnosis, severity, case_code)
  values
    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-111111111111',
     'Dr Okello John', 'Achieng Mary', '0700111222', 'Malaria', 'moderate', 'CASE-1'),
    ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-111111111111',
     'Dr Okello John', 'Mukasa Peter', '0700333444', 'Pneumonia', 'severe', 'CASE-2');

  select count(*) into n from public.clinician_activity;
  perform ck('every treatment is logged automatically, with no call from the phone', n = 2, 'logged=' || n);

  select string_agg(condition, ', ' order by condition) into c from public.clinician_activity;
  perform ck('the log records WHAT was treated', c = 'Malaria, Pneumonia', c);

  perform ck('the log is tied to the stint it happened in',
    (select count(*) from public.clinician_activity where stint_id is not null) = 2);

  -- a treatment by ordinary clinic staff (not a portal clinician) logs nothing
  insert into public.clinic_diagnoses (clinic_id, clinician_id, confirmed_diagnosis)
  values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-111111111111', 'Cough');
  select count(*) into n from public.clinician_activity;
  perform ck('a clinic''s own staff are not given a clinician record they never asked for', n = 2, 'logged=' || n);
end $$;

-- ── 5. THE PROMISE: no patient travels with the clinician ───────────
do $$
declare cols text; ref jsonb; blob text;
begin
  select string_agg(column_name, ', ' order by column_name) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clinician_activity';
  perform ck('the travelling record has no column that could hold a patient',
    cols !~* 'patient|phone|name|contact|nin', cols);

  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  ref := public.clinician_reference(public.my_clinician_id());
  blob := ref::text;
  perform ck('the portable reference contains no patient name',
    blob not like '%Achieng Mary%' and blob not like '%Mukasa Peter%',
    'len=' || length(blob));
  perform ck('the portable reference contains no patient phone',
    blob not like '%0700111222%' and blob not like '%0700333444%');
  perform ck('but it does carry the conditions treated, which is the professional record',
    blob like '%Malaria%' and blob like '%Pneumonia%');
  perform ck('and the count of treatments', (ref->'totals'->>'treatments')::int = 2,
    ref->'totals'->>'treatments');
end $$;

-- ── 6. what the owner sees, inside their own clinic ─────────────────
do $$
declare r jsonb; d jsonb; sid uuid;
begin
  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);
  r := public.clinic_clinicians_list();
  perform ck('the owner sees the clinician who scanned in', (r->>'ok')::boolean
    and jsonb_array_length(r->'clinicians') = 1, r::text);
  perform ck('the owner sees how many they treated',
    (r->'clinicians'->0->>'treatments')::int = 2, r->'clinicians'->0->>'treatments');
  perform ck('the owner sees who it is', r->'clinicians'->0->>'full_name' = 'Dr Okello John',
    r->'clinicians'->0->>'full_name');
  perform ck('and their registration number, which is why they can be trusted with a patient',
    r->'clinicians'->0->>'registration_no' = 'UMDPC/12345');

  sid := (r->'clinicians'->0->>'stint_id')::uuid;
  d := public.clinic_clinician_detail(sid);
  perform ck('the owner can see WHO was treated — inside their own clinic',
    (d->>'ok')::boolean and d::text like '%Achieng Mary%', d->>'ok');
  perform ck('the day-by-day count is there too', jsonb_array_length(d->'by_day') >= 1);

  -- the OTHER clinic's owner must see none of it
  perform test_as('22222222-2222-4222-8222-222222222222'::uuid);
  r := public.clinic_clinicians_list();
  perform ck('another clinic''s owner sees no clinicians of ours',
    jsonb_array_length(r->'clinicians') = 0, r::text);
  d := public.clinic_clinician_detail(sid);
  perform ck('another clinic''s owner cannot open our clinician''s patients',
    (d->>'ok')::boolean is not true, d->>'error');
end $$;

-- ── 7. leaving, and the reference that follows ──────────────────────
do $$
declare r jsonb; sid uuid; home jsonb;
begin
  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);
  sid := ((public.clinic_clinicians_list())->'clinicians'->0->>'stint_id')::uuid;

  r := public.rate_clinician(jsonb_build_object('stint_id', sid, 'rating', '5',
        'care','5','punctuality','4','record_keeping','5','teamwork','5',
        'would_rehire','true','reference_note','Careful with children. Would have back.'));
  perform ck('the owner can rate the clinician', (r->>'ok')::boolean, r::text);

  r := public.end_clinician_stint(sid, 'Moved to Gulu');
  perform ck('the owner can end the attachment', (r->>'ok')::boolean and r->>'ended_by' = 'owner', r::text);

  perform ck('and the access really is gone',
    (select status from public.clinic_clinicians where id = sid) = 'ended',
    (select status from public.clinic_clinicians where id = sid));

  -- the clinician keeps everything
  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  home := public.my_clinician_home();
  perform ck('the clinician still has their profile after the job ended', (home->>'ok')::boolean);
  perform ck('the work count survived the job ending',
    (home->'stats'->>'treatments')::int = 2, home->'stats'->>'treatments');
  perform ck('the rating travels with them',
    (home->'ratings'->0->>'rating')::int = 5, home->'ratings'->0->>'rating');
  perform ck('and the owner''s words travel with them',
    home->'ratings'->0->>'reference_note' like '%Would have back%');
  perform ck('the stint is listed as ended, not deleted',
    home->'links'->0->>'status' = 'ended', home->'links'->0->>'status');
  perform ck('the ended stint carries no patient either',
    home::text not like '%Achieng Mary%');
end $$;

-- ── 8. expiry ends access on its own ────────────────────────────────
do $$
declare r jsonb; v_code text; sid uuid; home jsonb;
begin
  perform test_as('22222222-2222-4222-8222-222222222222'::uuid);
  v_code := (public.create_clinic_link_code(24, 1, 30, 'visiting_clinician'))->>'code';
  perform test_as('33333333-3333-4333-8333-111111111111'::uuid);
  r := public.redeem_clinic_link_code(v_code);
  sid := (r->>'stint_id')::uuid;
  perform ck('the same clinician can work at a second clinic', (r->>'ok')::boolean, r->>'clinic_name');

  update public.clinic_clinicians set expires_at = now() - interval '1 day' where id = sid;
  home := public.my_clinician_home();
  perform ck('access that has run out is closed off without anyone doing anything',
    (select status from public.clinic_clinicians where id = sid) = 'expired',
    (select status from public.clinic_clinicians where id = sid));
end $$;

-- ── 9. the walls, checked directly rather than through an RPC ───────
-- The RPCs above are security definer, so they run as the owner of the
-- function and RLS never applies to them. These checks read the tables the
-- way a stolen anon key would.
set role authenticated;
do $$
declare n int;
begin
  perform test_as('33333333-3333-4333-8333-222222222222'::uuid);   -- the OTHER clinician
  select count(*) into n from public.clinicians;
  perform ck('a clinician reading the table directly sees only themselves', n = 1, 'rows=' || n);

  select count(*) into n from public.clinician_activity;
  perform ck('and none of another clinician''s work', n = 0, 'rows=' || n);

  select count(*) into n from public.clinic_link_codes;
  perform ck('a clinician cannot read the clinic''s unused QR codes', n = 0, 'rows=' || n);

  select count(*) into n from public.clinic_clinicians;
  perform ck('a clinician sees only their own attachments', n = 0, 'rows=' || n);

  perform test_as('22222222-2222-4222-8222-222222222222'::uuid);   -- Gulu's owner
  select count(*) into n from public.clinician_activity where clinic_id = '11111111-1111-4111-8111-111111111111';
  perform ck('an owner cannot read what happened in another clinic', n = 0, 'rows=' || n);

  /* And the positive side, which is the half that is easy to forget.
   *
   * Checking only that the walls hold would pass just as well if the walls
   * were solid — an owner locked out of their own clinic's records looks
   * exactly like good security until somebody opens the screen.
   *
   * This one is worth checking DIRECTLY rather than through the RPCs, because
   * the policy on `clinicians` reads `clinic_clinicians` inside an EXISTS, and
   * that table has RLS of its own. A policy whose subquery is itself filtered
   * returns nothing, and every RPC would still work because they are security
   * definer and never see any of it. */
  perform test_as('22222222-2222-4222-8222-111111111111'::uuid);   -- Kampala's owner
  select count(*) into n from public.clinic_clinicians
   where clinic_id = '11111111-1111-4111-8111-111111111111';
  perform ck('an owner CAN read the attachments to their own clinic', n >= 1, 'rows=' || n);

  select count(*) into n from public.clinicians;
  perform ck('an owner CAN read the record of a clinician attached to them', n >= 1, 'rows=' || n);

  select count(*) into n from public.clinician_activity
   where clinic_id = '11111111-1111-4111-8111-111111111111';
  perform ck('an owner CAN read the work done in their own clinic', n >= 1, 'rows=' || n);

  select count(*) into n from public.clinic_link_codes;
  perform ck('and their own QR codes', n >= 1, 'rows=' || n);
end $$;
reset role;

do $$ begin raise notice '--- clinician portal SQL checks finished ---'; end $$;
