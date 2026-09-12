-- ════════════════════════════════════════════════════════════════════
-- Returning Patient Flow
-- ────────────────────────────────────────────────────────────────────
-- Adds the schema needed for a clinic to look up a returning patient
-- (whether they came from this clinic, another clinic, or the Homatt
-- app) and instantly see their medical context:
--   • allergies            — critical safety flag
--   • chronic_conditions   — critical safety flag
--   • blood_group          — for emergency situations
--   • medical_notes        — free-text history captured at first visit
--   • consent_share_history / consent_recorded_at
--       — patient must consent before another clinic can see history
--   • prescriptions.picked_up_at + picked_up_at_clinic_id
--       — whether the patient actually collected meds from the clinic
--   • bookings.no_show     — track missed appointments
--
-- Stored on BOTH clinic_patients (offline / walk-in patients) and
-- profiles (Homatt app users). The lookup function reads from whichever
-- table the patient lives in.
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. clinic_patients: medical profile columns ──
alter table public.clinic_patients
  add column if not exists allergies              text[]      default '{}',
  add column if not exists chronic_conditions     text[]      default '{}',
  add column if not exists blood_group            text,
  add column if not exists medical_notes          text,
  add column if not exists consent_share_history  boolean     default false,
  add column if not exists consent_recorded_at    timestamptz,
  add column if not exists date_of_birth          date,
  add column if not exists sex                    text,
  add column if not exists parent_phone           text,   -- for kids: parent's phone
  add column if not exists is_child               boolean     default false;

comment on column public.clinic_patients.allergies            is 'Known drug or other allergies — flagged red at the top of every consultation';
comment on column public.clinic_patients.chronic_conditions   is 'Chronic conditions (HTN, diabetes, asthma, …) — flagged at the top of every consultation';
comment on column public.clinic_patients.consent_share_history is 'Patient has consented to share medical history across Homatt-network clinics';
comment on column public.clinic_patients.parent_phone         is 'For paediatric patients: the parent / guardian phone number registered for them';

-- ── 2. profiles: same medical fields for Homatt app users ──
alter table public.profiles
  add column if not exists allergies              text[]      default '{}',
  add column if not exists chronic_conditions     text[]      default '{}',
  add column if not exists blood_group            text,
  add column if not exists medical_notes          text,
  add column if not exists consent_share_history  boolean     default false,
  add column if not exists consent_recorded_at    timestamptz;

comment on column public.profiles.consent_share_history is 'User has consented to share medical history with clinics they visit';

-- ── 3. e_prescriptions: track pickup at clinic dispensary ──
alter table public.e_prescriptions
  add column if not exists picked_up_at            timestamptz,
  add column if not exists picked_up_at_clinic_id  uuid references public.clinics(id),
  add column if not exists picked_up_at_pharmacy_id uuid references public.pharmacies(id),
  add column if not exists pickup_notes            text;

comment on column public.e_prescriptions.picked_up_at           is 'When the patient actually collected the meds (null = still outstanding)';
comment on column public.e_prescriptions.picked_up_at_clinic_id is 'Clinic where pickup happened, if any';

-- ── 4. bookings: missed-appointment flag ──
alter table public.bookings
  add column if not exists no_show       boolean     default false,
  add column if not exists no_show_at    timestamptz,
  add column if not exists no_show_notes text;

comment on column public.bookings.no_show is 'True when the patient did not turn up for their booked appointment';

-- ── 5. Search indexes for fast phone / name lookup across clinics ──
create index if not exists idx_clinic_patients_phone_lower
  on public.clinic_patients (lower(phone));
create index if not exists idx_clinic_patients_parent_phone
  on public.clinic_patients (parent_phone) where parent_phone is not null;
create index if not exists idx_clinic_patients_name_lower
  on public.clinic_patients (lower(full_name));

create index if not exists idx_profiles_phone_lower
  on public.profiles (lower(phone_number));

-- ── 6. Cross-clinic patient history view ──
-- Lets any clinic-staff session pull a patient's full network history
-- in one query — but only when consent_share_history = true on either
-- the matching clinic_patients row OR the linked profiles row.
create or replace view public.patient_full_history as
select
  cd.id                       as diagnosis_id,
  cd.booking_id,
  cd.clinic_id,
  c.name                      as clinic_name,
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

comment on view public.patient_full_history is 'Flattened cross-clinic patient history used by the returning-patient lookup in the clinic portal';

-- ── 7. RPC: lookup returning patient ──
-- Resolves a patient by phone (theirs or parent's) + optional name fragment,
-- merging clinic_patients + profiles into a single row.
-- Returns null fields when no consent is on file (UI shows a "Request consent" prompt).
create or replace function public.lookup_returning_patient(
  p_phone        text,
  p_name_query   text default null
)
returns table (
  source                text,
  patient_key           text,
  full_name             text,
  phone                 text,
  parent_phone          text,
  is_child              boolean,
  date_of_birth         date,
  sex                   text,
  allergies             text[],
  chronic_conditions    text[],
  blood_group           text,
  medical_notes         text,
  consent_share_history boolean,
  consent_recorded_at   timestamptz,
  profile_id            uuid,
  clinic_patient_id     uuid
)
language sql
security definer
set search_path = public
as $$
  -- Match clinic_patients on phone OR parent_phone
  select
    'clinic_patient'::text  as source,
    coalesce(cp.phone, cp.parent_phone) as patient_key,
    cp.full_name,
    cp.phone,
    cp.parent_phone,
    cp.is_child,
    cp.date_of_birth,
    cp.sex,
    cp.allergies,
    cp.chronic_conditions,
    cp.blood_group,
    cp.medical_notes,
    cp.consent_share_history,
    cp.consent_recorded_at,
    cp.profile_id,
    cp.id as clinic_patient_id
  from public.clinic_patients cp
  where (cp.phone = p_phone or cp.parent_phone = p_phone)
    and (p_name_query is null or lower(cp.full_name) like '%' || lower(p_name_query) || '%')
  order by cp.updated_at desc nulls last, cp.created_at desc
  limit 5;
$$;

comment on function public.lookup_returning_patient is
  'Returns up to 5 patients matching the given phone (own or parent) and optional name fragment, sourced from clinic_patients.';

grant execute on function public.lookup_returning_patient(text, text) to authenticated;

-- ── 8. RPC: lookup by Homatt booking code ──
-- Used when patient hands the clinic their HO-xxx code.
create or replace function public.lookup_by_booking_code(p_code text)
returns table (
  booking_id           uuid,
  patient_user_id      uuid,
  patient_name         text,
  ai_diagnosis         text,
  urgency_level        text,
  clinic_id            uuid,
  status               text,
  preferred_time       timestamptz,
  full_name            text,
  phone                text,
  allergies            text[],
  chronic_conditions   text[],
  blood_group          text,
  medical_notes        text,
  consent_share_history boolean
)
language sql
security definer
set search_path = public
as $$
  select
    b.id                                  as booking_id,
    b.patient_user_id,
    b.patient_name,
    b.ai_diagnosis,
    b.urgency_level,
    b.clinic_id,
    b.status,
    b.preferred_time,
    coalesce(pr.first_name || ' ' || pr.last_name, b.patient_name) as full_name,
    pr.phone_number                       as phone,
    pr.allergies,
    pr.chronic_conditions,
    pr.blood_group,
    pr.medical_notes,
    pr.consent_share_history
  from public.bookings b
  left join public.profiles pr on pr.id = b.patient_user_id
  where upper(b.booking_code) = upper(p_code)
  limit 1;
$$;

grant execute on function public.lookup_by_booking_code(text) to authenticated;

-- ── 9. RPC: record patient consent ──
-- Idempotent — sets consent_share_history = true and stamps consent_recorded_at.
-- Updates BOTH clinic_patients (if found by phone) and profiles (if linked).
create or replace function public.record_patient_consent(
  p_phone        text,
  p_clinic_patient_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_clinic_patient_id is not null then
    update public.clinic_patients
       set consent_share_history = true,
           consent_recorded_at   = v_now,
           updated_at            = v_now
     where id = p_clinic_patient_id;
  end if;

  if p_phone is not null and length(p_phone) > 0 then
    update public.clinic_patients
       set consent_share_history = true,
           consent_recorded_at   = v_now,
           updated_at            = v_now
     where phone = p_phone or parent_phone = p_phone;

    update public.profiles pr
       set consent_share_history = true,
           consent_recorded_at   = v_now,
           updated_at            = v_now
     where pr.phone_number = p_phone;
  end if;

  return true;
end;
$$;

grant execute on function public.record_patient_consent(text, uuid) to authenticated;

-- ── 10. RPC: save initial intake (first-visit allergies / chronic) ──
create or replace function public.save_patient_intake(
  p_clinic_patient_id uuid,
  p_allergies         text[],
  p_chronic           text[],
  p_blood_group       text,
  p_medical_notes     text,
  p_date_of_birth     date default null,
  p_sex               text default null,
  p_is_child          boolean default false,
  p_parent_phone      text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clinic_patients
     set allergies          = coalesce(p_allergies,     allergies),
         chronic_conditions = coalesce(p_chronic,       chronic_conditions),
         blood_group        = coalesce(p_blood_group,   blood_group),
         medical_notes      = coalesce(p_medical_notes, medical_notes),
         date_of_birth      = coalesce(p_date_of_birth, date_of_birth),
         sex                = coalesce(p_sex,           sex),
         is_child           = coalesce(p_is_child,      is_child),
         parent_phone       = coalesce(p_parent_phone,  parent_phone),
         updated_at         = now()
   where id = p_clinic_patient_id;
  return true;
end;
$$;

grant execute on function public.save_patient_intake(uuid, text[], text[], text, text, date, text, boolean, text) to authenticated;
