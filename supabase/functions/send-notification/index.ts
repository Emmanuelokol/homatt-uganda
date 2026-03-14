import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Homatt Health — Send Push Notification via OneSignal
 *
 * POST /functions/v1/send-notification
 * Body: {
 *   userId:  string   — Supabase user UUID (maps to OneSignal external_id)
 *   title:   string   — notification title
 *   message: string   — notification body
 *   data?:   object   — optional payload, e.g. { screen: 'appointment', id: '...' }
 * }
 *
 * Secrets required (set via Supabase CLI or dashboard):
 *   ONESIGNAL_APP_ID       — OneSignal App ID
 *   ONESIGNAL_REST_API_KEY — OneSignal REST API Key v2
 */

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

Deno.serve(async (req: Request) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse body
  let userId: string, title: string, message: string, data: Record<string, string> | undefined;
  try {
    const body = await req.json();
    userId  = body.userId;
    title   = body.title;
    message = body.message;
    data    = body.data;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!userId || !title || !message) {
    return new Response(
      JSON.stringify({ error: "userId, title, and message are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const appId  = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");

  if (!appId || !apiKey) {
    return new Response(
      JSON.stringify({ error: "OneSignal secrets not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build OneSignal notification payload
  const payload: Record<string, unknown> = {
    app_id: appId,
    // Target by external_id (Supabase user UUID — set via OneSignal.login())
    include_aliases: {
      external_id: [userId],
    },
    target_channel: "push",
    headings: { en: title },
    contents: { en: message },
  };

  // Attach optional data payload for navigation
  if (data && typeof data === "object") {
    payload.data = data;
  }

  // Send to OneSignal
  let osResponse: Response;
  try {
    osResponse = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reach OneSignal API", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const osBody = await osResponse.json();

  if (!osResponse.ok) {
    return new Response(
      JSON.stringify({ error: "OneSignal API error", detail: osBody }),
      { status: osResponse.status, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, notification_id: osBody.id, recipients: osBody.recipients }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Connection": "keep-alive" },
    }
  );
});
