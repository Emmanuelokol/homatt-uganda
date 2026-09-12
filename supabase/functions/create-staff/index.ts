// Homatt Health — Create a clinic staff account (owner only)
// POST /functions/v1/create-staff
// Headers: Authorization: Bearer <owner's access token>
// Body: { fullName: string, email: string, password: string, staffRole: string }
//
// Lets a clinic OWNER create login accounts for their staff (clinician, nurse,
// receptionist or another owner) straight from the portal's Settings page.
// Runs with the service role because creating auth users requires the admin
// API — so the ownership check here is the security boundary:
//   1. The caller's JWT must belong to an ACTIVE clinic_staff row with
//      staff_role = 'owner'.
//   2. The new account is always attached to the CALLER'S clinic — the client
//      cannot choose a clinic id.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ROLES = ["owner", "clinician", "nurse", "receptionist", "salesperson"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: { fullName?: string; email?: string; password?: string; staffRole?: string };
  try {
    body = await req.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const fullName = (body.fullName ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const staffRole = (body.staffRole ?? "").trim();

  if (!fullName) return json({ ok: false, error: "Full name is required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "Enter a valid email address" }, 400);
  if (password.length < 8) return json({ ok: false, error: "Password must be at least 8 characters" }, 400);
  if (!ROLES.includes(staffRole)) return json({ ok: false, error: "Invalid role" }, 400);

  // ── 1. Identify the caller from their JWT ────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerData?.user) {
    return json({ ok: false, error: "Not signed in — sign in again and retry" }, 401);
  }

  // ── 2. Caller must be an ACTIVE OWNER of a clinic ────────────────────────
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: callerRow } = await admin
    .from("portal_users")
    .select("clinic_id, staff_role, is_active")
    .eq("auth_user_id", callerData.user.id)
    .eq("role", "clinic_staff")
    .eq("is_active", true)
    .maybeSingle();

  if (!callerRow?.clinic_id || (callerRow.staff_role ?? "owner") !== "owner") {
    return json({ ok: false, error: "Only the clinic owner can create staff accounts" }, 403);
  }

  // ── 3. Create the auth account ───────────────────────────────────────────
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // staff sign in immediately; no confirmation email dance
    user_metadata: { full_name: fullName },
  });

  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return json({ ok: false, error: "An account with this email already exists" }, 409);
    }
    return json({ ok: false, error: createErr?.message ?? "Could not create the account" }, 500);
  }

  // ── 4. Link it to the caller's clinic with the chosen role ───────────────
  const { error: linkErr } = await admin.from("portal_users").insert({
    auth_user_id: created.user.id,
    full_name: fullName,
    email,
    role: "clinic_staff",
    clinic_id: callerRow.clinic_id,
    staff_role: staffRole,
    is_active: true,
  });

  if (linkErr) {
    // Don't leave an orphaned login that belongs to no clinic.
    try { await admin.auth.admin.deleteUser(created.user.id); } catch (_) { /* best effort */ }
    return json({ ok: false, error: "Could not link the account to your clinic: " + linkErr.message }, 500);
  }

  return json({ ok: true, email, staffRole });
});
