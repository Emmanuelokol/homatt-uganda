-- Remove the auto-seeded Kampala clinics that were added without the user's request.
-- Only keep clinics the admin registered manually.
-- Run this in Supabase SQL Editor.

delete from clinics
where name in (
  'Butto Health Centre III',
  'Busia General Hospital',
  'Masaba Health Centre II',
  'Mukono Family Clinic',
  'Mukono Health Centre IV',
  'Naggalama Hospital',
  'Jinja Regional Referral Hospital',
  'Source of the Nile Medical Centre',
  'Mulago National Referral Hospital',
  'Nsambya Hospital',
  'Norvik Hospital',
  'Entebbe Hospital',
  'Mbale Regional Referral Hospital',
  'Gulu Regional Referral Hospital',
  'Mbarara Regional Referral Hospital'
);

-- Verify only your manually created clinics remain:
select id, name, district, city, county, parish, active, verified
from clinics
order by created_at;
