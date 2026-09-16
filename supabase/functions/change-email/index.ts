// Homatt Health — Change the sign-in email, when the ordinary route cannot
// POST /functions/v1/change-email
// Headers: Authorization: Bearer <the caller's access token>
// Body: { newEmail: string, password: string }
//
// WHY THIS EXISTS.
//
// `auth.updateUser({ email })` does not move a login. It starts a confirmation,
// and with Supabase's "Secure email change" setting it sends a link to the OLD
// address as well as the new one — both must be opened before the change
// takes effect.
//
// That is the right default, and it has one failure mode that cannot be
// escaped from inside the app: if the OLD address cannot receive mail, the
// change can never be completed. A clinic hit exactly that. Their account was
// on a domain that takes no mail, and the server refused the whole operation
// with `Email address "<their own current address>" is invalid` — naming an
// address they had not typed, for a change they could not finish. The portal
// could explain it and nothing more; the only fix on offer was "ask whoever
// runs the database", which for a clinic in Uganda means it never happens.
//
// So the change is made here, with the admin API, and no mail is sent at all.
//
// WHAT REPLACES THE CONFIRMATION LINK, because something has to.
//
// The link proves two things: that the person controls the new mailbox, and
// that they are the account holder. Only the second is a security property —
// the first is a convenience that, here, is precisely what is broken. So the
// second is proved directly and the first is dropped:
//
//   1. A valid session (the JWT is checked against the auth server).
//   2. The CURRENT PASSWORD, re-entered and verified server-side.
//
// That is the same bar as changing a password, and an attacker who can clear
// it already has the account. It grants no access that a session plus a
// password did not already grant.
//
// A typo in the new address is the residual risk, and it is recoverable: the
// password is unchanged, and the address is whatever they typed and can be
// read back to them. The portal writes it into `homatt_email_change` on the
// device so the sign-in screen can say what the account moved to. Being stuck
// on an address that takes no mail is NOT recoverable, which is the trade.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: { newEmail?: string; password?: string };
  try {
    body = await req.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const newEmail = (body.newEmail ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
    return json({ ok: false, error: "Enter a valid email address" }, 400);
  }
  if (!password) {
    return json({ ok: false, error: "Enter your current password to confirm this change" }, 400);
  }

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!URL_ || !ANON || !SERVICE) {
    return json({ ok: false, error: "This server is not set up to change sign-in emails yet." }, 503);
  }

  // ── 1. Who is asking? ────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(URL_, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me, error: meErr } = await caller.auth.getUser();
  if (meErr || !me?.user) {
    return json({ ok: false, error: "Not signed in — sign in again and retry" }, 401);
  }
  const uid = me.user.id;
  const currentEmail = (me.user.email ?? "").toLowerCase();
  if (!currentEmail) {
    return json({ ok: false, error: "This account has no email to change" }, 400);
  }
  if (currentEmail === newEmail) {
    return json({ ok: false, error: "That is already your sign-in email." }, 400);
  }

  /* ── 2. Prove it is really them, with the password ──────────────────────
   *
   * A SEPARATE client with no Authorization header. Signing in through the
   * caller's client would hand it a new session and, worse, would make a
   * failure here indistinguishable from the session simply expiring. This one
   * exists to answer one question and is thrown away. */
  const check = createClient(URL_, ANON);
  const { error: pwErr } = await check.auth.signInWithPassword({
    email: currentEmail,
    password,
  });
  if (pwErr) {
    // Deliberately not "wrong password" vs anything else: the caller already
    // holds a valid session, so the only thing this can tell them is whether
    // the password matched.
    return json({ ok: false, error: "That password does not match this account." }, 401);
  }
  try { await check.auth.signOut(); } catch (_) { /* best effort */ }

  // ── 3. Move it, with no mail to anybody ──────────────────────────────────
  const admin = createClient(URL_, SERVICE);
  const { error: upErr } = await admin.auth.admin.updateUserById(uid, {
    email: newEmail,
    // The whole point: mark it confirmed here rather than posting a link to a
    // mailbox that may not exist. Without this the account would be left
    // holding an unconfirmed address and could not sign in with either.
    email_confirm: true,
  });
  if (upErr) {
    const m = String(upErr.message ?? "");
    if (/already|registered|exists|duplicate/i.test(m)) {
      return json({ ok: false, error: "Another account already uses that email." }, 409);
    }
    if (/invalid/i.test(m)) {
      return json({ ok: false, error:
        "The server would not accept " + newEmail + ". Check the spelling — some " +
        "addresses are refused because the domain does not exist." }, 400);
    }
    return json({ ok: false, error: m || "Could not change the sign-in email." }, 400);
  }

  /* ── 4. Keep the staff list in step ──────────────────────────────────────
   * portal_users carries a copy for the staff list. It is updated only NOW,
   * after the login has actually moved — updating it when a change was merely
   * requested is what made every other screen advertise an address that could
   * not sign in. */
  try {
    await admin.from("portal_users").update({ email: newEmail }).eq("auth_user_id", uid);
  } catch (_) { /* the login moved; a stale staff row is cosmetic */ }

  return json({ ok: true, from: currentEmail, to: newEmail });
});
