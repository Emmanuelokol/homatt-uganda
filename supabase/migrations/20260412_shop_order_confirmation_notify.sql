-- ================================================================
-- Homatt Health Uganda — Shop Order Confirmation Push Notification
--
-- DB trigger: fires AFTER marketplace_orders.status transitions to
-- 'confirmed', sends a OneSignal push to the customer via the
-- send-notification Edge Function (pg_net async HTTP call).
--
-- Also fixes notify_call() — the body parameter must be jsonb (not
-- text) for net.http_post in pg_net 0.19.5+. Falls back to the
-- anon key when app.service_role_key is not configured so all
-- pg_cron notification jobs also work.
-- ================================================================

-- ── Fix notify_call (used by all pg_cron notification jobs) ────
create or replace function notify_call(payload jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_url  text := coalesce(
                   current_setting('app.supabase_url', true),
                   'https://kgkdiykzmqjougwzzewi.supabase.co'
                 ) || '/functions/v1/send-notification';
  v_key  text := coalesce(
                   current_setting('app.service_role_key', true),
                   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8'
                 );
begin
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := payload,   -- jsonb directly (net.http_post expects jsonb, not text)
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning '[notify_call] HTTP error: %', sqlerrm;
end;
$$;

-- ── Trigger function: send confirmation push to customer ────────
create or replace function trigger_notify_shop_order_confirmed()
returns trigger
language plpgsql
security definer
as $$
declare
  v_url       text := 'https://kgkdiykzmqjougwzzewi.supabase.co/functions/v1/send-notification';
  v_key       text := coalesce(
                        current_setting('app.service_role_key', true),
                        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8'
                      );
  v_names     text[];
  v_item_list text;
  v_is_plural boolean;
begin
  -- Only fire when transitioning TO 'confirmed' (not on re-saves)
  if new.status = 'confirmed'
     and old.status is distinct from 'confirmed'
     and new.user_id is not null
  then
    -- Extract item names from items JSONB array [{id,name,price,qty,unit},…]
    select array_agg(item ->> 'name' order by ordinality)
    into   v_names
    from   jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
             with ordinality as item
    where  item ->> 'name' is not null;

    -- Build readable list (max 3 shown, then "and N more")
    if v_names is null or cardinality(v_names) = 0 then
      v_item_list := 'Your items';
      v_is_plural := true;
    elsif cardinality(v_names) = 1 then
      v_item_list := v_names[1];
      v_is_plural := false;
    elsif cardinality(v_names) <= 3 then
      v_item_list := array_to_string(v_names, ', ');
      v_is_plural := true;
    else
      v_item_list := array_to_string(v_names[1:3], ', ')
                     || ' and ' || (cardinality(v_names) - 3)::text || ' more';
      v_is_plural := true;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'userId',        new.user_id::text,
        'title',         'Order Confirmed',
        'message',       v_item_list
                         || case when v_is_plural then ' are' else ' is' end
                         || ' confirmed for delivery today. Our rider will be with you soon!',
        'data',          jsonb_build_object(
                           'screen', 'shop_order',
                           'id',     new.id::text
                         ),
        'pref_category', 'promo_prevention_shop'
      ),
      timeout_milliseconds := 10000
    );
  end if;

  return new;
exception when others then
  raise warning '[shop_order_confirmed_notify] error: %', sqlerrm;
  return new;
end;
$$;

-- ── Trigger on marketplace_orders ──────────────────────────────
drop trigger if exists shop_order_confirmed_notify on marketplace_orders;

create trigger shop_order_confirmed_notify
  after update on marketplace_orders
  for each row
  execute function trigger_notify_shop_order_confirmed();
