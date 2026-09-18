-- ════════════════════════════════════════════════════════════════════
--  HOMATT — APPLY THIS ONCE IN THE SUPABASE SQL EDITOR
--  (Dashboard → SQL Editor → New query → paste ALL of this → Run)
--
--  This creates the Monthly Reports table + function. It is the same SQL
--  as the migrations, consolidated into one file so it can be applied by
--  hand when the GitHub auto-deploy is not running.
--
--  Safe to run multiple times (idempotent).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────
create table if not exists public.clinic_monthly_summaries (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references public.clinics(id) on delete cascade,
  year                  integer not null,
  month                 integer not null check (month between 1 and 12),
  total_billed_ugx      numeric(14,2) default 0,
  total_collected_ugx   numeric(14,2) default 0,
  quick_sales_ugx       numeric(14,2) default 0,
  total_revenue_ugx     numeric(14,2) default 0,
  total_outstanding_ugx numeric(14,2) default 0,
  stock_cost_ugx        numeric(14,2) default 0,
  net_margin_ugx        numeric(14,2) default 0,
  total_consultations   integer default 0,
  total_patients        integer default 0,
  payment_methods       jsonb default '{}',
  stock_snapshot        jsonb default '[]',
  generated_at          timestamptz not null default now(),
  generated_manually    boolean not null default false,
  unique (clinic_id, year, month)
);

create index if not exists idx_monthly_summaries_clinic_period
  on public.clinic_monthly_summaries (clinic_id, year desc, month desc);

alter table public.clinic_monthly_summaries enable row level security;

drop policy if exists "monthly_summaries_read" on public.clinic_monthly_summaries;
create policy "monthly_summaries_read" on public.clinic_monthly_summaries
  for select using (
    exists (select 1 from public.portal_users pu
            where pu.auth_user_id = auth.uid()
              and pu.is_active = true
              and pu.clinic_id = clinic_monthly_summaries.clinic_id));

drop policy if exists "monthly_summaries_write" on public.clinic_monthly_summaries;
create policy "monthly_summaries_write" on public.clinic_monthly_summaries
  for all using (
    exists (select 1 from public.portal_users pu
            where pu.auth_user_id = auth.uid()
              and pu.is_active = true
              and pu.clinic_id = clinic_monthly_summaries.clinic_id));

-- ── 2. Generator function ────────────────────────────────────────────
create or replace function public.generate_clinic_monthly_summary(
  p_clinic_id uuid,
  p_year      integer,
  p_month     integer,
  p_manual    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start         timestamptz;
  v_end           timestamptz;
  v_billed        numeric(14,2) := 0;
  v_consultations integer       := 0;
  v_patients      integer       := 0;
  v_collected     numeric(14,2) := 0;
  v_qs            numeric(14,2) := 0;
  v_stock_cost    numeric(14,2) := 0;
  v_outstanding   numeric(14,2) := 0;
  v_methods       jsonb         := '{}';
  v_snapshot      jsonb         := '[]';
begin
  v_start := (make_date(p_year, p_month, 1)::timestamp at time zone 'Africa/Kampala')
             at time zone 'UTC';
  v_end   := v_start + interval '1 month';

  select coalesce(sum(d.total_charged_ugx), 0),
         count(*)::integer,
         count(distinct coalesce(d.patient_phone, d.patient_name))::integer
    into v_billed, v_consultations, v_patients
  from public.clinic_diagnoses d
  where d.clinic_id = p_clinic_id
    and d.created_at >= v_start and d.created_at < v_end;

  select coalesce(sum(amount_ugx), 0) into v_collected
  from public.clinic_payments
  where clinic_id = p_clinic_id
    and created_at >= v_start and created_at < v_end;

  select coalesce(jsonb_object_agg(method, total), '{}') into v_methods
  from (select method, sum(amount_ugx) as total
        from public.clinic_payments
        where clinic_id = p_clinic_id
          and created_at >= v_start and created_at < v_end
        group by method) t;

  select coalesce(sum(total_ugx), 0) into v_qs
  from public.clinic_quick_sales
  where clinic_id = p_clinic_id
    and created_at >= v_start and created_at < v_end;

  select coalesce(sum(-t.quantity_change * coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0)), 0)
    into v_stock_cost
  from public.clinic_inventory_txns t
  join public.clinic_inventory i on i.id = t.inventory_id
  where t.clinic_id = p_clinic_id and t.txn_type = 'deduction'
    and t.created_at >= v_start and t.created_at < v_end;

  select coalesce(sum(greatest(0, coalesce(total_charged_ugx,0) - coalesce(amount_paid,0))), 0)
    into v_outstanding
  from public.clinic_diagnoses
  where clinic_id = p_clinic_id
    and payment_status in ('pending','partial','credit');

  select coalesce(jsonb_agg(row_data order by row_data->>'item_name'), '[]') into v_snapshot
  from (
    select jsonb_build_object(
      'item_id', i.id, 'item_name', i.item_name, 'item_type', i.item_type, 'unit', i.unit,
      'qty_used',  coalesce(sum(-t.quantity_change) filter (where t.txn_type='deduction'),0),
      'qty_added', coalesce(sum(t.quantity_change) filter (where t.txn_type in ('addition','adjustment') and t.quantity_change>0),0),
      'closing_qty', i.quantity,
      'unit_cost_ugx', coalesce(i.unit_cost_ugx,0),
      'total_cost_ugx', coalesce(sum(-t.quantity_change*coalesce(t.unit_cost_ugx,i.unit_cost_ugx,0)) filter (where t.txn_type='deduction'),0)
    ) as row_data
    from public.clinic_inventory i
    left join public.clinic_inventory_txns t
           on t.inventory_id = i.id and t.created_at >= v_start and t.created_at < v_end
    where i.clinic_id = p_clinic_id and i.is_active = true
    group by i.id, i.item_name, i.item_type, i.unit, i.quantity, i.unit_cost_ugx
    having coalesce(sum(abs(t.quantity_change)),0) > 0 or i.quantity > 0
  ) agg;

  insert into public.clinic_monthly_summaries (
    clinic_id, year, month,
    total_billed_ugx, total_collected_ugx, quick_sales_ugx, total_revenue_ugx,
    total_outstanding_ugx, stock_cost_ugx, net_margin_ugx,
    total_consultations, total_patients, payment_methods, stock_snapshot,
    generated_at, generated_manually
  ) values (
    p_clinic_id, p_year, p_month,
    v_billed, v_collected, v_qs, v_collected + v_qs,
    v_outstanding, v_stock_cost, (v_collected + v_qs) - v_stock_cost,
    v_consultations, v_patients, v_methods, v_snapshot,
    now(), p_manual
  )
  on conflict (clinic_id, year, month) do update set
    total_billed_ugx      = excluded.total_billed_ugx,
    total_collected_ugx   = excluded.total_collected_ugx,
    quick_sales_ugx       = excluded.quick_sales_ugx,
    total_revenue_ugx     = excluded.total_revenue_ugx,
    total_outstanding_ugx = excluded.total_outstanding_ugx,
    stock_cost_ugx        = excluded.stock_cost_ugx,
    net_margin_ugx        = excluded.net_margin_ugx,
    total_consultations   = excluded.total_consultations,
    total_patients        = excluded.total_patients,
    payment_methods       = excluded.payment_methods,
    stock_snapshot        = excluded.stock_snapshot,
    generated_at          = excluded.generated_at,
    generated_manually    = excluded.generated_manually;

  return jsonb_build_object('ok', true, 'clinic_id', p_clinic_id,
    'year', p_year, 'month', p_month,
    'total_revenue', v_collected + v_qs, 'consultations', v_consultations);
end;
$$;

grant execute on function
  public.generate_clinic_monthly_summary(uuid, integer, integer, boolean)
  to authenticated;

-- ── 3. Tell PostgREST to refresh (works in SQL Editor — direct connection) ──
notify pgrst, 'reload schema';

-- ── 4. Verify it worked — should return one row ──────────────────────
select 'SUCCESS: function created' as result
from pg_proc where proname = 'generate_clinic_monthly_summary';
