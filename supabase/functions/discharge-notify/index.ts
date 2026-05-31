// Homatt Health — Discharge → Patient Notification
// POST /functions/v1/discharge-notify
// Body: { diagnosisId: string }
//
// Loads the diagnosis + clinic + booking, builds a rich treatment-summary
// push notification and dispatches it via send-notification.
// Returns a detailed status so the clinic UI can show whether the patient
// actually received the notification.
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

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short" });
  } catch { return null; }
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
    .select(
      "id, clinic_id, booking_id, confirmed_diagnosis, total_charged_ugx, " +
      "payment_status, patient_phone, patient_name, prescription_items, follow_up_at, " +
      "follow_up_days, patient_instructions"
    )
    .eq("id", diagnosisId)
    .maybeSingle();

  if (dxErr || !dx) return json({ error: "Diagnosis not found", details: dxErr?.message }, 404);

  // Optional: amount_paid column may not exist yet (added in chunk 2 migration).
  // Try to fetch it separately so we degrade gracefully on older schemas.
  let amountPaid = 0;
  try {
    const { data: paidRow } = await supa
      .from("clinic_diagnoses")
      .select("amount_paid")
      .eq("id", diagnosisId)
      .maybeSingle();
    amountPaid = Number((paidRow as any)?.amount_paid) || 0;
  } catch { /* column not present — treat as zero */ }

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
    return json({
      ok: true,
      delivered: false,
      reason: "patient_not_on_homatt",
      message: "Patient is not registered on the Homatt app — no push sent.",
    });
  }

  // ── 2. Compose rich message ──
  const total       = Number(dx.total_charged_ugx) || 0;
  const paid        = amountPaid;
  const balance     = Math.max(0, total - paid);
  const dxLabel     = dx.confirmed_diagnosis ? ` for ${dx.confirmed_diagnosis}` : "";

  // Prescription summary — comma-joined drug names (first 3)
  let rxSummary = "";
  if (Array.isArray(dx.prescription_items) && dx.prescription_items.length > 0) {
    const names = dx.prescription_items
      .map((p: any) => (p && (p.drug_name || p.name)) || null)
      .filter((s: any) => typeof s === "string" && s.length > 0)
      .slice(0, 3);
    if (names.length) {
      const extra = dx.prescription_items.length - names.length;
      rxSummary = `Meds: ${names.join(", ")}${extra > 0 ? ` +${extra} more` : ""}.`;
    }
  }

  // Follow-up text — prefer explicit follow_up_at date, else "in N days"
  let followUpText = "";
  const followUpDate = fmtDate(dx.follow_up_at);
  if (followUpDate) {
    followUpText = `Follow-up: ${followUpDate}.`;
  } else if (Number(dx.follow_up_days) > 0) {
    followUpText = `Follow-up in ${dx.follow_up_days} days.`;
  }

  // Balance text — only show if there's an outstanding amount
  let balanceText = "";
  if (balance > 0) {
    balanceText = `Balance due: UGX ${fmtUGX(balance)}.`;
  } else if (total > 0) {
    balanceText = `Paid: UGX ${fmtUGX(total)}.`;
  }

  const title  = `Treatment complete at ${clinicName}`;
  const parts  = [
    `Total UGX ${fmtUGX(total)}${dxLabel}.`,
    balanceText,
    rxSummary,
    followUpText,
    "Tap to share how you're feeling.",
  ].filter(Boolean);
  const message = parts.join(" ");

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
        screen:       "recovery_feedback",
        diagnosis_id: dx.id,
        clinic_name:  clinicName,
        amount_ugx:   total,
        balance_ugx:  balance,
      },
    }),
  });

  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    return json({
      ok: false,
      delivered: false,
      error: "send-notification failed",
      message: "Patient is on Homatt but the notification service rejected the request. Check OneSignal secrets.",
      details: sendBody,
    }, 502);
  }

  // send-notification may itself skip (limit reached, pref off)
  if (sendBody && sendBody.skipped) {
    return json({
      ok: true,
      delivered: false,
      reason: sendBody.reason ?? "skipped",
      message:
        sendBody.reason === "daily_limit_reached"
          ? "Patient has hit today's notification limit — try again tomorrow."
          : "Patient has disabled this notification category.",
      sendResult: sendBody,
    });
  }

  return json({
    ok: true,
    delivered: true,
    patientUserId,
    notificationId: sendBody?.notification_id ?? null,
    recipients: sendBody?.recipients ?? null,
    message: "Patient was notified successfully.",
    sendResult: sendBody,
  });
});
