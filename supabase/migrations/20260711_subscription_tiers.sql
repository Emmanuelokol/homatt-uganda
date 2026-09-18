-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — two-tier subscriptions (Schedule B) + 30-day trial
--
--   basic    — stock & quick sale, alerts, registration & records,
--              consultations, bookings, payments, offline
--   premium  — everything: monthly business reports, follow-up care
--              tools, diagnostic/lab services listing, supply ordering
--              (as it ships)
--
-- Every clinic gets a 30-day free period during which the portal
-- behaves as premium regardless of tier. The tier itself can ONLY be
-- changed by Homatt (service role / SQL editor) — never by clinic
-- staff through the portal.
--
-- Idempotent — safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Columns ─────────────────────────────────────────────────────
alter table public.clinics
  add column if not exists subscription_tier text not null default 'basic',
  add column if not exists trial_ends_at date default (current_date + 30);

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'clinics_subscription_tier_check') then
    alter table public.clinics drop constraint clinics_subscription_tier_check;
  end if;
  alter table public.clinics
    add constraint clinics_subscription_tier_check
    check (subscription_tier in ('basic','premium'));
end $$;

-- Existing clinics (early partners): fresh 30-day free period starting
-- now, so nothing they use today disappears before Homatt assigns tiers.
update public.clinics
  set trial_ends_at = current_date + 30
  where trial_ends_at is null;

-- ── 2. Only Homatt can change the tier / trial ─────────────────────
-- Clinic staff authenticate through PostgREST with role 'authenticated';
-- Homatt uses the service role or the SQL editor (no JWT claims). Block
-- tier changes from any JWT-authenticated request.
create or replace function public.protect_clinic_tier()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
begin
  if (new.subscription_tier is distinct from old.subscription_tier
      or new.trial_ends_at is distinct from old.trial_ends_at)
     and v_role not in ('', 'service_role') then
    raise exception 'Subscription tier can only be changed by Homatt Health';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_clinic_tier on public.clinics;
create trigger trg_protect_clinic_tier
  before update on public.clinics
  for each row execute function public.protect_clinic_tier();

-- Verify
select 'subscription tiers ready' as result;

-- ── 3. Admin portal can manage tiers ────────────────────────────
-- The Homatt admin portal signs in as a normal authenticated user
-- (profiles.is_admin = true), which the protection trigger blocks.
-- This RPC verifies the caller IS a Homatt admin, then flags the
-- transaction so the trigger lets the change through.
create or replace function public.protect_clinic_tier()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
begin
  if (new.subscription_tier is distinct from old.subscription_tier
      or new.trial_ends_at is distinct from old.trial_ends_at)
     and v_role not in ('', 'service_role')
     and coalesce(current_setting('homatt.tier_admin', true), '') <> 'on' then
    raise exception 'Subscription tier can only be changed by Homatt Health';
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_clinic_tier(
  p_clinic_id  uuid,
  p_tier       text,
  p_trial_ends date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tier not in ('basic','premium') then
    return jsonb_build_object('ok', false, 'error', 'invalid tier');
  end if;

  -- Caller must be a Homatt admin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_admin = true
  ) then
    return jsonb_build_object('ok', false, 'error', 'only Homatt admins can change plans');
  end if;

  -- Transaction-local flag the trigger trusts
  perform set_config('homatt.tier_admin', 'on', true);

  update public.clinics
     set subscription_tier = p_tier,
         trial_ends_at     = p_trial_ends,
         updated_at        = now()
   where id = p_clinic_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'clinic not found');
  end if;

  return jsonb_build_object('ok', true, 'clinic_id', p_clinic_id,
                            'tier', p_tier, 'trial_ends', p_trial_ends);
end;
$$;

grant execute on function public.admin_set_clinic_tier(uuid, text, date) to authenticated;
