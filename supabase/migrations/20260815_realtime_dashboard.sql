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
-- This also matters for DELETEs: the dashboard subscribes with a
-- clinic_id=eq.<id> filter, and without the full old row a delete arrives
-- carrying only the primary key, so the filter never matches and the panel
-- keeps showing something that is already gone.
do $$
declare
  t text;
  tbls text[] := array[
    'clinic_referrals','clinic_diagnoses','clinic_payments',
    'clinic_quick_sales','clinic_inventory','clinic_inventory_txns',
    'bookings'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;

-- ── Check it worked ───────────────────────────────────────────────────────
-- Should list all 7 tables with live = true and full_row = true.
select t.tablename,
       (p.tablename is not null)                as live,
       (c.relreplident = 'f')                   as full_row
  from unnest(array['bookings','clinic_diagnoses','clinic_payments',
                    'clinic_quick_sales','clinic_inventory',
                    'clinic_inventory_txns','clinic_referrals']) as t(tablename)
  left join pg_publication_tables p
         on p.pubname = 'supabase_realtime'
        and p.schemaname = 'public'
        and p.tablename = t.tablename
  left join pg_class c
         on c.relname = t.tablename
        and c.relnamespace = 'public'::regnamespace
 order by 1;
