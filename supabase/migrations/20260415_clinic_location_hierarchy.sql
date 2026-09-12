-- ============================================================
-- Clinic Uganda Location Hierarchy
-- Adds county and parish columns so clinic staff can enter their
-- location using familiar Uganda administrative divisions instead
-- of GPS coordinates.
-- ============================================================

alter table clinics
  add column if not exists county    text,   -- e.g. "Bugiri County"
  add column if not exists parish    text;   -- e.g. "Butto Parish"

-- Rename the 'city' semantic to subcounty via comment
-- (column stays 'city' for backwards compatibility but is now
--  used exclusively as the subcounty / town name)
comment on column clinics.city   is 'Subcounty or town name (e.g. Butto, Ntinda, Naguru)';
comment on column clinics.county is 'County name within the district';
comment on column clinics.parish is 'Parish or village name — most specific area level';

-- Index for text-based location matching (subcounty + district)
create index if not exists idx_clinics_location_text
  on clinics (lower(district), lower(city))
  where active = true;
