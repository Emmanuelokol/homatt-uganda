-- ════════════════════════════════════════════════════════════════════
-- Enable Supabase Realtime for the clinic dashboard tables.
--
-- The dashboard subscribes to postgres_changes on these tables so that
-- Financial Overview, Stock and Revenue update live without a refresh.
-- Those events are ONLY delivered if the table is a member of the
-- `supabase_realtime` publication — otherwise the client sees nothing
-- and the operator has to reload the page. This migration adds every
-- table the dashboard listens to, guarded so it is safe to re-run.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  tables text[] := array[
    'bookings',
    'clinic_diagnoses',
    'clinic_payments',
    'clinic_inventory',
    'clinic_inventory_txns',
    'clinic_quick_sales'
  ];
begin
  -- Create the publication if it doesn't exist yet (fresh projects).
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array tables loop
    -- Only add tables that actually exist and aren't already published.
    if exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = t
       )
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Ensure UPDATE/DELETE events carry the full old row so client filters
-- (e.g. clinic_id) match on deletes too.
alter table public.clinic_quick_sales   replica identity full;
alter table public.clinic_inventory      replica identity full;
alter table public.clinic_inventory_txns replica identity full;
