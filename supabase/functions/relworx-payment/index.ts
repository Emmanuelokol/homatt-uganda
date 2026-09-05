import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Homatt Health — Relworx Mobile Money Payment Gateway
 *
 * POST /functions/v1/relworx-payment
 *
 * Actions:
 *   collect — initiate a mobile money collection from a customer
 *   status  — poll the status of a collection request
 *
 * Body (collect):
 *   { action: "collect", msisdn: "0772123456", amount: 50000,
 *     walletType?: "family"|"care", description?: string }
 *
 * Body (status):
 *   { action: "status", internalReference: "ref-xxx" }
 *
 * Supabase secrets required:
 *   RELWORX_API_KEY  — Relworx REST API key
 *   RELWORX_BASE_URL — e.g. https://api.relworx.com  (defaults below if not set)
 */

const RELWORX_BASE = Deno.env.get("RELWORX_BASE_URL") ?? "https://api.relworx.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

/** Normalise a Uganda phone number to international format (256XXXXXXXXX) */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "256" + digits.slice(1);
  if (digits.length === 9) return "256" + digits;
  return null;
}

/** Detect network from Uganda phone prefix */
function detectNetwork(msisdn: string): "MTN" | "AIRTEL" | "UNKNOWN" {
  const prefixes = msisdn.slice(3, 6); // e.g. "077" from "256772..."
  const mtn    = ["077", "078", "039", "031"];
  const airtel = ["070", "075", "074", "020"];
  if (mtn.some(p => msisdn.startsWith("256" + p.slice(1))))    return "MTN";
  if (airtel.some(p => msisdn.startsWith("256" + p.slice(1)))) return "AIRTEL";
  return "UNKNOWN";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("RELWORX_API_KEY");
  if (!apiKey) {
    return jsonResp({ error: "RELWORX_API_KEY secret not configured" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action as string;

  // ─── COLLECT ─────────────────────────────────────────────────────────────
  if (action === "collect") {
    const rawPhone   = String(body.msisdn ?? "").trim();
    const amount     = Number(body.amount);
    const description = String(body.description ?? "Homatt Health payment");

    if (!rawPhone || !amount || amount < 500) {
      return jsonResp({ error: "msisdn and amount (min 500 UGX) are required" }, 400);
    }

    const msisdn = normalisePhone(rawPhone);
    if (!msisdn) {
      return jsonResp({ error: "Invalid Uganda phone number. Use format 0772123456." }, 400);
    }

    const network = detectNetwork(msisdn);

    // Generate a unique external reference
    const externalRef = `HMT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    // Relworx collection API call
    let relworxResp: Response;
    try {
      relworxResp = await fetch(`${RELWORX_BASE}/v2/collections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
        },
        body: JSON.stringify({
          msisdn,
          amount,
          currency: "UGX",
          description,
          external_reference: externalRef,
          network,
        }),
      });
    } catch (err) {
      return jsonResp({ error: "Failed to reach Relworx API", detail: String(err) }, 502);
    }

    const relworxBody = await relworxResp.json().catch(() => ({}));

    if (!relworxResp.ok) {
      return jsonResp(
        { error: "Relworx API error", detail: relworxBody },
        relworxResp.status,
      );
    }

    // Return internal reference for polling
    const internalReference: string =
      (relworxBody as Record<string, unknown>).internal_reference as string
      ?? (relworxBody as Record<string, unknown>).reference as string
      ?? externalRef;

    return jsonResp({ success: true, internalReference, network, msisdn });
  }

  // ─── STATUS ──────────────────────────────────────────────────────────────
  if (action === "status") {
    const internalReference = String(body.internalReference ?? "").trim();
    if (!internalReference) {
      return jsonResp({ error: "internalReference is required" }, 400);
    }

    let relworxResp: Response;
    try {
      relworxResp = await fetch(`${RELWORX_BASE}/v2/collections/${encodeURIComponent(internalReference)}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
        },
      });
    } catch (err) {
      return jsonResp({ error: "Failed to reach Relworx API", detail: String(err) }, 502);
    }

    const relworxBody = await relworxResp.json().catch(() => ({}));

    if (!relworxResp.ok) {
      return jsonResp(
        { error: "Relworx API error", detail: relworxBody },
        relworxResp.status,
      );
    }

    // Normalise status — Relworx may return different shapes
    const raw = relworxBody as Record<string, unknown>;
    const status: string =
      (raw.status as string)
      ?? ((raw.transaction as Record<string, unknown>)?.status as string)
      ?? "unknown";

    return jsonResp({ success: true, transaction: { status } });
  }

  return jsonResp({ error: `Unknown action: ${action}` }, 400);
});
