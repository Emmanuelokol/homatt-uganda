-- ============================================================
-- Homatt Health — Clinic follow-up reminders (the "come back" nudge)
--
-- PROBLEM THIS FIXES:
--   When a clinician records a follow-up in the portal (e.g. "Return in 7
--   days for BP recheck"), it is saved on clinic_diagnoses as
--   follow_up_days / follow_up_at / follow_up_reason. NOTHING ever reminded
--   the patient on that day — the only follow-up cron (JOB 6) reads a
--   different, generic bookings.followup_required flag at a fixed 14 days.
--
--   This migration adds a cron job that reads the ACTUAL clinical follow-up
--   the doctor scheduled and reminds the patient:
--     • the evening before  ("your follow-up is tomorrow")
--     • the morning it is due ("your follow-up is today")
--   Each reminder includes the clinic name and the doctor's reason.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── 1. Tracking columns so each reminder fires once ──────────
alter table clinic_diagnoses
  add column if not exists follow_up_reminder_sent     boolean default false,
  add column if not exists follow_up_reminder_eve_sent boolean default false;

comment on column clinic_diagnoses.follow_up_reminder_sent is
  'True once the day-of "follow-up is due today" push has been sent.';
comment on column clinic_diagnoses.follow_up_reminder_eve_sent is
  'True once the day-before "follow-up is tomorrow" push has been sent.';

-- Partial index so the cron scan stays cheap as the table grows.
create index if not exists idx_clinic_diagnoses_followup_pending
  on clinic_diagnoses (created_at)
  where coalesce(follow_up_reminder_sent, false) = false
    and (follow_up_at is not null or follow_up_days is not null);

-- ── 2. The cron function ─────────────────────────────────────
-- Runs daily at 06:00 UTC (09:00 EAT). Computes each follow-up's due date
-- (explicit follow_up_at, else created_at + follow_up_days) in Kampala time
-- and sends the appropriate reminder.
create or replace function cron_clinic_followup_reminder()
returns void
language plpgsql
security definer
as $$
declare
  r           record;
  v_today     date := (now() at time zone 'Africa/Kampala')::date;
  v_player_id text;
  v_prefs     jsonb;
  v_reason    text;
  v_head      text;
  v_msg       text;
begin
  for r in
    select
      dx.id,
      dx.clinic_id,
      dx.booking_id,
      dx.patient_phone,
      dx.patient_name,
      dx.follow_up_reason,
      coalesce(
        (dx.follow_up_at at time zone 'Africa/Kampala')::date,
        -- Postgres: date + integer adds that many days, returning a date
        ((dx.created_at at time zone 'Africa/Kampala')::date + dx.follow_up_days)
      ) as due_date,
      coalesce(dx.follow_up_reminder_sent, false)     as day_of_sent,
      coalesce(dx.follow_up_reminder_eve_sent, false) as eve_sent,
      c.name as clinic_name
    from clinic_diagnoses dx
    left join clinics c on c.id = dx.clinic_id
    where (dx.follow_up_at is not null
           or (dx.follow_up_days is not null and dx.follow_up_days > 0))
      and coalesce(dx.follow_up_reminder_sent, false) = false
  loop
    -- Skip anything not due today or tomorrow
    if r.due_date is null
       or (r.due_date <> v_today and r.due_date <> v_today + 1) then
      continue;
    end if;

    -- ── Resolve the patient's device + preferences ──
    v_player_id := null; v_prefs := null;
    if r.booking_id is not null then
      select p.onesignal_player_id, p.notification_preferences
        into v_player_id, v_prefs
        from bookings b
        join profiles p on p.id = b.patient_user_id
       where b.id = r.booking_id;
    end if;
    if v_player_id is null and r.patient_phone is not null then
      select p.onesignal_player_id, p.notification_preferences
        into v_player_id, v_prefs
        from profiles p
       where p.phone_number = r.patient_phone
          or p.phone = r.patient_phone
       limit 1;
    end if;

    -- No Homatt device → nothing to send (walk-in without the app)
    if v_player_id is null then
      continue;
    end if;

    -- Respect the patient's appointment-reminder preference
    if coalesce((v_prefs->>'appointment_reminders')::boolean, true) = false then
      continue;
    end if;

    v_reason := case
                  when r.follow_up_reason is not null
                   and length(trim(r.follow_up_reason)) > 0
                  then ' — ' || r.follow_up_reason
                  else ''
                end;

    if r.due_date = v_today then
      -- ── Day-of reminder ──
      v_head := 'Your follow-up is today 📋';
      v_msg  := 'Time to return to ' || coalesce(r.clinic_name, 'the clinic')
                || v_reason || '. Book your visit in 30 seconds on Homatt.';
      perform notify_call(jsonb_build_object(
        'player_ids', jsonb_build_array(v_player_id),
        'heading',    v_head,
        'message',    v_msg,
        'data',       jsonb_build_object(
                        'screen',    'book-followup',
                        'clinic_id', r.clinic_id::text,
                        'id',        coalesce(r.booking_id::text, r.id::text)
                      )
      ));
      update clinic_diagnoses
         set follow_up_reminder_sent = true
       where id = r.id;

    elsif r.due_date = v_today + 1 and not r.eve_sent then
      -- ── Evening-before reminder ──
      v_head := 'Follow-up tomorrow 🗓️';
      v_msg  := 'Reminder: your follow-up at ' || coalesce(r.clinic_name, 'the clinic')
                || ' is tomorrow' || v_reason || '. Tap to book your slot on Homatt.';
      perform notify_call(jsonb_build_object(
        'player_ids', jsonb_build_array(v_player_id),
        'heading',    v_head,
        'message',    v_msg,
        'data',       jsonb_build_object(
                        'screen',    'book-followup',
                        'clinic_id', r.clinic_id::text,
                        'id',        coalesce(r.booking_id::text, r.id::text)
                      )
      ));
      update clinic_diagnoses
         set follow_up_reminder_eve_sent = true
       where id = r.id;
    end if;
  end loop;
end;
$$;

-- ── 3. Schedule it (idempotent: unschedule first if present) ─
do $$
begin
  perform cron.unschedule('clinic-followup-reminder');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'clinic-followup-reminder',
  '0 6 * * *',          -- daily 06:00 UTC = 09:00 EAT
  'select cron_clinic_followup_reminder()'
);
