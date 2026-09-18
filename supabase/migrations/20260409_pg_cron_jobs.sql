-- ============================================================
-- Homatt Health Uganda — pg_cron Scheduled Automation Jobs
--
-- Prerequisites:
--   1. Enable pg_cron extension in Supabase Dashboard → Database → Extensions
--   2. Set the service role key as a database setting (ONCE, run manually):
--      alter database postgres
--        set app.supabase_url = 'https://kgkdiykzmqjougwzzewi.supabase.co';
--      alter database postgres
--        set app.service_role_key = '<YOUR_SUPABASE_SERVICE_ROLE_KEY>';
--   3. Enable the pg_net extension (done in notification_system migration)
--
-- All times are in UTC. Uganda EAT = UTC+3.
-- ============================================================

-- ── ENABLE pg_cron ───────────────────────────────────────────
create extension if not exists pg_cron schema cron;

-- ── HELPER: call send-notification edge function ─────────────
create or replace function notify_call(payload jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_url  text := current_setting('app.supabase_url', true) || '/functions/v1/send-notification';
  v_key  text := current_setting('app.service_role_key', true);
begin
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := payload::text,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning '[notify_call] HTTP error: %', sqlerrm;
end;
$$;

-- ── JOB 1: Appointment reminder 24hr ahead ────────────────────
-- Runs every hour | cron: '0 * * * *'
create or replace function cron_appointment_reminder_24hr()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      b.id,
      b.patient_name,
      b.patient_user_id,
      b.appointment_time,
      b.clinic_id,
      c.name as clinic_name,
      p.onesignal_player_id
    from bookings b
    join clinics c on c.id = b.clinic_id
    left join profiles p on p.id = b.patient_user_id
    where b.appointment_time between (now() + interval '23 hours') and (now() + interval '25 hours')
      and b.reminder_sent = false
      and b.status not in ('cancelled','completed')
      and p.onesignal_player_id is not null
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Appointment Tomorrow 🏥',
      'message',    'Reminder: Your appointment at ' || r.clinic_name ||
                    ' is tomorrow at ' || to_char(r.appointment_time at time zone 'Africa/Kampala', 'HH12:MI AM') ||
                    '. Please bring any previous prescriptions.',
      'data',       jsonb_build_object('screen', 'bookings', 'id', r.id::text)
    ));
    update bookings set reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'appointment-reminder-24hr',
  '0 * * * *',
  'select cron_appointment_reminder_24hr()'
);

-- ── JOB 2: Appointment reminder same day (2hr) ────────────────
-- Runs every hour | cron: '30 * * * *'
create or replace function cron_appointment_reminder_2hr()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      b.id,
      b.patient_user_id,
      b.appointment_time,
      c.name as clinic_name,
      p.onesignal_player_id,
      p.notification_preferences
    from bookings b
    join clinics c on c.id = b.clinic_id
    left join profiles p on p.id = b.patient_user_id
    where b.appointment_time between (now() + interval '1 hour') and (now() + interval '3 hours')
      and b.same_day_reminder_sent = false
      and b.status not in ('cancelled','completed')
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'appointment_reminders')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'You have an appointment soon 💪',
      'message',    'Your appointment is in about 2 hours at ' || r.clinic_name ||
                    '. Don''t forget — your deposit is already paid!',
      'data',       jsonb_build_object('screen', 'bookings', 'id', r.id::text)
    ));
    update bookings set same_day_reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'appointment-reminder-2hr',
  '30 * * * *',
  'select cron_appointment_reminder_2hr()'
);

-- ── JOB 3: Medication adherence Day 2 ────────────────────────
-- Runs every hour | cron: '15 * * * *'
create or replace function cron_med_adherence_day2()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      o.id,
      o.patient_user_id,
      p.onesignal_player_id,
      p.notification_preferences
    from pharmacy_orders o
    left join profiles p on p.id = o.patient_user_id
    where o.status = 'delivered'
      and o.delivered_at between (now() - interval '49 hours') and (now() - interval '47 hours')
      and o.day2_reminder_sent = false
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'medicine_reminders')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Taking your medicines? ✅',
      'message',    'Even if you feel better, please continue the full course. Stopping early is the #1 cause of relapse.',
      'data',       jsonb_build_object('screen', 'orders', 'id', r.id::text)
    ));
    update pharmacy_orders set day2_reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'med-adherence-day2',
  '15 * * * *',
  'select cron_med_adherence_day2()'
);

-- ── JOB 4: Medication adherence Day 4 ────────────────────────
-- Runs every hour | cron: '20 * * * *'
create or replace function cron_med_adherence_day4()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      o.id,
      o.patient_user_id,
      p.onesignal_player_id,
      p.notification_preferences
    from pharmacy_orders o
    left join profiles p on p.id = o.patient_user_id
    where o.status = 'delivered'
      and o.delivered_at between (now() - interval '97 hours') and (now() - interval '95 hours')
      and o.day4_reminder_sent = false
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'medicine_reminders')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Halfway through — keep going 💊',
      'message',    'You''re halfway through your treatment. Finish all your medicines for full recovery.',
      'data',       jsonb_build_object('screen', 'orders', 'id', r.id::text)
    ));
    update pharmacy_orders set day4_reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'med-adherence-day4',
  '20 * * * *',
  'select cron_med_adherence_day4()'
);

-- ── JOB 5: Recovery check Day 7 ──────────────────────────────
-- Runs every hour | cron: '25 * * * *'
create or replace function cron_recovery_check_day7()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      o.id,
      o.patient_user_id,
      o.booking_code,
      p.onesignal_player_id,
      p.notification_preferences
    from pharmacy_orders o
    left join profiles p on p.id = o.patient_user_id
    where o.status = 'delivered'
      and o.delivered_at between (now() - interval '169 hours') and (now() - interval '167 hours')
      and o.day7_reminder_sent = false
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'recovery_checkins')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'How are you feeling today? 💚',
      'message',    'Tap to let us know — Better / Same / Worse. If you need help, rebook your clinic easily on Homatt.',
      'data',       jsonb_build_object('screen', 'recovery-check', 'id', r.id::text)
    ));
    update pharmacy_orders set day7_reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'recovery-check-day7',
  '25 * * * *',
  'select cron_recovery_check_day7()'
);

-- ── JOB 6: Follow-up booking nudge Day 14 ────────────────────
-- Runs daily at 8am Uganda time (5am UTC) | cron: '0 5 * * *'
create or replace function cron_followup_booking_day14()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      b.id,
      b.patient_user_id,
      b.clinic_id,
      p.onesignal_player_id,
      p.notification_preferences
    from bookings b
    left join profiles p on p.id = b.patient_user_id
    where b.status = 'completed'
      and b.followup_required = true
      and b.updated_at between (now() - interval '15 days') and (now() - interval '13 days')
      and b.followup_reminder_sent = false
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'appointment_reminders')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Your follow-up is due 📋',
      'message',    'Your doctor recommended a follow-up visit. Your health record is saved — book in 30 seconds on Homatt.',
      'data',       jsonb_build_object('screen', 'book-followup', 'clinic_id', r.clinic_id::text, 'id', r.id::text)
    ));
    update bookings set followup_reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'followup-booking-day14',
  '0 5 * * *',
  'select cron_followup_booking_day14()'
);

-- ── JOB 7: Patient dropout detection ─────────────────────────
-- Runs daily at 7am Uganda time (4am UTC) | cron: '0 4 * * *'
create or replace function cron_dropout_detection()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  v_vht_player_id text;
begin
  for r in
    select
      o.id as order_id,
      o.patient_user_id,
      o.booking_code,
      p.onesignal_player_id,
      p.first_name,
      -- find if patient has any bookings newer than 5 days ago
      (select count(*) from bookings b2
       where b2.patient_user_id = o.patient_user_id
         and b2.created_at > now() - interval '5 days') as recent_bookings,
      -- find linked proxy/VHT
      (select pu.onesignal_player_id from bookings bx
       join proxy_users pu on pu.id = bx.proxy_id
       where bx.patient_user_id = o.patient_user_id
         and bx.proxy_assisted = true
       order by bx.created_at desc limit 1) as vht_player_id,
      (select bx.proxy_id from bookings bx
       where bx.patient_user_id = o.patient_user_id
         and bx.proxy_assisted = true
       order by bx.created_at desc limit 1) as vht_id,
      (select bx.id from bookings bx
       where bx.patient_user_id = o.patient_user_id
       order by bx.created_at desc limit 1) as latest_booking_id
    from pharmacy_orders o
    left join profiles p on p.id = o.patient_user_id
    where o.status = 'delivered'
      and o.delivered_at < now() - interval '5 days'
      and o.recovery_status is null
      and p.onesignal_player_id is not null
  loop
    -- Only flag if no recent bookings
    if r.recent_bookings = 0 then
      -- Push to patient
      perform notify_call(jsonb_build_object(
        'player_ids', jsonb_build_array(r.onesignal_player_id),
        'heading',    'We miss you 💙',
        'message',    'We noticed you haven''t checked in since your last visit. Your health matters — let us know how you''re doing.',
        'data',       jsonb_build_object('screen', 'recovery-check', 'id', r.order_id::text)
      ));

      -- Push to VHT if linked
      if r.vht_player_id is not null then
        perform notify_call(jsonb_build_object(
          'player_ids', jsonb_build_array(r.vht_player_id),
          'heading',    'Patient follow-up needed',
          'message',    'Patient ' || coalesce(r.first_name, 'in your area') ||
                        ' missed their follow-up. Please check on them.',
          'data',       jsonb_build_object('screen', 'follow-up-alerts')
        ));

        -- Create follow-up alert record
        insert into follow_up_alerts (patient_id, vht_id, booking_id, reason)
        values (r.patient_user_id, r.vht_id, r.latest_booking_id, 'dropout_detected');
      end if;

      -- Create admin alert
      insert into admin_alerts (type, message, related_table, related_id, severity)
      values (
        'patient_dropout',
        'Patient ' || coalesce(r.first_name, 'Unknown') || ' has not completed their medicine course. Flag for follow-up.',
        'pharmacy_orders',
        r.order_id,
        'warning'
      );
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'dropout-detection',
  '0 4 * * *',
  'select cron_dropout_detection()'
);

-- ── JOB 8: Deposit/payment reminder ──────────────────────────
-- Runs every 30 minutes | cron: '*/30 * * * *'
create or replace function cron_deposit_reminder()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      b.id,
      b.patient_user_id,
      b.deposit_amount,
      c.name as clinic_name,
      p.onesignal_player_id,
      p.notification_preferences
    from bookings b
    join clinics c on c.id = b.clinic_id
    left join profiles p on p.id = b.patient_user_id
    where b.status = 'pending'
      and b.created_at between (now() - interval '2 hours') and (now() - interval '1 hour')
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'appointment_reminders')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Complete your booking 📱',
      'message',    'Pay your deposit of UGX ' ||
                    coalesce(r.deposit_amount::text, '0') ||
                    ' via MoMo to confirm your appointment at ' || r.clinic_name || '.',
      'data',       jsonb_build_object('screen', 'complete-payment', 'id', r.id::text)
    ));
  end loop;
end;
$$;

select cron.schedule(
  'deposit-reminder',
  '*/30 * * * *',
  'select cron_deposit_reminder()'
);

-- ── JOB 9: Daily digest for clinic staff ─────────────────────
-- Runs daily at 7am Uganda time (4am UTC) | cron: '0 4 * * *'
-- Note: offset by 1 minute from dropout detection to avoid conflicts
create or replace function cron_clinic_daily_digest()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  v_count integer;
  v_first_time text;
  v_player_ids jsonb;
begin
  for r in
    select distinct b.clinic_id, c.name as clinic_name
    from bookings b
    join clinics c on c.id = b.clinic_id
    where date(b.appointment_time at time zone 'Africa/Kampala') = current_date
      and b.status not in ('cancelled')
  loop
    -- Count today's appointments
    select count(*), min(to_char(b.appointment_time at time zone 'Africa/Kampala', 'HH12:MI AM'))
    into v_count, v_first_time
    from bookings b
    where b.clinic_id = r.clinic_id
      and date(b.appointment_time at time zone 'Africa/Kampala') = current_date
      and b.status not in ('cancelled');

    -- Gather all clinic staff player IDs
    select jsonb_agg(pu.onesignal_player_id)
    into v_player_ids
    from portal_users pu
    where pu.clinic_id = r.clinic_id
      and pu.is_active = true
      and pu.onesignal_player_id is not null;

    if v_player_ids is not null and jsonb_array_length(v_player_ids) > 0 and v_count > 0 then
      perform notify_call(jsonb_build_object(
        'player_ids', v_player_ids,
        'heading',    'Good morning 🏥 ' || r.clinic_name,
        'message',    'You have ' || v_count || ' patient' || case when v_count != 1 then 's' else '' end ||
                      ' booked today. First appointment: ' || coalesce(v_first_time, 'not set') || '.',
        'data',       jsonb_build_object('screen', 'today-schedule')
      ));
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'clinic-daily-digest',
  '1 4 * * *',
  'select cron_clinic_daily_digest()'
);

-- ── JOB 10: Daily digest for pharmacy staff ───────────────────
-- Runs daily at 7am Uganda time (4am UTC, offset 5 min) | cron: '5 4 * * *'
create or replace function cron_pharmacy_daily_digest()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  v_order_count integer;
  v_low_stock_count integer;
  v_player_ids jsonb;
begin
  for r in
    select distinct o.pharmacy_id, ph.name as pharmacy_name
    from pharmacy_orders o
    join pharmacies ph on ph.id = o.pharmacy_id
    where o.status in ('incoming','confirmed','preparing')
  loop
    -- Count pending orders
    select count(*) into v_order_count
    from pharmacy_orders
    where pharmacy_id = r.pharmacy_id
      and status in ('incoming','confirmed','preparing');

    -- Count low-stock items
    select count(*) into v_low_stock_count
    from pharmacy_inventory
    where pharmacy_id = r.pharmacy_id
      and quantity <= reorder_threshold
      and is_available = true;

    -- Gather pharmacy staff player IDs
    select jsonb_agg(pu.onesignal_player_id)
    into v_player_ids
    from portal_users pu
    where pu.pharmacy_id = r.pharmacy_id
      and pu.is_active = true
      and pu.onesignal_player_id is not null;

    if v_player_ids is not null and jsonb_array_length(v_player_ids) > 0 then
      perform notify_call(jsonb_build_object(
        'player_ids', v_player_ids,
        'heading',    'Good morning 💊 ' || r.pharmacy_name,
        'message',    'You have ' || coalesce(v_order_count, 0) || ' pending order' ||
                      case when coalesce(v_order_count, 0) != 1 then 's' else '' end ||
                      ' today. ' || coalesce(v_low_stock_count, 0) || ' item' ||
                      case when coalesce(v_low_stock_count, 0) != 1 then 's are' else ' is' end ||
                      ' low on stock.',
        'data',       jsonb_build_object('screen', 'orders')
      ));
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'pharmacy-daily-digest',
  '5 4 * * *',
  'select cron_pharmacy_daily_digest()'
);
