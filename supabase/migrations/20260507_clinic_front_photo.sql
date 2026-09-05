-- Clinic front photo + storage bucket
-- Adds a column for the public photo of the clinic's front so patients can
-- recognise the building when booking from the mobile app.
-- Also creates the storage bucket and public-read policies.
-- Safe to run multiple times.

-- 1. Column on clinics
alter table public.clinics
  add column if not exists front_photo_url text;

comment on column public.clinics.front_photo_url is
  'Public URL of the photo of the clinic''s front, shown to users in the booking flow.';

-- 2. Storage bucket (public-read, authenticated-write)
insert into storage.buckets (id, name, public)
values ('clinic-photos', 'clinic-photos', true)
on conflict (id) do update set public = true;

-- 3. Storage policies — anyone can read, only authenticated users can write
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinic-photos public read'
  ) then
    create policy "clinic-photos public read"
      on storage.objects for select
      using (bucket_id = 'clinic-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinic-photos auth insert'
  ) then
    create policy "clinic-photos auth insert"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'clinic-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinic-photos auth update'
  ) then
    create policy "clinic-photos auth update"
      on storage.objects for update
      to authenticated
      using (bucket_id = 'clinic-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinic-photos auth delete'
  ) then
    create policy "clinic-photos auth delete"
      on storage.objects for delete
      to authenticated
      using (bucket_id = 'clinic-photos');
  end if;
end$$;
