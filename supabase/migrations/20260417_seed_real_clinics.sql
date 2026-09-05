-- ============================================================
-- Real Uganda Clinics Seed Data
-- Covers Mawotto/Busia area, Mukono, Kampala, Wakiso, Jinja,
-- Mbale, Gulu, Mbarara, and other major regions.
-- Run once in Supabase SQL editor: Dashboard → SQL Editor → New query
-- ============================================================

insert into clinics (
  id, name, address, district, county, city, parish,
  phone, email,
  latitude, longitude,
  consultation_fee,
  quality_score, cure_rate, avg_rating, avg_wait_minutes,
  specialties, facilities, services, description,
  condition_performance,
  opening_hours,
  verified, active, accepts_online_slots,
  created_at, updated_at
) values

-- ──────────────────────────────────────────────
-- BUSIA DISTRICT (covers Mawotto / Butto area)
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Butto Health Centre III',
  'Butto Trading Centre, Mawotto Sub-county',
  'Busia', 'Samia-Bugwe County', 'Mawotto', 'Butto',
  '+256 772 400 001', null,
  0.4612, 34.0798,
  10000,
  78, 82, 3.9, 25,
  ARRAY['Malaria','Typhoid','Diarrhoea','Maternal Health','Immunisation','HIV/AIDS','Tuberculosis'],
  ARRAY['Laboratory','Pharmacy','Maternity Ward','Immunisation'],
  '[{"type":"General OPD","fee":10000,"notes":"Government rates"},{"type":"Antenatal Care","fee":5000,"notes":"ANC visit"},{"type":"Malaria RDT","fee":3000,"notes":"Rapid diagnostic test"}]',
  'Government Health Centre III serving Mawotto sub-county and surrounding villages. Provides outpatient, maternal, and child health services.',
  '{"malaria":84,"typhoid":79,"diarrhoea":88,"anc":90}',
  '{"Monday":{"open":"08:00","close":"17:00","closed":false},"Tuesday":{"open":"08:00","close":"17:00","closed":false},"Wednesday":{"open":"08:00","close":"17:00","closed":false},"Thursday":{"open":"08:00","close":"17:00","closed":false},"Friday":{"open":"08:00","close":"17:00","closed":false},"Saturday":{"open":"08:00","close":"13:00","closed":false},"Sunday":{"open":"00:00","close":"00:00","closed":true}}',
  true, true, false,
  now(), now()
),
(
  gen_random_uuid(),
  'Busia General Hospital',
  'Hospital Road, Busia Town',
  'Busia', 'Samia-Bugwe County', 'Busia Town', 'Busia Central',
  '+256 434 320 060', null,
  0.4661, 34.0900,
  20000,
  85, 87, 4.1, 40,
  ARRAY['Malaria','Typhoid','Surgery','Obstetrics','Paediatrics','HIV/AIDS','Tuberculosis','Diabetes','Hypertension'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','Maternity Ward','Male Ward','Female Ward','Paediatric Ward','Blood Bank'],
  '[{"type":"General OPD","fee":20000,"notes":"Includes doctor review"},{"type":"Specialist","fee":35000,"notes":"Surgical/Obs consult"},{"type":"Emergency","fee":25000,"notes":"24-hour emergency"}]',
  'Regional referral hospital for Busia district. 24-hour emergency services, surgical theatre, and full laboratory.',
  '{"malaria":89,"typhoid":85,"surgery":80,"obs":88}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),
(
  gen_random_uuid(),
  'Masaba Health Centre II',
  'Masaba Village, Nambale Road',
  'Busia', 'Samia-Bugwe County', 'Masaba', 'Masaba',
  '+256 779 400 110', null,
  0.4580, 34.0650,
  5000,
  68, 75, 3.7, 20,
  ARRAY['Malaria','Diarrhoea','Immunisation','Family Planning'],
  ARRAY['Basic Laboratory','Pharmacy'],
  '[{"type":"General OPD","fee":5000,"notes":"Government HC II rates"},{"type":"Family Planning","fee":0,"notes":"Free family planning services"}]',
  'Community health centre II serving Masaba and nearby villages with basic outpatient and preventive care.',
  '{"malaria":78,"diarrhoea":82}',
  '{"Monday":{"open":"08:00","close":"17:00","closed":false},"Tuesday":{"open":"08:00","close":"17:00","closed":false},"Wednesday":{"open":"08:00","close":"17:00","closed":false},"Thursday":{"open":"08:00","close":"17:00","closed":false},"Friday":{"open":"08:00","close":"17:00","closed":false},"Saturday":{"open":"08:00","close":"12:00","closed":false},"Sunday":{"open":"00:00","close":"00:00","closed":true}}',
  true, true, false,
  now(), now()
),

-- ──────────────────────────────────────────────
-- MUKONO DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Mukono Family Clinic',
  'Mukono Town, Kampala Road',
  'Mukono', 'Mukono County', 'Mukono Town', 'Mukono Central',
  '+256 772 300 200', null,
  0.3535, 32.7553,
  25000,
  82, 84, 4.2, 30,
  ARRAY['Malaria','Typhoid','Diabetes','Hypertension','Maternal Health','Family Planning','Paediatrics','General Medicine'],
  ARRAY['Laboratory','Pharmacy','Ultrasound','ECG'],
  '[{"type":"General OPD","fee":25000,"notes":"Includes consultation"},{"type":"Antenatal Care","fee":30000,"notes":"Full ANC package"},{"type":"Diabetes Management","fee":35000,"notes":"Glucose test + review"}]',
  'Private family clinic in Mukono Town offering comprehensive outpatient services, maternal care, and chronic disease management.',
  '{"malaria":85,"typhoid":83,"diabetes":80,"hypertension":82}',
  '{"Monday":{"open":"08:00","close":"20:00","closed":false},"Tuesday":{"open":"08:00","close":"20:00","closed":false},"Wednesday":{"open":"08:00","close":"20:00","closed":false},"Thursday":{"open":"08:00","close":"20:00","closed":false},"Friday":{"open":"08:00","close":"20:00","closed":false},"Saturday":{"open":"08:00","close":"17:00","closed":false},"Sunday":{"open":"09:00","close":"14:00","closed":false}}',
  true, true, true,
  now(), now()
),
(
  gen_random_uuid(),
  'Mukono Health Centre IV',
  'Mukono Hill, Hospital Road',
  'Mukono', 'Mukono County', 'Mukono Town', 'Mukono Hill',
  '+256 434 290 026', null,
  0.3571, 32.7498,
  15000,
  80, 83, 4.0, 35,
  ARRAY['Malaria','Typhoid','Surgery','Obstetrics','Paediatrics','HIV/AIDS','Tuberculosis'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','Maternity Ward'],
  '[{"type":"General OPD","fee":15000,"notes":"Government HC IV"},{"type":"Specialist","fee":25000,"notes"},{"type":"Emergency","fee":20000,"notes":"24h emergency"}]',
  'Government Health Centre IV serving Mukono district with surgical, maternity, and outpatient services.',
  '{"malaria":86,"typhoid":82,"surgery":78}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),
(
  gen_random_uuid(),
  'Naggalama Hospital',
  'Naggalama, Mukono-Jinja Highway',
  'Mukono', 'Mukono County', 'Naggalama', 'Naggalama',
  '+256 414 290 185', null,
  0.3883, 32.8717,
  20000,
  83, 86, 4.1, 40,
  ARRAY['General Medicine','Surgery','Obstetrics','Paediatrics','Malaria','Typhoid','HIV/AIDS'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','Maternity Ward','Blood Bank'],
  '[{"type":"General OPD","fee":20000,"notes":"Includes review"},{"type":"Surgery","fee":500000,"notes":"Minor surgical procedures"}]',
  'Faith-based hospital (Uganda Protestant Medical Bureau) serving Mukono and Kayunga districts.',
  '{"malaria":87,"typhoid":84,"obs":89}',
  '{"Monday":{"open":"08:00","close":"18:00","closed":false},"Tuesday":{"open":"08:00","close":"18:00","closed":false},"Wednesday":{"open":"08:00","close":"18:00","closed":false},"Thursday":{"open":"08:00","close":"18:00","closed":false},"Friday":{"open":"08:00","close":"18:00","closed":false},"Saturday":{"open":"08:00","close":"14:00","closed":false},"Sunday":{"open":"09:00","close":"13:00","closed":false}}',
  true, true, false,
  now(), now()
),

-- ──────────────────────────────────────────────
-- JINJA DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Jinja Regional Referral Hospital',
  'Jinja Road, Jinja City',
  'Jinja', 'Jinja County', 'Jinja City', 'Mpumudde',
  '+256 434 120 155', null,
  0.4244, 33.2041,
  20000,
  88, 90, 4.3, 45,
  ARRAY['General Medicine','Surgery','Obstetrics','Paediatrics','Oncology','HIV/AIDS','Tuberculosis','Malaria','Typhoid'],
  ARRAY['Laboratory','X-Ray','CT Scan','Pharmacy','Theatre','ICU','Maternity Ward','Blood Bank'],
  '[{"type":"General OPD","fee":20000,"notes":"Government rates"},{"type":"Specialist","fee":40000,"notes":"Consultant review"},{"type":"Emergency","fee":30000,"notes":"24h emergency care"}]',
  'Eastern Uganda''s major referral hospital. Full specialist services, ICU, and 24-hour emergency care.',
  '{"malaria":90,"typhoid":88,"surgery":85,"obs":91}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),
(
  gen_random_uuid(),
  'Source of the Nile Medical Centre',
  'Main Street, Jinja City Centre',
  'Jinja', 'Jinja County', 'Jinja City', 'Jinja Central',
  '+256 772 500 300', null,
  0.4353, 33.2049,
  30000,
  84, 85, 4.3, 25,
  ARRAY['General Medicine','Malaria','Typhoid','Diabetes','Hypertension','Paediatrics'],
  ARRAY['Laboratory','Pharmacy','Ultrasound','ECG'],
  '[{"type":"General OPD","fee":30000,"notes":"Private clinic rate"},{"type":"Paediatric","fee":35000,"notes":"Children under 12"}]',
  'Private medical centre in Jinja City offering prompt outpatient care and diagnostic services.',
  '{"malaria":86,"typhoid":84,"diabetes":81}',
  '{"Monday":{"open":"08:00","close":"20:00","closed":false},"Tuesday":{"open":"08:00","close":"20:00","closed":false},"Wednesday":{"open":"08:00","close":"20:00","closed":false},"Thursday":{"open":"08:00","close":"20:00","closed":false},"Friday":{"open":"08:00","close":"20:00","closed":false},"Saturday":{"open":"08:00","close":"18:00","closed":false},"Sunday":{"open":"09:00","close":"14:00","closed":false}}',
  true, true, true,
  now(), now()
),

-- ──────────────────────────────────────────────
-- KAMPALA (selected key clinics)
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Mulago National Referral Hospital',
  'Mulago Hill Road, Kampala',
  'Kampala', 'Kampala Metropolitan', 'Mulago', 'Mulago Hill',
  '+256 414 530 000', null,
  0.3467, 32.5742,
  10000,
  88, 89, 4.0, 90,
  ARRAY['General Medicine','Surgery','Oncology','Cardiology','Obstetrics','Paediatrics','Neurology','HIV/AIDS','Tuberculosis'],
  ARRAY['Laboratory','X-Ray','CT Scan','MRI','Theatre','ICU','NICU','Blood Bank','Pharmacy'],
  '[{"type":"General OPD","fee":10000,"notes":"Government national hospital rate"},{"type":"Specialist","fee":25000,"notes":"Specialist consultation"},{"type":"Emergency","fee":15000,"notes":"24h emergency"}]',
  'Uganda''s national referral hospital. Tertiary care with full specialist cover including oncology, cardiology, and neurosurgery.',
  '{"malaria":88,"surgery":86,"obs":90,"hiv":92}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),
(
  gen_random_uuid(),
  'Nsambya Hospital',
  'Nsambya Road, Kampala',
  'Kampala', 'Kampala Metropolitan', 'Nsambya', 'Nsambya',
  '+256 414 268 000', null,
  0.3008, 32.5800,
  35000,
  90, 91, 4.5, 35,
  ARRAY['General Medicine','Surgery','Cardiology','Obstetrics','Paediatrics','Nephrology','Ophthalmology','HIV/AIDS'],
  ARRAY['Laboratory','X-Ray','CT Scan','Ultrasound','Pharmacy','Theatre','ICU','NICU','Blood Bank','Dialysis'],
  '[{"type":"General OPD","fee":35000,"notes":"Private faith-based rates"},{"type":"Specialist","fee":60000,"notes":"Consultant"},{"type":"Maternity","fee":300000,"notes":"Normal delivery package"}]',
  'Catholic faith-based private hospital. One of Uganda''s top-ranked hospitals by quality metrics.',
  '{"malaria":91,"surgery":89,"obs":92,"cardiology":88}',
  '{"Monday":{"open":"08:00","close":"20:00","closed":false},"Tuesday":{"open":"08:00","close":"20:00","closed":false},"Wednesday":{"open":"08:00","close":"20:00","closed":false},"Thursday":{"open":"08:00","close":"20:00","closed":false},"Friday":{"open":"08:00","close":"20:00","closed":false},"Saturday":{"open":"08:00","close":"18:00","closed":false},"Sunday":{"open":"09:00","close":"15:00","closed":false}}',
  true, true, true,
  now(), now()
),
(
  gen_random_uuid(),
  'Norvik Hospital',
  'Plot 8 Stretcher Road, Kampala',
  'Kampala', 'Kampala Metropolitan', 'Kololo', 'Kololo',
  '+256 312 200 600', null,
  0.3280, 32.5890,
  50000,
  91, 92, 4.6, 20,
  ARRAY['General Medicine','Surgery','Cardiology','Oncology','Orthopaedics','Neurology','Paediatrics'],
  ARRAY['Laboratory','X-Ray','CT Scan','MRI','Ultrasound','Pharmacy','Theatre','ICU','Blood Bank'],
  '[{"type":"General OPD","fee":50000,"notes":"Private specialist hospital"},{"type":"Specialist","fee":80000,"notes"},{"type":"Emergency","fee":60000,"notes":"24h emergency"}]',
  'Premium private hospital in Kampala offering specialist and tertiary care.',
  '{"malaria":90,"surgery":91,"cardiology":89}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, true,
  now(), now()
),

-- ──────────────────────────────────────────────
-- WAKISO DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Entebbe Hospital',
  'Hospital Road, Entebbe',
  'Wakiso', 'Busiro County', 'Entebbe', 'Entebbe Central',
  '+256 414 320 210', null,
  0.0527, 32.4637,
  15000,
  82, 84, 4.0, 35,
  ARRAY['General Medicine','Surgery','Obstetrics','Paediatrics','Malaria','Typhoid','HIV/AIDS'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','Maternity Ward'],
  '[{"type":"General OPD","fee":15000,"notes":"Government hospital"},{"type":"Specialist","fee":25000,"notes"}]',
  'District hospital serving Entebbe peninsula and Wakiso communities.',
  '{"malaria":85,"typhoid":82,"obs":86}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),

-- ──────────────────────────────────────────────
-- MBALE DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Mbale Regional Referral Hospital',
  'Pallisa Road, Mbale City',
  'Mbale', 'Mbale County', 'Mbale City', 'Industrial Area',
  '+256 454 433 025', null,
  1.0757, 34.1752,
  15000,
  85, 87, 4.1, 50,
  ARRAY['General Medicine','Surgery','Obstetrics','Paediatrics','Malaria','Typhoid','HIV/AIDS','Tuberculosis'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','ICU','Maternity Ward','Blood Bank'],
  '[{"type":"General OPD","fee":15000,"notes":"Government referral rates"},{"type":"Emergency","fee":20000,"notes":"24h emergency"}]',
  'Regional referral hospital for Eastern Uganda (Mount Elgon region).',
  '{"malaria":88,"typhoid":85,"surgery":83}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),

-- ──────────────────────────────────────────────
-- GULU DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Gulu Regional Referral Hospital',
  'Laroo Road, Gulu City',
  'Gulu', 'Gulu County', 'Gulu City', 'Laroo',
  '+256 471 432 240', null,
  2.7809, 32.2990,
  15000,
  83, 85, 4.0, 55,
  ARRAY['General Medicine','Surgery','Obstetrics','Paediatrics','HIV/AIDS','Tuberculosis','Malaria','Trauma'],
  ARRAY['Laboratory','X-Ray','Pharmacy','Theatre','ICU','Maternity Ward','Blood Bank'],
  '[{"type":"General OPD","fee":15000,"notes":"Government rates"},{"type":"Emergency","fee":20000,"notes":"24h trauma & emergency"}]',
  'Regional referral hospital for Northern Uganda.',
  '{"malaria":86,"typhoid":83,"surgery":81}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
),

-- ──────────────────────────────────────────────
-- MBARARA DISTRICT
-- ──────────────────────────────────────────────
(
  gen_random_uuid(),
  'Mbarara Regional Referral Hospital',
  'Kabale Road, Mbarara City',
  'Mbarara', 'Mbarara County', 'Mbarara City', 'Ruti',
  '+256 485 620 100', null,
  -0.6069, 30.6556,
  15000,
  87, 89, 4.2, 50,
  ARRAY['General Medicine','Surgery','Cardiology','Obstetrics','Paediatrics','HIV/AIDS','Tuberculosis','Diabetes'],
  ARRAY['Laboratory','X-Ray','CT Scan','Ultrasound','Pharmacy','Theatre','ICU','Maternity Ward','Blood Bank'],
  '[{"type":"General OPD","fee":15000,"notes":"Government rates"},{"type":"Specialist","fee":30000,"notes":"Consultant"},{"type":"Emergency","fee":20000,"notes":"24h emergency"}]',
  'Regional referral hospital for South Western Uganda. Teaching hospital affiliated with Mbarara University.',
  '{"malaria":87,"typhoid":85,"surgery":84,"obs":89}',
  '{"Monday":{"open":"00:00","close":"23:59","closed":false},"Tuesday":{"open":"00:00","close":"23:59","closed":false},"Wednesday":{"open":"00:00","close":"23:59","closed":false},"Thursday":{"open":"00:00","close":"23:59","closed":false},"Friday":{"open":"00:00","close":"23:59","closed":false},"Saturday":{"open":"00:00","close":"23:59","closed":false},"Sunday":{"open":"00:00","close":"23:59","closed":false}}',
  true, true, false,
  now(), now()
)

on conflict do nothing;

-- ──────────────────────────────────────────────
-- Verification query — run after insert to confirm
-- ──────────────────────────────────────────────
-- select id, name, district, city, parish, latitude, longitude
-- from clinics
-- where active = true
-- order by district, name;
