-- Add patient_name to clinic_diagnoses so the dashboard can show it without a join
ALTER TABLE public.clinic_diagnoses
  ADD COLUMN IF NOT EXISTS patient_name text;
