-- ── Referral outcomes for the SENDING clinic ────────────────────────────────
-- Problem: the referring clinic only ever saw the referral's own `status`, which
-- stays 'pending' unless someone at the destination taps a button. If the
-- destination simply treated the patient (a normal consultation), the sender was
-- left looking at "Waiting for them" forever.
--
-- referrals_sent() returns each referral this clinic sent PLUS the real outcome,
-- derived from whether the destination clinic recorded a consultation for that
-- patient after the referral was made: when it happened, the diagnosis, and the
-- clinician who saw them. It also self-heals the referral's status to 'seen'
-- when an outcome exists, so both clinics agree and the receiving clinic's inbox
-- clears itself.
--
-- Security: SECURITY DEFINER, but it only ever returns rows for referrals the
-- CALLER's own clinic sent, and only the minimum outcome fields the referring
-- clinician needs (no bill, no prescription detail).

create or replace function public.referrals_sent(p_limit integer default 200)
returns table (
  id             uuid,
  to_clinic_id   uuid,
  to_clinic_name text,
  patient_name   text,
  patient_phone  text,
  reason         text,
  needed_item    text,
  notes          text,
  referral_code  text,
  status         text,
  created_at     timestamptz,
  attended       boolean,
  attended_at    timestamptz,
  outcome_diagnosis text,
  outcome_clinician text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  my_clinic uuid;
begin
  -- The caller's clinic (active staff only).
  select pu.clinic_id into my_clinic
    from portal_users pu
   where pu.auth_user_id = auth.uid()
     and pu.is_active = true
   limit 1;
  if my_clinic is null then
    return;
  end if;

  -- Self-heal: a referral whose patient WAS treated at the destination is
  -- 'seen', even if nobody tapped a button.
  update clinic_referrals r
     set status = 'seen'
   where r.from_clinic_id = my_clinic
     and coalesce(r.status, 'pending') <> 'seen'
     and exists (
       select 1 from clinic_diagnoses d
        where d.clinic_id = r.to_clinic_id
          and d.patient_phone = r.patient_phone
          and d.created_at >= r.created_at
     );

  return query
  select r.id,
         r.to_clinic_id,
         c.name,
         r.patient_name,
         r.patient_phone,
         r.reason,
         r.needed_item,
         r.notes,
         r.referral_code,
         r.status,
         r.created_at,
         (o.id is not null)      as attended,
         o.created_at            as attended_at,
         o.confirmed_diagnosis   as outcome_diagnosis,
         o.clinician_name        as outcome_clinician
    from clinic_referrals r
    left join clinics c on c.id = r.to_clinic_id
    left join lateral (
      select d.id, d.created_at, d.confirmed_diagnosis, d.clinician_name
        from clinic_diagnoses d
       where d.clinic_id = r.to_clinic_id
         and d.patient_phone = r.patient_phone
         and d.created_at >= r.created_at
       order by d.created_at asc
       limit 1
    ) o on true
   where r.from_clinic_id = my_clinic
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

grant execute on function public.referrals_sent(integer) to authenticated;
