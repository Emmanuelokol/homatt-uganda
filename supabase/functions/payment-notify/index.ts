// Homatt Health — Payment Received → Patient Notification
// POST /functions/v1/payment-notify
// Body: { diagnosisId: string, amountReceived: number, balance: number, fullyPaid: boolean, method?: string }
//
// Sends a receipt/balance push to the patient so they have an in-app record
// of what they paid and what's still owed.
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
  if (n == null || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString("en-UG");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: {
    diagnosisId?: string;
    amountReceived?: number;
    balance?: number;
    fullyPaid?: boolean;
    method?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const diagnosisId    = body.diagnosisId;
  const amountReceived = Number(body.amountReceived) || 0;
  const balance        = Number(body.balance) || 0;
  const fullyPaid      = Boolean(body.fullyPaid);
  const method         = body.method || "cash";

  if (!diagnosisId) return json({ error: "diagnosisId required" }, 400);
  if (amountReceived <= 0) return json({ error: "amountReceived must be > 0" }, 400);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Load minimal diagnosis info for routing + clinic name
  const { data: dx } = await supa
    .from("clinic_diagnoses")
    .select("id, clinic_id, booking_id, patient_phone, patient_name")
    .eq("id", diagnosisId)
    .maybeSingle();

  if (!dx) return json({
    ok: false, delivered: false,
    reason: "diagnosis_not_found",
    message: "Diagnosis not found — payment was recorded but push receipt skipped.",
  });

  let clinicName = "the clinic";
  if (dx.clinic_id) {
    const { data: clinic } = await supa.from("clinics").select("name").eq("id", dx.clinic_id).maybeSingle();
    if (clinic?.name) clinicName = clinic.name;
  }

  // Resolve patient_user_id
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
    return json({
      ok: true,
      delivered: false,
      reason: "patient_not_on_homatt",
      message: "Patient is not on the Homatt app — receipt push skipped.",
    });
  }

  const methodLabel: Record<string, string> = {
    cash: "Cash",
    mobile_money: "Mobile Money",
    bank: "Bank",
    card: "Card",
    insurance: "Insurance",
    other: "Other",
  };
  const m = methodLabel[method] || method;

  const title = fullyPaid
    ? `Payment complete at ${clinicName}`
    : `Payment received at ${clinicName}`;

  const message = fullyPaid
    ? `Received UGX ${fmtUGX(amountReceived)} (${m}). Your bill is fully settled — thank you!`
    : `Received UGX ${fmtUGX(amountReceived)} (${m}). Balance due: UGX ${fmtUGX(balance)}.`;

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
        screen:       "appointment",
        id:           dx.booking_id ?? dx.id,
        diagnosis_id: dx.id,
        clinic_name:  clinicName,
        amount_ugx:   amountReceived,
        balance_ugx:  balance,
        fully_paid:   fullyPaid,
      },
    }),
  });

  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    return json({
      ok: false,
      delivered: false,
      error: "send-notification failed",
      message: "Payment recorded, but the receipt push failed.",
      details: sendBody,
    }, 502);
  }

  if (sendBody && sendBody.skipped) {
    return json({
      ok: true,
      delivered: false,
      reason: sendBody.reason ?? "skipped",
      message: "Payment recorded; receipt push skipped (" + (sendBody.reason || "unknown") + ").",
      sendResult: sendBody,
    });
  }

  return json({
    ok: true,
    delivered: true,
    patientUserId,
    notificationId: sendBody?.notification_id ?? null,
    message: "Payment receipt sent.",
  });
});
