import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Homatt Health — Send Push Notification via OneSignal
 *
 * POST /functions/v1/send-notification
 * Body:
 *   { player_ids: string[], heading: string, message: string, data?: object, portal?: string }
 *   — OR legacy —
 *   { userId: string, title: string, message: string, data?: object }
 *
 * Rules:
 *  - Max 3 push notifications per patient per day (tracked on profiles)
 *  - Respects notification_preferences JSONB on profiles before sending to patients
 *  - Always includes android_channel_id: "homatt-health"
 *  - Idempotent: callers should set reminder flags before calling to prevent duplicates
 *
 * Env vars (Supabase Secrets):
 *   ONESIGNAL_APP_ID       — OneSignal App ID
 *   ONESIGNAL_REST_API_KEY — OneSignal REST API Key v2
 *   SUPABASE_URL           — auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase runtime
 */

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";
const DAILY_NOTIF_LIMIT = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

/** Increment the daily notification counter for a patient profile. */
async function checkAndIncrementLimit(
  supa: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: profile } = await supa
    .from("profiles")
    .select("notifications_sent_today, last_notification_date")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return true; // not a patient — portal staff, allow

  const lastDate = profile.last_notification_date;
  const sentToday = lastDate === today ? (profile.notifications_sent_today ?? 0) : 0;

  if (sentToday >= DAILY_NOTIF_LIMIT) return false;

  await supa
    .from("profiles")
    .update({
      notifications_sent_today: sentToday + 1,
      last_notification_date: today,
    })
    .eq("id", userId);

  return true;
}

/** Check notification preference category for a patient. Returns true = allowed. */
async function checkPreference(
  supa: ReturnType<typeof createClient>,
  userId: string,
  category: string | undefined
): Promise<boolean> {
  if (!category) return true;

  const { data: profile } = await supa
    .from("profiles")
    .select("notification_preferences")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return true; // not a patient

  const prefs = profile.notification_preferences ?? {};
  // If the key doesn't exist in prefs, default to true (opt-in by default)
  return prefs[category] !== false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ── Normalise inputs (support legacy userId + title interface) ──
  const playerIds: string[] | null =
    Array.isArray(body.player_ids) && body.player_ids.length > 0
      ? (body.player_ids as string[])
      : null;

  const legacyUserId = typeof body.userId === "string" ? body.userId : null;

  const heading =
    typeof body.heading === "string"
      ? body.heading
      : typeof body.title === "string"
      ? body.title
      : null;

  const message = typeof body.message === "string" ? body.message : null;
  const data = body.data && typeof body.data === "object" ? body.data : undefined;
  // portal key: used to identify which pref category to check
  // e.g. "appointment_reminders", "medicine_reminders", "promo_prevention_shop"
  const prefCategory = typeof body.pref_category === "string" ? body.pref_category : undefined;

  if (!heading || !message) {
    return json({ error: "heading (or title) and message are required" }, 400);
  }
  if (!playerIds && !legacyUserId) {
    return json({ error: "player_ids or userId is required" }, 400);
  }

  const appId = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!appId || !apiKey) {
    return json({ error: "OneSignal secrets not configured" }, 500);
  }

  // ── Supabase client for preference + limit checks ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let supa: ReturnType<typeof createClient> | null = null;
  if (supabaseUrl && serviceKey) {
    supa = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
  }

  // ── Per-user limit + preference checks when targeting by userId ──
  if (supa && legacyUserId) {
    const prefOk = await checkPreference(supa, legacyUserId, prefCategory);
    if (!prefOk) {
      return json({ skipped: true, reason: "notification_preference_disabled" });
    }
    const limitOk = await checkAndIncrementLimit(supa, legacyUserId);
    if (!limitOk) {
      return json({ skipped: true, reason: "daily_limit_reached" });
    }
  }

  // ── Build OneSignal payload ──
  const payload: Record<string, unknown> = {
    app_id: appId,
    headings: { en: heading },
    contents: { en: message },
    android_channel_id: "homatt-health",
  };

  if (playerIds) {
    // Direct player ID targeting (from pg_cron / webhooks)
    payload.include_player_ids = playerIds;
  } else if (legacyUserId) {
    // External ID targeting (from client code via OneSignal.login())
    payload.include_aliases = { external_id: [legacyUserId] };
    payload.target_channel = "push";
  }

  if (data) {
    payload.data = data;
  }

  // ── Send to OneSignal ──
  let osResponse: Response;
  try {
    osResponse = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json(
      { error: "Failed to reach OneSignal API", detail: String(err) },
      502
    );
  }

  const osBody = await osResponse.json();

  if (!osResponse.ok) {
    return json({ error: "OneSignal API error", detail: osBody }, osResponse.status);
  }

  return json({
    success: true,
    notification_id: osBody.id,
    recipients: osBody.recipients,
  });
});
