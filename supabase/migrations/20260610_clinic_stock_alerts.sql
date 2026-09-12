-- ════════════════════════════════════════════════════════════
-- Clinic stock low-threshold push alert (pg_cron job)
-- Runs once daily at 7:30am Uganda time (4:30am UTC).
-- Sends a push to all active clinic staff when any item in their
-- inventory is at or below its min_threshold.
-- ════════════════════════════════════════════════════════════

create or replace function cron_clinic_stock_alert()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_items  jsonb;
  v_msg    text;
  v_players jsonb;
  v_count  integer;
begin
  -- Loop over every clinic that has at least one low-stock item
  for r in
    select
      i.clinic_id,
      c.name as clinic_name,
      count(*)::integer as low_count,
      string_agg(i.item_name || ' (' || i.quantity || ' left)', ', ' order by i.quantity asc) as item_list
    from clinic_inventory i
    join clinics c on c.id = i.clinic_id
    where i.is_active = true
      and i.quantity <= coalesce(i.min_threshold, 5)
    group by i.clinic_id, c.name
    having count(*) > 0
  loop
    -- Gather OneSignal player IDs for active staff at this clinic
    select jsonb_agg(pu.onesignal_player_id)
    into v_players
    from portal_users pu
    where pu.clinic_id = r.clinic_id
      and pu.is_active = true
      and pu.onesignal_player_id is not null;

    if v_players is null or jsonb_array_length(v_players) = 0 then
      continue;
    end if;

    v_msg := r.low_count || ' item' || case when r.low_count != 1 then 's are' else ' is' end
           || ' running low: ' || left(r.item_list, 120)
           || case when length(r.item_list) > 120 then '…' else '. Restock soon.' end;

    perform notify_call(jsonb_build_object(
      'player_ids', v_players,
      'heading',    '⚠️ Low Stock Alert — ' || r.clinic_name,
      'message',    v_msg,
      'data',       jsonb_build_object('screen', 'stock')
    ));
  end loop;
end;
$$;

-- Schedule daily at 7:30am Uganda time (4:30am UTC)
do $$
begin
  perform cron.schedule(
    'clinic-stock-alert',
    '30 4 * * *',
    'select cron_clinic_stock_alert()'
  );
exception when others then
  raise notice 'cron.schedule skipped (pg_cron may not be enabled): %', sqlerrm;
end;
$$;

-- Verify
select proname from pg_proc where proname = 'cron_clinic_stock_alert';
