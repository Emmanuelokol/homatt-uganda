-- ============================================================
-- Homatt Health — history shows WHO treated the patient, and WHERE
--
-- 1. clinic_diagnoses.clinician_name — denormalized display name of
--    the doctor/clinician who ran the consultation (clinician_id has
--    always been stored; a text name renders offline with no joins).
--    Backfilled for existing records from portal_users.
-- 2. patient_full_history view now also returns clinician_name and
--    the clinic's district + address, so a consultation seen from
--    ANOTHER clinic (with patient consent) shows where it happened.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

alter table public.clinic_diagnoses
  add column if not exists clinician_name text;

-- Backfill old records from the staff table
update public.clinic_diagnoses cd
   set clinician_name = pu.full_name
  from public.portal_users pu
 where cd.clinician_name is null
   and cd.clinician_id is not null
   and pu.auth_user_id = cd.clinician_id;

-- Recreate the flattened history view with the new fields
create or replace view public.patient_full_history as
select
  cd.id                       as diagnosis_id,
  cd.booking_id,
  cd.clinic_id,
  c.name                      as clinic_name,
  c.district                  as clinic_district,
  c.address                   as clinic_address,
  cd.clinician_name,
  cd.confirmed_diagnosis,
  cd.severity,
  cd.treatment_plan,
  cd.prescription_items,
  cd.follow_up_days,
  cd.total_charged_ugx,
  cd.payment_status,
  cd.created_at,
  cd.patient_phone,
  cd.patient_name,
  b.status                    as booking_status,
  b.no_show                   as missed,
  b.preferred_time            as appointment_time
from public.clinic_diagnoses cd
left join public.bookings b on b.id = cd.booking_id
left join public.clinics  c on c.id = cd.clinic_id;

select 'history clinician + clinic details ready' as result;
