-- ════════════════════════════════════════════════════════════════════
-- Homatt Health — create staff logins straight from the database
--
-- The portal's "Add staff account" used to rely ONLY on the
-- create-staff edge function, which needs a separate deploy step that
-- kept failing to happen. This RPC does the same job natively in
-- Postgres, so applying migrations is enough for the button to work.
-- The edge function remains as a fallback route.
--
-- Security model (same as the edge function):
--   • caller's JWT must belong to an ACTIVE clinic staff row with
--     staff_role = 'owner' — checked inside the function
--   • the new account is ALWAYS attached to the caller's clinic
--
-- Idempotent — safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

create or replace function public.create_staff_account(
  p_full_name text,
  p_email     text,
  p_password  text,
  p_role      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
  v_is_owner  boolean;
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_name      text := trim(coalesce(p_full_name, ''));
  v_uid       uuid := gen_random_uuid();
begin
  -- ── Validate input ──────────────────────────────────────────────
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'Full name is required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid email address');
  end if;
  if length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters');
  end if;
  if p_role not in ('owner','clinician','nurse','receptionist','salesperson') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role');
  end if;

  -- ── Caller must be an ACTIVE OWNER of a clinic ──────────────────
  select pu.clinic_id, (coalesce(pu.staff_role, 'owner') = 'owner')
    into v_clinic_id, v_is_owner
    from public.portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;

  if v_clinic_id is null or coalesce(v_is_owner, false) = false then
    return jsonb_build_object('ok', false, 'error', 'Only the clinic owner can create staff accounts');
  end if;

  -- ── Email must be free ──────────────────────────────────────────
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'An account with this email already exists');
  end if;

  -- ── Create the login (email pre-confirmed: staff sign in at once) ─
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name),
    now(), now(),
    '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  -- ── Link it to the caller's clinic with the chosen role ─────────
  insert into public.portal_users (
    auth_user_id, full_name, email, role, clinic_id, staff_role, is_active
  ) values (
    v_uid, v_name, v_email, 'clinic_staff', v_clinic_id, p_role, true
  );

  return jsonb_build_object('ok', true, 'email', v_email, 'staff_role', p_role);

exception when others then
  return jsonb_build_object('ok', false, 'error', 'Could not create the account: ' || sqlerrm);
end;
$$;

grant execute on function public.create_staff_account(text, text, text, text) to authenticated;

-- Verify
select proname from pg_proc where proname = 'create_staff_account';
