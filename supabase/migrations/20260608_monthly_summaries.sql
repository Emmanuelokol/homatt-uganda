-- ============================================================
-- Homatt Health — Monthly Financial & Stock Summaries
--
-- Clinicians can view and search end-of-month reports showing:
--   • Financial: billed, collected, outstanding, quick-sale revenue,
--     stock cost, net margin — broken down by payment method
--   • Stock: per-item units used, restocked, closing qty, cost
--
-- The cron job auto-generates the summary on the last day of each
-- month at 22:30 UTC (01:30 EAT next morning). Staff can also
-- trigger regeneration manually via the generate_clinic_monthly_summary() RPC.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── 1. Summary snapshot table ─────────────────────────────
create table if not exists public.clinic_monthly_summaries (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references public.clinics(id) on delete cascade,
  year                  integer not null,
  month                 integer not null check (month between 1 and 12),

  -- Financial
  total_billed_ugx      numeric(14,2) default 0,   -- sum of total_charged_ugx on diagnoses this month
  total_collected_ugx   numeric(14,2) default 0,   -- payments received this month
  quick_sales_ugx       numeric(14,2) default 0,   -- quick-sale counter revenue this month
  total_revenue_ugx     numeric(14,2) default 0,   -- collected + quick_sales
  total_outstanding_ugx numeric(14,2) default 0,   -- open balances at generation time
  stock_cost_ugx        numeric(14,2) default 0,   -- cost of inventory deducted this month
  net_margin_ugx        numeric(14,2) default 0,   -- total_revenue - stock_cost
  total_consultations   integer default 0,
  total_patients        integer default 0,
  payment_methods       jsonb default '{}',        -- {cash: ugx, mobile_money: ugx, …}

  -- Stock snapshot (items active or with transactions this month)
  stock_snapshot        jsonb default '[]',
  -- [{item_id, item_name, item_type, unit, qty_used, qty_added,
  --   closing_qty, unit_cost_ugx, total_cost_ugx}]

  generated_at          timestamptz not null default now(),
  generated_manually    boolean not null default false,

  unique (clinic_id, year, month)
);

comment on table public.clinic_monthly_summaries is
  'Pre-computed end-of-month financial and stock snapshots per clinic.';

create index if not exists idx_monthly_summaries_clinic_period
  on public.clinic_monthly_summaries (clinic_id, year desc, month desc);

alter table public.clinic_monthly_summaries enable row level security;

drop policy if exists "monthly_summaries_read" on public.clinic_monthly_summaries;
create policy "monthly_summaries_read" on public.clinic_monthly_summaries
  for select using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_monthly_summaries.clinic_id
    )
  );

drop policy if exists "monthly_summaries_write" on public.clinic_monthly_summaries;
create policy "monthly_summaries_write" on public.clinic_monthly_summaries
  for all using (
    exists (
      select 1 from public.portal_users pu
      where pu.auth_user_id = auth.uid()
        and pu.is_active = true
        and pu.clinic_id = clinic_monthly_summaries.clinic_id
    )
  );

-- ── 2. Core summary generator ─────────────────────────────
-- Computes and upserts a summary for (p_clinic_id, p_year, p_month).
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
  v_period_start    timestamptz;
  v_period_end      timestamptz;
  v_billed          numeric(14,2) := 0;
  v_consultations   integer       := 0;
  v_patients        integer       := 0;
  v_collected       numeric(14,2) := 0;
  v_qs_revenue      numeric(14,2) := 0;
  v_stock_cost      numeric(14,2) := 0;
  v_outstanding     numeric(14,2) := 0;
  v_payment_methods jsonb         := '{}';
  v_stock_snapshot  jsonb         := '[]';
begin
  -- Calendar month boundaries in EAT → UTC
  v_period_start := (make_date(p_year, p_month, 1)::timestamp
                     at time zone 'Africa/Kampala')
                    at time zone 'UTC';
  v_period_end   := v_period_start + interval '1 month';

  -- Diagnoses created this month
  select
    coalesce(sum(d.total_charged_ugx), 0),
    count(*)::integer,
    count(distinct coalesce(d.patient_phone, d.patient_name))::integer
  into v_billed, v_consultations, v_patients
  from public.clinic_diagnoses d
  where d.clinic_id = p_clinic_id
    and d.created_at >= v_period_start
    and d.created_at <  v_period_end;

  -- Payments received this month
  select coalesce(sum(amount_ugx), 0)
  into v_collected
  from public.clinic_payments
  where clinic_id = p_clinic_id
    and created_at >= v_period_start
    and created_at <  v_period_end;

  -- Payment method breakdown
  select coalesce(jsonb_object_agg(method, method_total), '{}')
  into v_payment_methods
  from (
    select method, sum(amount_ugx) as method_total
    from public.clinic_payments
    where clinic_id = p_clinic_id
      and created_at >= v_period_start
      and created_at <  v_period_end
    group by method
  ) pm;

  -- Quick-sale counter revenue this month
  select coalesce(sum(total_ugx), 0)
  into v_qs_revenue
  from public.clinic_quick_sales
  where clinic_id = p_clinic_id
    and created_at >= v_period_start
    and created_at <  v_period_end;

  -- Stock cost from deductions this month
  select coalesce(
    sum(-t.quantity_change * coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0)),
    0
  )
  into v_stock_cost
  from public.clinic_inventory_txns t
  join public.clinic_inventory i on i.id = t.inventory_id
  where t.clinic_id = p_clinic_id
    and t.txn_type = 'deduction'
    and t.created_at >= v_period_start
    and t.created_at <  v_period_end;

  -- Outstanding balances (snapshot at generation time, all-time open)
  select coalesce(
    sum(greatest(0, coalesce(total_charged_ugx, 0) - coalesce(amount_paid, 0))),
    0
  )
  into v_outstanding
  from public.clinic_diagnoses
  where clinic_id = p_clinic_id
    and payment_status in ('pending', 'partial', 'credit');

  -- Per-item stock snapshot for items active this month
  select coalesce(
    jsonb_agg(row_data order by row_data->>'item_name'),
    '[]'::jsonb
  )
  into v_stock_snapshot
  from (
    select jsonb_build_object(
      'item_id',        i.id,
      'item_name',      i.item_name,
      'item_type',      i.item_type,
      'unit',           i.unit,
      'qty_used',       coalesce(sum(-t.quantity_change) filter (where t.txn_type = 'deduction'), 0),
      'qty_added',      coalesce(sum( t.quantity_change) filter (where t.txn_type in ('addition','adjustment') and t.quantity_change > 0), 0),
      'closing_qty',    i.quantity,
      'unit_cost_ugx',  coalesce(i.unit_cost_ugx, 0),
      'total_cost_ugx', coalesce(sum(-t.quantity_change * coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0)) filter (where t.txn_type = 'deduction'), 0)
    ) as row_data
    from public.clinic_inventory i
    left join public.clinic_inventory_txns t
           on t.inventory_id = i.id
          and t.created_at >= v_period_start
          and t.created_at <  v_period_end
    where i.clinic_id = p_clinic_id
      and i.is_active = true
    group by i.id, i.item_name, i.item_type, i.unit, i.quantity, i.unit_cost_ugx
    having coalesce(sum(abs(t.quantity_change)), 0) > 0  -- had activity
        or i.quantity > 0                                -- or still in stock
  ) agg;

  -- Upsert the snapshot
  insert into public.clinic_monthly_summaries (
    clinic_id, year, month,
    total_billed_ugx, total_collected_ugx, quick_sales_ugx, total_revenue_ugx,
    total_outstanding_ugx, stock_cost_ugx, net_margin_ugx,
    total_consultations, total_patients, payment_methods,
    stock_snapshot, generated_at, generated_manually
  ) values (
    p_clinic_id, p_year, p_month,
    v_billed, v_collected, v_qs_revenue, v_collected + v_qs_revenue,
    v_outstanding, v_stock_cost, (v_collected + v_qs_revenue) - v_stock_cost,
    v_consultations, v_patients, v_payment_methods,
    v_stock_snapshot, now(), p_manual
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

  return jsonb_build_object(
    'ok',            true,
    'clinic_id',     p_clinic_id,
    'year',          p_year,
    'month',         p_month,
    'total_revenue', v_collected + v_qs_revenue,
    'consultations', v_consultations
  );
end;
$$;

grant execute on function public.generate_clinic_monthly_summary(uuid, integer, integer, boolean) to authenticated;

-- ── 3. Cron: auto-generate on last day of every month ────
-- Runs daily at 22:30 UTC (01:30 EAT). On the last calendar day of
-- the month, it generates summaries for every active clinic.
create or replace function public.cron_generate_monthly_summaries()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date    := (now() at time zone 'Africa/Kampala')::date;
  v_year     integer := extract(year  from v_today)::integer;
  v_month    integer := extract(month from v_today)::integer;
  v_clinic   record;
begin
  -- Only fire on the last day of the month (tomorrow is day 1)
  if extract(day from v_today + 1) <> 1 then
    return;
  end if;

  for v_clinic in
    select id from public.clinics where is_active = true
  loop
    begin
      perform public.generate_clinic_monthly_summary(v_clinic.id, v_year, v_month, false);
    exception when others then
      null; -- never let one clinic's failure block the others
    end;
  end loop;
end;
$$;

-- Schedule (idempotent — unschedule first if it already exists)
do $$
begin
  perform cron.unschedule('monthly-summaries-generate');
exception when others then null;
end $$;

select cron.schedule(
  'monthly-summaries-generate',
  '30 22 28-31 * *',          -- daily 22:30 UTC = 01:30 EAT, on days 28–31 only
  'select cron_generate_monthly_summaries()'
);
