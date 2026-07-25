-- ── Realtime for the whole clinic dashboard ────────────────────────────────
-- The dashboard subscribes to postgres_changes on these tables so figures,
-- stock, bookings and REFERRALS update live (no refresh). Realtime only streams
-- a table if it is in the supabase_realtime publication — add each idempotently.
-- (The client also authorizes the socket with the logged-in token; both are
-- required for RLS tables to deliver events.)

do $$
declare
  t text;
  tbls text[] := array[
    'clinic_referrals',
    'clinic_diagnoses',
    'clinic_payments',
    'clinic_quick_sales',
    'clinic_inventory',
    'clinic_inventory_txns',
    'bookings'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Full row images in the WAL so realtime payloads carry every column.
do $$
declare
  t text;
  tbls text[] := array[
    'clinic_referrals','clinic_diagnoses','clinic_payments',
    'clinic_quick_sales','clinic_inventory','clinic_inventory_txns'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;
