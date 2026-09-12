-- =============================================================
-- Disable the deposit-reminder cron notification.
-- The current implementation fires for ALL pending bookings
-- even when deposit_amount is NULL / 0, producing misleading
-- "Pay UGX 0 via MoMo" push notifications.
-- The Homatt booking flow does not require upfront deposits, so
-- the reminder is removed entirely.
-- =============================================================

-- 1. Unschedule the cron job — wrapped so it never errors if absent
do $$
begin
  perform cron.unschedule('deposit-reminder');
exception
  when others then
    -- Job didn't exist (or pg_cron not installed) — nothing to do
    null;
end $$;

-- 2. Drop the function so it cannot be re-invoked manually
drop function if exists cron_deposit_reminder();

-- 3. Rewrite the 2-hour appointment reminder so it doesn't mention the
--    nonexistent "deposit is already paid" line that confuses patients.
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
      'heading',    'Your appointment is in 2 hours',
      'message',    'See you soon at ' || r.clinic_name ||
                    '. Have your booking code and PIN ready at reception.',
      'data',       jsonb_build_object('screen', 'bookings', 'id', r.id::text)
    ));
    update bookings set same_day_reminder_sent = true where id = r.id;
  end loop;
end;
$$;
