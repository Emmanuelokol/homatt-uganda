-- ============================================================
-- Homatt Health Uganda — Symptom Monitoring Logs Table
-- + pg_cron Hourly Check-in Reminder (JOB 11)
--
-- Tracks active symptom monitoring sessions so the backend
-- can send hourly push notification reminders with
-- Better / Same / Worse action buttons.
-- ============================================================

-- ── Table: symptom_monitoring_logs ───────────────────────────
create table if not exists symptom_monitoring_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id) on delete cascade,
  condition       text not null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  outcome         text not null default 'active',
    -- 'active' | 'recovered' | 'escalated' | 'abandoned'
  check_ins       jsonb default '[]'::jsonb,
  what_helped     text,
  last_checkin_at timestamptz default now(),
  unique (user_id, started_at)
);

alter table symptom_monitoring_logs enable row level security;

create policy "Users can manage own monitoring logs"
  on symptom_monitoring_logs for all
  using (auth.uid() = user_id);

-- Index so pg_cron can efficiently find active sessions
create index if not exists idx_sml_active
  on symptom_monitoring_logs (outcome, last_checkin_at)
  where outcome = 'active';

-- ── JOB 11: Hourly symptom check-in reminder ─────────────────
-- Runs every hour at :45 (after pg_cron jobs 1–10) | cron: '45 * * * *'
-- Finds active monitoring sessions where last check-in was 55+ min ago
-- and sends a push notification with Better / Same / Worse action buttons.
create or replace function cron_symptom_checkin_reminder()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      sml.id,
      sml.user_id,
      sml.condition,
      p.onesignal_player_id,
      p.notification_preferences
    from symptom_monitoring_logs sml
    left join profiles p on p.id = sml.user_id
    where sml.outcome = 'active'
      and sml.last_checkin_at < now() - interval '55 minutes'
      and p.onesignal_player_id is not null
      and coalesce((p.notification_preferences->>'recovery_checkins')::boolean, true) = true
  loop
    perform notify_call(jsonb_build_object(
      'player_ids', jsonb_build_array(r.onesignal_player_id),
      'heading',    'Symptom Check-in: ' || r.condition,
      'message',    'Time for your hourly check-in. How are you feeling? Tap a button below.',
      'data',       jsonb_build_object('screen', 'symptom-checkin'),
      'buttons',    jsonb_build_array(
        jsonb_build_object('id', 'feeling_better', 'text', 'Better'),
        jsonb_build_object('id', 'feeling_same',   'text', 'Same'),
        jsonb_build_object('id', 'feeling_worse',  'text', 'Worse')
      )
    ));

    -- Update last_checkin_at to prevent duplicate sends until next real check-in
    update symptom_monitoring_logs
      set last_checkin_at = now()
      where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'symptom-checkin-reminder',
  '45 * * * *',
  'select cron_symptom_checkin_reminder()'
);
