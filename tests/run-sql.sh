#!/usr/bin/env bash
# The SQL tests.
#
# The browser tests mock the network and never reach a database, so nothing
# they do can check an RLS policy, a security-definer RPC or a trigger. The
# clinician portal's entire security model is exactly those three things. So
# this starts a real Postgres, applies the real migrations to it, and drives
# them: sign up, make a code, scan it, treat somebody, end the job, rate them,
# and check that what travels to the next clinic carries no patient in it.
#
#   ./tests/run-sql.sh
#
# Needs postgresql (any version with initdb). Leaves nothing behind.

set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "no postgres found (set PGBIN)"; exit 1; }

PGDATA="${PGDATA:-/tmp/homatt-pgdata-$$}"
PGSOCK="${PGSOCK:-/tmp/homatt-pg-$$}"
PGPORT="${PGPORT:-55432}"
DB=homatt_sqltest
PSQL="psql -h $PGSOCK -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || \
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGDATA" "$PGSOCK"
}
trap cleanup EXIT

mkdir -p "$PGSOCK"
rm -rf "$PGDATA"; mkdir -p "$PGDATA"

# Postgres refuses to run as root, so when we are root it runs as postgres.
AS=""
if [ "$(id -u)" = "0" ]; then
  AS="su postgres -c"
  chown -R postgres "$PGDATA" "$PGSOCK"
fi
run() { if [ -n "$AS" ]; then su postgres -c "$1"; else eval "$1"; fi; }

run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null 2>&1
run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK -c listen_addresses=' -l $PGDATA/log start" >/dev/null 2>&1

for _ in $(seq 1 30); do
  psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done

$PSQL -c "drop database if exists $DB" >/dev/null
$PSQL -c "create database $DB" >/dev/null

$PSQL -d $DB -f tests/sql/harness.sql >/dev/null

# The migrations this feature sits on top of, in order. Not the whole folder:
# several older migrations depend on state no fresh database has, and a failure
# there would say nothing about the code under test.
for m in \
  20260308_homatt_full_schema.sql \
  20260608_staff_roles.sql \
  20260429_clinic_diagnoses_patient_name.sql \
  20260824_case_code.sql
do
  $PSQL -d $DB -f "supabase/migrations/$m" >/dev/null 2>&1 || {
    echo "could not apply $m"; exit 1; }
done

# Columns added by migrations outside the list above, which this feature reads.
# (20260518_clinic_payments.sql is deliberately not in the list: on a fresh
# database it fails on a payment_status column an earlier migration adds, which
# is a pre-existing ordering dependency in this repo and nothing to do with the
# code under test.)
$PSQL -d $DB -c "alter table clinic_diagnoses
  add column if not exists clinician_name text,
  add column if not exists patient_phone text,
  add column if not exists payment_status text,
  add column if not exists total_charged_ugx numeric,
  add column if not exists amount_paid numeric;" >/dev/null

# The tables the corrections migration builds on, defined here rather than by
# applying their own migrations.
#
# 20260428_clinic_patients.sql ends with a policy that references
# clinic_orders, and 20260516_clinic_inventory.sql and 20260528_quick_sale.sql
# sit on state a fresh database does not have — the same pre-existing ordering
# dependency this file already documents for 20260518_clinic_payments.sql. The
# shapes below are copied from those migrations; the migration under test
# replaces their policies and functions anyway, and what the test checks is the
# END state, which is what a clinic actually runs.
$PSQL -d $DB -c "
create table if not exists public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  full_name text not null, phone text not null,
  profile_id uuid, registered_by uuid, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint clinic_patients_clinic_phone_unique unique (clinic_id, phone));
alter table public.clinic_patients enable row level security;

create table if not exists public.clinic_inventory (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  item_name text not null, item_type text, unit text,
  quantity numeric default 0, min_threshold numeric default 0,
  reorder_level numeric default 0, unit_cost_ugx numeric,
  selling_price_ugx numeric, is_active boolean default true,
  updated_at timestamptz default now());
alter table public.clinic_inventory enable row level security;

create table if not exists public.clinic_inventory_txns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid, inventory_id uuid, txn_type text,
  quantity_change numeric, quantity_after numeric, unit_cost_ugx numeric,
  notes text, created_by uuid, created_at timestamptz default now());
alter table public.clinic_inventory_txns enable row level security;

create table if not exists public.clinic_quick_sales (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  drug_id uuid references public.clinic_inventory(id),
  drug_name text not null, unit text default 'unit',
  quantity integer not null default 1,
  unit_price_ugx numeric(12,2) not null default 0,
  total_ugx numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  sold_by uuid, created_at timestamptz default now());
alter table public.clinic_quick_sales enable row level security;
" >/dev/null
$PSQL -d $DB -c "alter table clinic_diagnoses
  add column if not exists consultation_fee_ugx numeric default 0,
  add column if not exists lab_fee_ugx numeric default 0,
  add column if not exists meds_fee_ugx numeric default 0,
  add column if not exists treatment_plan text;" >/dev/null 2>&1 || true

# ── the migrations under test ──
for m in 20260911_clinician_portal.sql 20260912_owner_corrections.sql; do
  $PSQL -d $DB -f "supabase/migrations/$m" >/dev/null
  # applied twice on purpose: every migration in this project claims to be
  # idempotent and a second run is the only thing that checks it
  $PSQL -d $DB -f "supabase/migrations/$m" >/dev/null
done
echo "PASS  both migrations apply, and apply again without complaint"

# Supabase grants these by default on everything in public; the harness has to
# do it by hand or every RLS check below fails as a permission error instead.
$PSQL -d $DB -c "
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
  grant execute on all functions in schema public to anon, authenticated;" >/dev/null

set +e
: > /tmp/homatt-sql-out.txt
for t in tests/sql/test-clinician-portal.sql tests/sql/test-owner-corrections.sql; do
  psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d $DB -q -f "$t" 2>&1 \
    | sed -e 's/^psql:[^ ]*[0-9]: //' -e 's/^NOTICE:  //' \
    | grep -E '^(PASS|FAIL|ERROR|---)' \
    >> /tmp/homatt-sql-out.txt
done
set -e
cat /tmp/homatt-sql-out.txt

echo
P=$(grep -c '^PASS' /tmp/homatt-sql-out.txt || true)
F=$(grep -c '^FAIL' /tmp/homatt-sql-out.txt || true)
E=$(grep -c '^ERROR' /tmp/homatt-sql-out.txt || true)
echo "SQL: $((P+1)) passed, $F failed, $E errors"
[ "$F" = "0" ] && [ "$E" = "0" ]
