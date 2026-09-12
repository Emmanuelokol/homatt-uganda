-- Correcting what was recorded — and only the main account may do it.
--
-- Driven against a real Postgres, because every claim here is an RLS policy or
-- a security-definer function and a browser test that mocks the network can
-- reach neither. The important half is not "the owner can": it is that a
-- sub-account CANNOT, by calling the RPC directly, which is what a hidden
-- button does nothing about.

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
  v_clinic   uuid := '44444444-4444-4444-8444-111111111111';
  v_other    uuid := '44444444-4444-4444-8444-222222222222';
  v_owner    uuid := '55555555-5555-4555-8555-111111111111';
  v_nurse    uuid := '55555555-5555-4555-8555-222222222222';
  v_recep    uuid := '55555555-5555-4555-8555-333333333333';
  v_guest    uuid := '55555555-5555-4555-8555-444444444444';
  v_outsider uuid := '55555555-5555-4555-8555-555555555555';
  v_item     uuid;
  v_sale     uuid;
  v_visit    uuid;
  v_pat_new  uuid;   -- a duplicate with no history
  v_pat_old  uuid;   -- a patient who has been treated
  r          jsonb;
  n          numeric;
  t          text;
begin
  -- ── the cast ──────────────────────────────────────────────────────
  insert into auth.users(id, email) values
    (v_owner, 'owner@c.ug'), (v_nurse, 'nurse@c.ug'), (v_recep, 'recep@c.ug'),
    (v_guest, 'guest@c.ug'), (v_outsider, 'out@c.ug')
  on conflict do nothing;

  insert into public.clinics(id, name) values
    (v_clinic, 'Kampala Clinic'), (v_other, 'Gulu Clinic')
  on conflict do nothing;

  insert into public.portal_users(auth_user_id, clinic_id, is_active, staff_role) values
    (v_owner, v_clinic, true, 'owner'),
    (v_nurse, v_clinic, true, 'nurse'),
    (v_recep, v_clinic, true, 'receptionist'),
    (v_guest, v_clinic, true, 'visiting_clinician'),
    (v_outsider, v_other, true, 'owner')
  on conflict do nothing;

  -- stock to sell, and to put back
  insert into public.clinic_inventory(clinic_id, item_name, item_type, unit, quantity,
                                      min_threshold, unit_cost_ugx, selling_price_ugx, is_active)
  values (v_clinic, 'Paracetamol 500mg', 'medicine', 'tablet', 100, 10, 100, 200, true)
  returning id into v_item;

  -- ── who is the main account ───────────────────────────────────────
  perform test_as(v_owner);
  perform ck('the owner is the main account', public.is_clinic_main_account(v_clinic));
  perform test_as(v_nurse);
  perform ck('a nurse is not', not public.is_clinic_main_account(v_clinic));
  perform test_as(v_recep);
  perform ck('a receptionist is not', not public.is_clinic_main_account(v_clinic));
  perform test_as(v_guest);
  perform ck('a visiting clinician is not', not public.is_clinic_main_account(v_clinic));
  perform test_as(v_outsider);
  perform ck('the owner of ANOTHER clinic is not the main account here',
             not public.is_clinic_main_account(v_clinic));

  -- ── the inventory hole that was open ──────────────────────────────
  -- get_clinic_stock and adjust_inventory are security definer, so RLS never
  -- applied to them. Neither checked the CALLER.
  perform test_as(v_outsider);
  select count(*) into n from public.get_clinic_stock(v_clinic);
  perform ck('a stranger cannot read another clinic''s shelves', n = 0, 'rows=' || n);

  r := public.adjust_inventory(v_clinic, v_item, 500, 'addition', 'should be refused');
  perform ck('a stranger cannot adjust another clinic''s stock',
             (r->>'ok')::boolean is not true, r::text);
  select quantity into n from public.clinic_inventory where id = v_item;
  perform ck('and the quantity did not move', n = 100, 'qty=' || n);

  perform test_as(v_nurse);
  select count(*) into n from public.get_clinic_stock(v_clinic);
  perform ck('the clinic''s own staff still see their shelves', n = 1, 'rows=' || n);

  -- ── a quick sale, sold by the nurse ───────────────────────────────
  perform test_as(v_nurse);
  insert into public.clinic_quick_sales(clinic_id, drug_id, drug_name, unit, quantity,
                                        unit_price_ugx, total_ugx, payment_method, sold_by)
  values (v_clinic, v_item, 'Paracetamol 500mg', 'tablet', 10, 200, 2000, 'cash', v_nurse)
  returning id into v_sale;
  perform ck('a nurse can still record a sale', v_sale is not null);

  -- take the stock down as the real sale does
  r := public.adjust_inventory(v_clinic, v_item, -10, 'deduction', 'Quick Sale');
  select quantity into n from public.clinic_inventory where id = v_item;
  perform ck('the sale took the stock down', n = 90, 'qty=' || n);

  -- ── a sub-account must not be able to correct or delete it ────────
  perform test_as(v_nurse);
  r := public.edit_quick_sale(v_sale, 5, null, null, 'nurse trying');
  perform ck('a nurse CANNOT correct a sale', (r->>'ok')::boolean is not true, r->>'error');
  r := public.delete_quick_sale(v_sale, 'nurse trying');
  perform ck('a nurse CANNOT delete a sale', (r->>'ok')::boolean is not true, r->>'error');

  perform test_as(v_recep);
  r := public.delete_quick_sale(v_sale, 'receptionist trying');
  perform ck('a receptionist CANNOT delete a sale', (r->>'ok')::boolean is not true, r->>'error');

  perform test_as(v_guest);
  r := public.delete_quick_sale(v_sale, 'guest trying');
  perform ck('a visiting clinician CANNOT delete a sale', (r->>'ok')::boolean is not true, r->>'error');

  -- And not by going round the RPC either.
  --
  -- This has to run as `authenticated`. The test connects as postgres, which
  -- is a superuser and BYPASSES RLS COMPLETELY — so without the role change
  -- the delete succeeds, the check fails, and it would have been very easy to
  -- read that as "my policy does not work" instead of "my test does not".
  perform test_as(v_nurse);
  execute 'set role authenticated';
  begin
    delete from public.clinic_quick_sales where id = v_sale;
  exception when others then null;
  end;
  execute 'reset role';
  select count(*) into n from public.clinic_quick_sales where id = v_sale;
  perform ck('nor by deleting the row directly, which is what a hidden button leaves open',
             n = 1, 'rows=' || n);

  -- ── the owner corrects it, and the stock follows ──────────────────
  perform test_as(v_owner);
  r := public.edit_quick_sale(v_sale, 6, null, null, 'counted wrong');
  perform ck('the main account can correct a sale', (r->>'ok')::boolean, r::text);
  select total_ugx into n from public.clinic_quick_sales where id = v_sale;
  perform ck('the total follows the quantity', n = 1200, 'total=' || n);
  select quantity into n from public.clinic_inventory where id = v_item;
  perform ck('and the four that were not sold went back on the shelf', n = 94, 'qty=' || n);

  r := public.edit_quick_sale(v_sale, 0, null, null, 'zero');
  perform ck('a sale of nothing is refused, not silently deleted',
             (r->>'ok')::boolean is not true, r->>'error');

  -- ── deleting it puts ALL the stock back ───────────────────────────
  r := public.delete_quick_sale(v_sale, 'never happened');
  perform ck('the main account can delete a sale', (r->>'ok')::boolean, r::text);
  select count(*) into n from public.clinic_quick_sales where id = v_sale;
  perform ck('the sale is off the books', n = 0, 'rows=' || n);
  select quantity into n from public.clinic_inventory where id = v_item;
  perform ck('and every tablet is back on the shelf', n = 100, 'qty=' || n);

  -- the trail
  select count(*) into n from public.clinic_record_edits
   where record_type = 'quick_sale' and clinic_id = v_clinic;
  perform ck('both corrections are in the audit trail', n = 2, 'rows=' || n);
  -- Checked by existence, not by "the last one". Every row in this test is
  -- written inside ONE transaction, and now() is frozen for a transaction, so
  -- all of them share a created_at and "order by created_at desc limit 1"
  -- returns whichever the planner feels like. That is a fact about the test,
  -- not about the trail.
  select count(*) into n from public.clinic_record_edits
   where record_type = 'quick_sale' and action = 'delete';
  perform ck('the deletion is recorded as a deletion', n = 1, 'rows=' || n);
  select count(*) into n from public.clinic_record_edits
   where record_type = 'quick_sale' and action = 'edit';
  perform ck('and the correction as a correction', n = 1, 'rows=' || n);

  -- ── a visit, and the money that was forgotten ─────────────────────
  insert into public.clinic_diagnoses(clinic_id, confirmed_diagnosis, consultation_fee_ugx,
                                      lab_fee_ugx, meds_fee_ugx, total_charged_ugx,
                                      amount_paid, payment_status, lab_tests_ordered)
  values (v_clinic, 'Malaria', 10000, 0, 0, 10000, 0, 'pending', '{}')
  returning id into v_visit;

  perform test_as(v_nurse);
  r := public.edit_visit_record(v_visit, null, null, 99999, null, null, null, null, 'nurse trying');
  perform ck('a nurse CANNOT change what a visit charged',
             (r->>'ok')::boolean is not true, r->>'error');
  select total_charged_ugx into n from public.clinic_diagnoses where id = v_visit;
  perform ck('and the bill did not move', n = 10000, 'total=' || n);

  perform test_as(v_owner);
  -- the lab test and its fee that were forgotten
  r := public.edit_visit_record(v_visit, null, array['Malaria RDT','Blood slide'],
                                10000, 5000, 3000, 12000, null, 'forgot the lab test');
  perform ck('the main account can add what was forgotten', (r->>'ok')::boolean, r::text);
  perform ck('the bill is the sum of the three fees', (r->>'total_charged_ugx')::numeric = 18000,
             r->>'total_charged_ugx');
  perform ck('and part payment is recognised as partial', r->>'payment_status' = 'partial',
             r->>'payment_status');
  select array_length(lab_tests_ordered, 1) into n from public.clinic_diagnoses where id = v_visit;
  perform ck('the lab tests are on the visit', n = 2, 'tests=' || n);

  -- paying the whole bill reads as paid, and overpaying cannot happen
  r := public.edit_visit_record(v_visit, null, null, null, null, null, 99999, null, 'paid up');
  perform ck('paying the whole bill reads as paid', r->>'payment_status' = 'paid', r->>'payment_status');
  perform ck('and nobody can be recorded as having paid more than the bill',
             (r->>'amount_paid')::numeric = 18000, r->>'amount_paid');

  -- ── patients ──────────────────────────────────────────────────────
  insert into public.clinic_patients(clinic_id, full_name, phone)
  values (v_clinic, 'Okello Jonh', '0770000001') returning id into v_pat_new;
  insert into public.clinic_patients(clinic_id, full_name, phone)
  values (v_clinic, 'Nakato Sarah', '0770000002') returning id into v_pat_old;

  -- Nakato has been treated. The link is clinic_diagnoses: a walk-in never
  -- gets a booking at all, so counting bookings would call most of a busy
  -- clinic's patients history-free and delete them.
  insert into public.clinic_diagnoses(clinic_id, confirmed_diagnosis, patient_name, patient_phone)
  values (v_clinic, 'Malaria', 'Nakato Sarah', '0770000002');

  perform test_as(v_nurse);
  r := public.edit_clinic_patient(v_pat_new, 'Okello John', null, null, 'nurse trying');
  perform ck('a nurse CANNOT rename a patient', (r->>'ok')::boolean is not true, r->>'error');
  r := public.delete_clinic_patient(v_pat_new, 'nurse trying');
  perform ck('a nurse CANNOT remove a patient', (r->>'ok')::boolean is not true, r->>'error');
  execute 'set role authenticated';
  begin
    delete from public.clinic_patients where id = v_pat_new;
  exception when others then null;
  end;
  execute 'reset role';
  select count(*) into n from public.clinic_patients where id = v_pat_new;
  perform ck('nor delete the row directly', n = 1, 'rows=' || n);

  perform test_as(v_owner);
  r := public.edit_clinic_patient(v_pat_new, 'Okello John', null, null, 'typo');
  perform ck('the main account can correct the spelling', (r->>'ok')::boolean, r::text);
  select full_name into t from public.clinic_patients where id = v_pat_new;
  perform ck('and the name is right', t = 'Okello John', t);

  r := public.edit_clinic_patient(v_pat_new, null, '0770000002', null, 'clash');
  perform ck('a phone number another patient already has is refused by name, not by a database error',
             (r->>'ok')::boolean is not true, r->>'error');

  r := public.edit_clinic_patient(v_pat_new, '   ', null, null, 'blank');
  perform ck('a patient cannot be left with no name', (r->>'ok')::boolean is not true, r->>'error');

  -- the duplicate with nothing to lose: really deleted
  r := public.delete_clinic_patient(v_pat_new, 'duplicate');
  perform ck('a patient with no history is deleted outright',
             (r->>'ok')::boolean and (r->>'archived')::boolean is false, r::text);
  select count(*) into n from public.clinic_patients where id = v_pat_new;
  perform ck('and the row is gone', n = 0, 'rows=' || n);

  -- the one who has been treated: archived, never destroyed
  r := public.delete_clinic_patient(v_pat_old, 'tidying up');
  perform ck('a patient who has been treated is ARCHIVED, not destroyed',
             (r->>'ok')::boolean and (r->>'archived')::boolean, r::text);
  select count(*) into n from public.clinic_patients where id = v_pat_old;
  perform ck('their record is still there', n = 1, 'rows=' || n);
  select count(*) into n from public.clinic_patients
   where id = v_pat_old and archived_at is not null;
  perform ck('and it is marked archived', n = 1, 'rows=' || n);
  select count(*) into n from public.clinic_diagnoses
   where clinic_id = v_clinic and patient_phone = '0770000002';
  perform ck('their treatment history is untouched', n = 1, 'visits=' || n);

  -- ── the audit trail is readable by the clinic, and only by it ─────
  perform test_as(v_owner);
  execute 'set role authenticated';
  select count(*) into n from public.clinic_record_edits where clinic_id = v_clinic;
  execute 'reset role';
  perform ck('every correction is in the trail, and the owner can read it',
             n >= 7, 'rows=' || n);

  -- As `authenticated`, or postgres bypasses RLS and this reads every row no
  -- matter what the policy says.
  perform test_as(v_outsider);
  execute 'set role authenticated';
  select count(*) into n from public.clinic_record_edits where clinic_id = v_clinic;
  execute 'reset role';
  perform ck('another clinic cannot read this clinic''s corrections', n = 0, 'rows=' || n);

  -- and it cannot be forged: no insert policy exists for a client
  perform test_as(v_nurse);
  execute 'set role authenticated';
  begin
    insert into public.clinic_record_edits(clinic_id, record_type, action)
    values (v_clinic, 'quick_sale', 'edit');
    execute 'reset role';
    perform ck('an audit row cannot be written by hand', false, 'the insert succeeded');
  exception when others then
    execute 'reset role';
    perform ck('an audit row cannot be written by hand', true);
  end;
end $$;
