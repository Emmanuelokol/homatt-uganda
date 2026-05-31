-- ============================================================
-- Clinic Settings: Add missing profile/location columns
-- Ensures all fields saved by settings.html are persisted in DB
-- ============================================================

alter table clinics
  add column if not exists description       text,
  add column if not exists whatsapp          text,
  add column if not exists contact_person    text,
  add column if not exists city              text,
  add column if not exists latitude          numeric,
  add column if not exists longitude         numeric,
  add column if not exists specialties       text[],
  add column if not exists facilities        text[],
  add column if not exists services          jsonb,
  add column if not exists consultation_fee  numeric,
  add column if not exists opening_hours     jsonb;

-- Spatial index for nearest-clinic queries (Haversine via lat/lng)
create index if not exists idx_clinics_latlon
  on clinics (latitude, longitude)
  where latitude is not null and longitude is not null and active = true;

-- Allow public read of active clinics (needed for patient booking)
create policy if not exists "Patients can read active clinics"
  on clinics for select
  using (active = true);

comment on column clinics.description      is 'Clinic about/description shown to patients';
comment on column clinics.whatsapp         is 'WhatsApp contact number';
comment on column clinics.contact_person   is 'Manager or contact person name';
comment on column clinics.city             is 'City or subcounty';
comment on column clinics.latitude         is 'GPS latitude for distance-based sorting';
comment on column clinics.longitude        is 'GPS longitude for distance-based sorting';
comment on column clinics.specialties      is 'Array of medical specialties/conditions treated';
comment on column clinics.facilities       is 'Available facilities (lab, X-ray, etc.)';
comment on column clinics.services         is 'Service fee list [{type, fee, notes}]';
comment on column clinics.consultation_fee is 'General consultation fee in UGX';
comment on column clinics.opening_hours    is 'Opening hours per day {Monday: {open, close, closed}}';
