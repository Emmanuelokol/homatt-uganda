-- Enough of Supabase to run a migration against a real Postgres.
--
-- The clinician portal's whole security model is written in SQL — RLS
-- policies, security-definer RPCs, a trigger. None of that can be checked by
-- reading it, and none of it can be checked from the browser tests, which mock
-- the network and never reach a database at all. So the migration is applied to
-- an actual Postgres here and then driven: sign somebody up, make a code, scan
-- it, treat a patient, read the log back, and check that the row that travels
-- carries no patient in it.
--
-- What this stands in for: auth.users, auth.uid(), the authenticated/anon
-- roles, and the extensions schema. Everything else is the project's own
-- migrations, run in order.

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon_user') then create role anon_user login; end if;
end $$;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, recovery_token text,
  email_change text, email_change_token_new text, email_change_token_current text
);
create table if not exists auth.identities (
  id uuid primary key, user_id uuid, provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- auth.uid() reads a session GUC, exactly as Supabase's does. The tests set it
-- to switch identity, which is the only way to exercise an RLS policy honestly.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant all on all tables in schema auth to authenticated, service_role;

-- Become this user for the statements that follow.
create or replace function test_as(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
end $$;
