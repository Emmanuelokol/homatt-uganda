// Homatt Health — Discharge → Patient Notification
// POST /functions/v1/discharge-notify
// Body: { diagnosisId: string }
//
// Loads the diagnosis + clinic + booking, then dispatches a push notification
// to the patient that opens the recovery-feedback card in the mobile app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function fmtUGX(n: number | null | undefined): string {
  if (!n || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString("en-UG");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: { diagnosisId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const diagnosisId = body.diagnosisId;
  if (!diagnosisId) return json({ error: "diagnosisId required" }, 400);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── 1. Load diagnosis + linked booking + clinic ──
  const { data: dx, error: dxErr } = await supa
    .from("clinic_diagnoses")
    .select("id, clinic_id, booking_id, confirmed_diagnosis, total_charged_ugx, patient_phone, patient_name")
    .eq("id", diagnosisId)
    .maybeSingle();

  if (dxErr || !dx) return json({ error: "Diagnosis not found", details: dxErr?.message }, 404);

  // Clinic name
  let clinicName = "the clinic";
  if (dx.clinic_id) {
    const { data: clinic } = await supa.from("clinics").select("name").eq("id", dx.clinic_id).maybeSingle();
    if (clinic?.name) clinicName = clinic.name;
  }

  // Resolve patient_user_id — from booking, or by phone lookup
  let patientUserId: string | null = null;
  if (dx.booking_id) {
    const { data: bk } = await supa.from("bookings").select("patient_user_id").eq("id", dx.booking_id).maybeSingle();
    patientUserId = bk?.patient_user_id ?? null;
  }
  if (!patientUserId && dx.patient_phone) {
    const { data: pr } = await supa
      .from("profiles")
      .select("id")
      .or(`phone_number.eq.${dx.patient_phone},phone.eq.${dx.patient_phone}`)
      .maybeSingle();
    patientUserId = pr?.id ?? null;
  }

  if (!patientUserId) {
    // No Homatt account — patient won't get a push. Return success so the
    // clinic UI doesn't show an error for walk-in patients without an app.
    return json({ ok: true, delivered: false, reason: "patient_not_on_homatt" });
  }

  // ── 2. Compose message ──
  const amount = fmtUGX(dx.total_charged_ugx);
  const title  = `Treatment complete at ${clinicName}`;
  const dxLabel = dx.confirmed_diagnosis ? ` for ${dx.confirmed_diagnosis}` : "";
  const message = `Total: UGX ${amount}${dxLabel}. Tap to share how you're feeling.`;

  // ── 3. Dispatch via send-notification ──
  const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
  const sendRes = await fetch(sendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      userId:  patientUserId,
      title,
      message,
      data: {
        screen:      "recovery_feedback",
        diagnosis_id: dx.id,
        clinic_name:  clinicName,
        amount_ugx:   dx.total_charged_ugx ?? 0,
      },
    }),
  });

  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    return json({ ok: false, error: "send-notification failed", details: sendBody }, 502);
  }

  return json({ ok: true, delivered: true, patientUserId, sendResult: sendBody });
});
