-- ════════════════════════════════════════════════════════════════════
-- Fix: bookings_status_check — allow all status values the app uses
-- ────────────────────────────────────────────────────────────────────
-- The live DB's bookings.status check constraint is stricter than the
-- one in the original schema, so updating a booking to 'attended'
-- (when staff clicks "Done" on Patients Coming In) fails with:
--   new row for relation "bookings" violates check constraint
--   "bookings_status_check"
--
-- This drops and recreates the constraint with every status the app
-- actually sends, including 'no_show' which we now use for missed
-- appointments. Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'bookings_status_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings drop constraint bookings_status_check;
  end if;
end $$;

alter table public.bookings
  add constraint bookings_status_check
  check (status in (
    'pending',
    'confirmed',
    'in_progress',
    'attended',
    'completed',
    'cancelled',
    'no_show'
  ));

-- Confirm the new constraint is in place
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'bookings_status_check';
