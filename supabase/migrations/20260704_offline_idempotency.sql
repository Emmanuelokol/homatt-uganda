-- ════════════════════════════════════════════════════════════════════
-- Offline write idempotency
-- ────────────────────────────────────────────────────────────────────
-- Writes made offline are queued on the device and replayed when the
-- connection returns. On a slow link a replay can be sent, applied on the
-- server, and then time out before the ack arrives — the device retries and
-- would apply it twice (double payment / double restock).
--
-- Fix: a per-op idempotency ledger. Each replayable write carries a
-- client-generated op_id. New 6-arg overloads of record_payment and
-- adjust_inventory record that op_id in the SAME transaction as the write, so
-- a retry finds it and returns the first result instead of applying again.
--
-- The original 5-arg functions are kept unchanged, so existing callers and
-- any device still on old code keep working. Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Idempotency ledger ───────────────────────────────────────
create table if not exists public.clinic_op_log (
  op_id       uuid primary key,
  op_type     text,
  result      jsonb,
  applied_at  timestamptz default now()
);

alter table public.clinic_op_log enable row level security;

drop policy if exists "clinic_op_log_rw" on public.clinic_op_log;
create policy "clinic_op_log_rw" on public.clinic_op_log
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

grant select, insert on public.clinic_op_log to authenticated;

-- ── 2. record_payment — idempotent overload (6 args) ────────────
-- Delegates to the original 5-arg record_payment, then logs the op_id. If the
-- op_id was already applied, returns the stored result without re-charging.
create or replace function public.record_payment(
  p_diagnosis_id uuid,
  p_amount       numeric,
  p_method       text,
  p_reference    text,
  p_notes        text,
  p_op_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev jsonb;
  v_res  jsonb;
begin
  if p_op_id is not null then
    select result into v_prev from public.clinic_op_log where op_id = p_op_id;
    if found then
      return coalesce(v_prev, jsonb_build_object('ok', true, 'duplicate', true));
    end if;
  end if;

  -- 5-arg original (resolved by arity) does the real work in this transaction.
  v_res := public.record_payment(p_diagnosis_id, p_amount, p_method, p_reference, p_notes);

  if p_op_id is not null and coalesce((v_res->>'ok')::boolean, false) then
    insert into public.clinic_op_log(op_id, op_type, result)
    values (p_op_id, 'payment', v_res)
    on conflict (op_id) do nothing;
  end if;

  return v_res;
end;
$$;

grant execute on function public.record_payment(uuid, numeric, text, text, text, uuid) to authenticated;

-- ── 3. adjust_inventory — idempotent overload (6 args) ──────────
create or replace function public.adjust_inventory(
  p_clinic_id    uuid,
  p_inventory_id uuid,
  p_qty_change   numeric,
  p_txn_type     text,
  p_notes        text,
  p_op_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev jsonb;
  v_res  jsonb;
begin
  if p_op_id is not null then
    select result into v_prev from public.clinic_op_log where op_id = p_op_id;
    if found then
      return coalesce(v_prev, jsonb_build_object('ok', true, 'duplicate', true));
    end if;
  end if;

  v_res := public.adjust_inventory(p_clinic_id, p_inventory_id, p_qty_change, p_txn_type, p_notes);

  if p_op_id is not null and coalesce((v_res->>'ok')::boolean, false) then
    insert into public.clinic_op_log(op_id, op_type, result)
    values (p_op_id, 'inventory', v_res)
    on conflict (op_id) do nothing;
  end if;

  return v_res;
end;
$$;

grant execute on function public.adjust_inventory(uuid, uuid, numeric, text, text, uuid) to authenticated;
