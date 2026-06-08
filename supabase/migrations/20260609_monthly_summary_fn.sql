-- Patch: create the generate_clinic_monthly_summary RPC.
-- This is a standalone migration that ONLY creates the function so it
-- can never be rolled back by unrelated cron / NOTIFY failures.
-- The clinic_monthly_summaries table was already created by 20260608_monthly_summaries.sql.

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

  -- Billed, consultations, patients this month
  select
    coalesce(sum(d.total_charged_ugx), 0),
    count(*)::integer,
    count(distinct coalesce(d.patient_phone, d.patient_name))::integer
  into v_billed, v_consultations, v_patients
  from public.clinic_diagnoses d
  where d.clinic_id = p_clinic_id
    and d.created_at >= v_start
    and d.created_at <  v_end;

  -- Payments collected this month
  select coalesce(sum(amount_ugx), 0)
  into v_collected
  from public.clinic_payments
  where clinic_id = p_clinic_id
    and created_at >= v_start
    and created_at <  v_end;

  -- Breakdown by payment method
  select coalesce(jsonb_object_agg(method, total), '{}')
  into v_methods
  from (
    select method, sum(amount_ugx) as total
    from public.clinic_payments
    where clinic_id = p_clinic_id
      and created_at >= v_start
      and created_at <  v_end
    group by method
  ) t;

  -- Quick-sale counter revenue this month
  select coalesce(sum(total_ugx), 0)
  into v_qs
  from public.clinic_quick_sales
  where clinic_id = p_clinic_id
    and created_at >= v_start
    and created_at <  v_end;

  -- Stock cost from deductions this month
  select coalesce(
    sum(-t.quantity_change * coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0)), 0)
  into v_stock_cost
  from public.clinic_inventory_txns t
  join public.clinic_inventory i on i.id = t.inventory_id
  where t.clinic_id  = p_clinic_id
    and t.txn_type   = 'deduction'
    and t.created_at >= v_start
    and t.created_at <  v_end;

  -- All-time outstanding balances (snapshot at generation time)
  select coalesce(
    sum(greatest(0, coalesce(total_charged_ugx, 0) - coalesce(amount_paid, 0))), 0)
  into v_outstanding
  from public.clinic_diagnoses
  where clinic_id     = p_clinic_id
    and payment_status in ('pending', 'partial', 'credit');

  -- Per-item stock snapshot
  select coalesce(jsonb_agg(row_data order by row_data->>'item_name'), '[]')
  into v_snapshot
  from (
    select jsonb_build_object(
      'item_id',        i.id,
      'item_name',      i.item_name,
      'item_type',      i.item_type,
      'unit',           i.unit,
      'qty_used',       coalesce(sum(-t.quantity_change)
                          filter (where t.txn_type = 'deduction'), 0),
      'qty_added',      coalesce(sum(t.quantity_change)
                          filter (where t.txn_type in ('addition','adjustment')
                                    and t.quantity_change > 0), 0),
      'closing_qty',    i.quantity,
      'unit_cost_ugx',  coalesce(i.unit_cost_ugx, 0),
      'total_cost_ugx', coalesce(
                          sum(-t.quantity_change *
                              coalesce(t.unit_cost_ugx, i.unit_cost_ugx, 0))
                          filter (where t.txn_type = 'deduction'), 0)
    ) as row_data
    from public.clinic_inventory i
    left join public.clinic_inventory_txns t
           on t.inventory_id = i.id
          and t.created_at  >= v_start
          and t.created_at  <  v_end
    where i.clinic_id = p_clinic_id
      and i.is_active = true
    group by i.id, i.item_name, i.item_type, i.unit, i.quantity, i.unit_cost_ugx
    having coalesce(sum(abs(t.quantity_change)), 0) > 0
        or i.quantity > 0
  ) agg;

  -- Upsert the snapshot row
  insert into public.clinic_monthly_summaries (
    clinic_id,    year,   month,
    total_billed_ugx,     total_collected_ugx,  quick_sales_ugx,
    total_revenue_ugx,    total_outstanding_ugx, stock_cost_ugx,
    net_margin_ugx,       total_consultations,   total_patients,
    payment_methods,      stock_snapshot,
    generated_at,         generated_manually
  ) values (
    p_clinic_id,  p_year, p_month,
    v_billed,     v_collected,            v_qs,
    v_collected + v_qs,  v_outstanding,   v_stock_cost,
    (v_collected + v_qs) - v_stock_cost,  v_consultations,   v_patients,
    v_methods,    v_snapshot,
    now(),        p_manual
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
    'total_revenue', v_collected + v_qs,
    'consultations', v_consultations
  );
end;
$$;

grant execute on function
  public.generate_clinic_monthly_summary(uuid, integer, integer, boolean)
  to authenticated;

notify pgrst, 'reload schema';
