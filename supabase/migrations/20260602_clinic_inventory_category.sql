-- Add category column to clinic_inventory so clinicians can tag each
-- medicine with the illness / condition it treats (e.g. "Malaria",
-- "Antibiotics", "Pain / Fever").  The Quick Sale sheet uses this to
-- show category filter chips, making it faster to find a drug by
-- condition rather than having to remember the exact brand name.

alter table public.clinic_inventory
  add column if not exists category text default null;
