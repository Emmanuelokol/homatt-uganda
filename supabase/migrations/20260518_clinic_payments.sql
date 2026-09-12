-- ════════════════════════════════════════════════════════════════════
-- Clinic Payments & Installments
-- ────────────────────────────────────────────────────────────────────
-- Adds running-balance tracking to clinic_diagnoses + a per-payment log
-- so clinics can take installments and always see what's outstanding.
--
-- Tables / Columns:
--   clinic_diagnoses.amount_paid   — running total of all payments
--   clinic_payments                — log of every installment received
--
-- RPCs:
--   record_payment        — adds a payment, updates totals + status
--   get_pending_payments  — returns all diagnoses with balance > 0
--
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Running paid-total on the diagnosis ──────────────────────
alter table public.clinic_diagnoses
  add column if not exists amount_paid numeric default 0;

update public.clinic_diagnoses
   set amount_paid = total_charged_ugx
 where payment_status = 'paid' and (amount_paid is null or amount_paid = 0);

update public.clinic_diagnoses set amount_paid = 0 where amount_paid is null;

comment on column public.clinic_diagnoses.amount_paid is
  'Running total of payments received so far. balance = total_charged_ugx - amount_paid';

-- Update payment_status check to add 'partial' for installments
do $$
begin
  -- Drop the old check constraint if it exists
  if exists (
    select 1 from pg_constraint
    where conname = 'clinic_diagnoses_payment_status_check'
  ) then
    alter table public.clinic_diagnoses drop constraint clinic_diagnoses_payment_status_check;
  end if;

  -- Recreate with 'partial' allowed
  alter table public.clinic_diagnoses
    add constraint clinic_diagnoses_payment_status_check
    check (payment_status in ('paid','pending','partial','credit','waived'));
end $$;

create index if not exists idx_clinic_diagnoses_balance
  on public.clinic_diagnoses (clinic_id, payment_status)
  where payment_status in ('pending','partial','credit');

-- ── 2. Payment log ──────────────────────────────────────────────
create table if not exists public.clinic_payments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  diagnosis_id    uuid not null references public.clinic_diagnoses(id) on delete cascade,
  booking_id      uuid references public.bookings(id),
  amount_ugx      numeric(12,2) not null check (amount_ugx > 0),
  method          text not null check (method in ('cash','mobile_money','bank','card','insurance','other')),
  reference       text,                       -- e.g. MTN MoMo txn ID
  notes           text,
  collected_by    uuid references auth.users(id),
  created_at      timestamptz default now()
);

create index if not exists idx_clinic_payments_clinic_date
  on public.clinic_payments (clinic_id, created_at desc);
create index if not exists idx_clinic_payments_diagnosis
  on public.clinic_payments (diagnosis_id, created_at desc);

alter table public.clinic_payments enable row level security;

drop policy if exists "clinic_payments_read"  on public.clinic_payments;
create policy "clinic_payments_read" on public.clinic_payments
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_payments.clinic_id
    )
  );

drop policy if exists "clinic_payments_insert" on public.clinic_payments;
create policy "clinic_payments_insert" on public.clinic_payments
  for insert with check (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_payments.clinic_id
    )
  );

-- ── 3. RPC: record_payment ──────────────────────────────────────
-- Records a payment installment for a diagnosis.
-- Returns: { ok, amount_paid, balance, payment_status, fully_paid }
create or replace function public.record_payment(
  p_diagnosis_id uuid,
  p_amount       numeric,
  p_method       text,
  p_reference    text default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dx          public.clinic_diagnoses%rowtype;
  v_new_paid    numeric;
  v_total       numeric;
  v_balance     numeric;
  v_new_status  text;
  v_fully_paid  boolean;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount must be greater than 0');
  end if;

  if p_method is null or p_method = '' then
    p_method := 'cash';
  end if;

  select * into v_dx
  from public.clinic_diagnoses
  where id = p_diagnosis_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'diagnosis not found');
  end if;

  v_total    := coalesce(v_dx.total_charged_ugx, 0);
  v_new_paid := coalesce(v_dx.amount_paid, 0) + p_amount;
  v_balance  := greatest(0, v_total - v_new_paid);

  -- Decide new payment status
  if v_total > 0 and v_new_paid >= v_total then
    v_new_status := 'paid';
    v_fully_paid := true;
  elsif v_new_paid > 0 then
    v_new_status := 'partial';
    v_fully_paid := false;
  else
    v_new_status := coalesce(v_dx.payment_status, 'pending');
    v_fully_paid := false;
  end if;

  -- Insert payment record
  insert into public.clinic_payments
    (clinic_id, diagnosis_id, booking_id, amount_ugx, method, reference, notes, collected_by)
  values
    (v_dx.clinic_id, v_dx.id, v_dx.booking_id, p_amount, p_method, p_reference, p_notes, auth.uid());

  -- Update diagnosis totals
  update public.clinic_diagnoses
     set amount_paid    = v_new_paid,
         payment_status = v_new_status
   where id = v_dx.id;

  return jsonb_build_object(
    'ok',             true,
    'diagnosis_id',   v_dx.id,
    'clinic_id',      v_dx.clinic_id,
    'booking_id',     v_dx.booking_id,
    'amount_paid',    v_new_paid,
    'amount_received', p_amount,
    'total_charged',  v_total,
    'balance',        v_balance,
    'payment_status', v_new_status,
    'fully_paid',     v_fully_paid
  );
end;
$$;

grant execute on function public.record_payment(uuid, numeric, text, text, text) to authenticated;

-- ── 4. RPC: get_pending_payments ────────────────────────────────
-- Returns diagnoses with an outstanding balance, newest first.
create or replace function public.get_pending_payments(p_clinic_id uuid)
returns table (
  id              uuid,
  patient_name    text,
  patient_phone   text,
  confirmed_diagnosis text,
  total_charged_ugx numeric,
  amount_paid     numeric,
  balance_ugx     numeric,
  payment_status  text,
  created_at      timestamptz,
  last_payment_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.patient_name,
    d.patient_phone,
    d.confirmed_diagnosis,
    coalesce(d.total_charged_ugx, 0)                                     as total_charged_ugx,
    coalesce(d.amount_paid, 0)                                           as amount_paid,
    greatest(0, coalesce(d.total_charged_ugx,0) - coalesce(d.amount_paid,0)) as balance_ugx,
    coalesce(d.payment_status, 'pending')                                as payment_status,
    d.created_at,
    (select max(p.created_at) from public.clinic_payments p where p.diagnosis_id = d.id) as last_payment_at
  from public.clinic_diagnoses d
  where d.clinic_id = p_clinic_id
    and coalesce(d.total_charged_ugx, 0) > coalesce(d.amount_paid, 0)
    and coalesce(d.payment_status, 'pending') in ('pending','partial','credit')
  order by d.created_at desc;
$$;

grant execute on function public.get_pending_payments(uuid) to authenticated;
