-- ── Fix: the RECEIVING clinic could never update a referral ────────────────
-- The original policy (20260718) was:
--     for all using (from_clinic OR to_clinic)
--     with check (from_clinic_id in (my clinics))
-- WITH CHECK is applied to the NEW row on UPDATE, and a received referral's
-- from_clinic_id belongs to the SENDER — so every status change made by the
-- receiving clinic ("Mark received", "Patient attended") was rejected by RLS.
-- The receiving clinic's screen updated optimistically, but the database never
-- changed, so the sending clinic kept seeing "Waiting for them" forever.
--
-- This migration:
--   1. replaces that policy with per-command policies so BOTH clinics can
--      update a referral they are party to (insert still restricted to the
--      sender), and
--   2. adds set_referral_status() — a security-definer RPC the app calls first,
--      so status changes work even on databases whose policies are stale.

alter table public.clinic_referrals enable row level security;

do $$
begin
  -- Out with the broken combined policy.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'clinic_referrals'
                and policyname = 'referral_clinics_rw') then
    drop policy referral_clinics_rw on public.clinic_referrals;
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'clinic_referrals'
                    and policyname = 'referral_select_parties') then
    create policy referral_select_parties on public.clinic_referrals
      for select using (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
        or to_clinic_id in (select pu.clinic_id from public.portal_users pu
                             where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;

  -- Only the sending clinic may create a referral.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'clinic_referrals'
                    and policyname = 'referral_insert_sender') then
    create policy referral_insert_sender on public.clinic_referrals
      for insert with check (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;

  -- EITHER clinic may update a referral they are party to (this is the fix).
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'clinic_referrals'
                    and policyname = 'referral_update_parties') then
    create policy referral_update_parties on public.clinic_referrals
      for update using (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
        or to_clinic_id in (select pu.clinic_id from public.portal_users pu
                             where pu.auth_user_id = auth.uid() and pu.is_active = true)
      ) with check (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
        or to_clinic_id in (select pu.clinic_id from public.portal_users pu
                             where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;

  -- Only the sender may delete their own referral.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'clinic_referrals'
                    and policyname = 'referral_delete_sender') then
    create policy referral_delete_sender on public.clinic_referrals
      for delete using (
        from_clinic_id in (select pu.clinic_id from public.portal_users pu
                            where pu.auth_user_id = auth.uid() and pu.is_active = true)
      );
  end if;
end $$;

-- Belt and braces: the app calls this first, so a status change lands even if
-- the policies above are missing/stale on a given deployment. Verifies the
-- caller is active staff of one of the two clinics on the referral.
create or replace function public.set_referral_status(p_referral_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r_from uuid;
  r_to   uuid;
  allowed boolean;
begin
  if p_status is null or p_status not in ('pending','received','seen','cancelled') then
    return jsonb_build_object('ok', false, 'error', 'invalid status');
  end if;

  select from_clinic_id, to_clinic_id into r_from, r_to
    from clinic_referrals where id = p_referral_id;
  if r_to is null and r_from is null then
    return jsonb_build_object('ok', false, 'error', 'referral not found');
  end if;

  select exists (
    select 1 from portal_users pu
     where pu.auth_user_id = auth.uid()
       and pu.is_active = true
       and pu.clinic_id in (r_from, r_to)
  ) into allowed;
  if not allowed then
    return jsonb_build_object('ok', false, 'error', 'not a party to this referral');
  end if;

  update clinic_referrals set status = p_status where id = p_referral_id;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

grant execute on function public.set_referral_status(uuid, text) to authenticated;
