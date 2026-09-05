-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — medicine expiry-date tracking + alerts
--
-- Fulfils Facility Service Agreement §2.1.7: "Automated low-stock alerts
-- AND expiry date notifications". Low-stock alerts already exist; this
-- adds the expiry half:
--   1. clinic_inventory.expiry_date  — optional date per stock item
--   2. get_clinic_stock              — now also returns expiry_date +
--                                      is_expired / is_expiring_soon flags
--                                      (soon = within 60 days)
--   3. cron_clinic_expiry_alert()    — daily push to clinic staff when
--                                      items are expired / expiring soon
--
-- Idempotent — safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Expiry column ──────────────────────────────────────────────
alter table public.clinic_inventory
  add column if not exists expiry_date date;

-- ── 2. get_clinic_stock with expiry flags ─────────────────────────
-- Return type changes, so the old signature must be dropped first
-- (CREATE OR REPLACE cannot change OUT parameters).
drop function if exists public.get_clinic_stock(uuid);

create or replace function public.get_clinic_stock(p_clinic_id uuid)
returns table (
  id               uuid,
  item_name        text,
  item_type        text,
  unit             text,
  quantity         numeric,
  min_threshold    numeric,
  reorder_level    numeric,
  unit_cost_ugx    numeric,
  is_low_stock     boolean,
  is_critical      boolean,
  expiry_date      date,
  is_expired       boolean,
  is_expiring_soon boolean
)
language sql
security definer
set search_path = public
as $$
  select
    id,
    item_name,
    item_type,
    unit,
    quantity,
    min_threshold,
    reorder_level,
    unit_cost_ugx,
    quantity <= min_threshold   as is_low_stock,
    quantity = 0                as is_critical,
    expiry_date,
    (expiry_date is not null and expiry_date < current_date)                              as is_expired,
    (expiry_date is not null and expiry_date >= current_date
       and expiry_date < current_date + interval '60 days')                               as is_expiring_soon
  from public.clinic_inventory
  where clinic_id = p_clinic_id
    and is_active = true
  order by
    (quantity <= min_threshold) desc,
    item_type,
    item_name;
$$;

grant execute on function public.get_clinic_stock(uuid) to authenticated;

-- ── 3. Daily expiry push alert ────────────────────────────────────
-- Mirrors cron_clinic_stock_alert: one push per clinic listing items
-- that are expired or expire within 60 days, sent to all active staff.
create or replace function cron_clinic_expiry_alert()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_players jsonb;
  v_msg     text;
begin
  for r in
    select
      i.clinic_id,
      c.name as clinic_name,
      count(*) filter (where i.expiry_date < current_date)::integer  as expired_count,
      count(*) filter (where i.expiry_date >= current_date)::integer as soon_count,
      string_agg(
        i.item_name || ' (' ||
          case when i.expiry_date < current_date
               then 'EXPIRED ' || to_char(i.expiry_date, 'DD Mon YYYY')
               else 'expires ' || to_char(i.expiry_date, 'DD Mon YYYY') end
        || ')',
        ', ' order by i.expiry_date asc
      ) as item_list
    from clinic_inventory i
    join clinics c on c.id = i.clinic_id
    where i.is_active = true
      and i.quantity > 0
      and i.expiry_date is not null
      and i.expiry_date < current_date + interval '60 days'
    group by i.clinic_id, c.name
    having count(*) > 0
  loop
    select jsonb_agg(pu.onesignal_player_id)
    into v_players
    from portal_users pu
    where pu.clinic_id = r.clinic_id
      and pu.is_active = true
      and pu.onesignal_player_id is not null;

    if v_players is null or jsonb_array_length(v_players) = 0 then
      continue;
    end if;

    v_msg :=
      case when r.expired_count > 0
           then r.expired_count || ' expired'
                || case when r.soon_count > 0 then ', ' || r.soon_count || ' expiring soon' else '' end
           else r.soon_count || ' expiring within 60 days' end
      || ': ' || left(r.item_list, 120)
      || case when length(r.item_list) > 120 then '…' else '. Check your stock.' end;

    perform notify_call(jsonb_build_object(
      'player_ids', v_players,
      'heading',    '⏰ Expiry Alert — ' || r.clinic_name,
      'message',    v_msg,
      'data',       jsonb_build_object('screen', 'stock')
    ));
  end loop;
end;
$$;

-- Schedule daily at 7:35am Uganda time (4:35am UTC) — 5 min after the
-- low-stock alert so staff get two clearly separate notifications.
do $$
begin
  perform cron.schedule(
    'clinic-expiry-alert',
    '35 4 * * *',
    'select cron_clinic_expiry_alert()'
  );
exception when others then
  raise notice 'cron.schedule skipped (pg_cron may not be enabled): %', sqlerrm;
end;
$$;

-- Verify
select proname from pg_proc where proname = 'cron_clinic_expiry_alert';
