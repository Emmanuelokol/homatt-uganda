/**
 * Homatt Health — Push Notification Edge Function
 *
 * Sends OneSignal push notifications for shop and clinical events.
 *
 * Required Supabase Secrets (set via Dashboard → Settings → Edge Functions):
 *   ONESIGNAL_APP_ID       — from app.onesignal.com → Your App → Keys & IDs
 *   ONESIGNAL_REST_API_KEY — from app.onesignal.com → Your App → Keys & IDs
 *   SUPABASE_SERVICE_ROLE_KEY — from Supabase Dashboard → Settings → API
 *
 * POST /functions/v1/notify
 *
 *   Shop events:
 *     { type: "new_order", product_name, quantity, total_price, phone, address }
 *     { type: "order_update", user_id, product_name, new_status }
 *
 *   Clinical events:
 *     { type: "prescription_issued", rx_id, patient_name, final_diagnosis,
 *         patient_type, rx_route, partner_pharmacy, recovery_date,
 *         followup_date, drugs: [{ name, strength, frequency, times_per_day,
 *         dose_times: ["08:00","14:00","20:00"], duration }] }
 *     { type: "medication_reminder", rx_id, patient_id?, drug_name, strength,
 *         dose_time }
 *     { type: "health_checkin", rx_id, patient_id?, patient_name, final_diagnosis }
 *     { type: "prescription_delivery", rx_id, patient_id?, partner_pharmacy }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const STATUS_MESSAGES: Record<string, string> = {
  processing: 'Your order is being processed and will be shipped soon.',
  shipped:    'Great news! Your order has been shipped and is on the way.',
  delivered:  'Your order has been delivered! Please confirm receipt in the app.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405);

  const appId      = Deno.env.get('ONESIGNAL_APP_ID');
  const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
  const sbUrl      = Deno.env.get('SUPABASE_URL')  || 'https://kgkdiykzmqjougwzzewi.supabase.co';
  const sbSvcKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!appId || !restApiKey) {
    // Notifications not configured yet — silently succeed so orders still work
    return json({ ok: true, note: 'OneSignal not configured' });
  }

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  try {
    if (body.type === 'new_order') {
      // Notify ALL admins: a new shop order arrived
      await sendOneSignalNotification(appId, restApiKey, {
        headings: { en: '🛒 New Shop Order' },
        contents: {
          en: `${body.product_name} × ${body.quantity} — UGX ${Number(body.total_price).toLocaleString()} | ${body.address} | ${body.phone}`,
        },
        filters: [{ field: 'tag', key: 'role', relation: '=', value: 'admin' }],
        // Fallback: send to all subscribers if no tagged admins
        included_segments: ['Total Subscriptions'],
      });
    }

    if (body.type === 'order_update' && body.user_id && sbSvcKey) {
      // Look up the user's OneSignal player ID from their profile
      const sb = createClient(sbUrl, sbSvcKey);
      const { data: profile } = await sb
        .from('profiles')
        .select('onesignal_player_id')
        .eq('id', body.user_id)
        .single();

      const playerId = profile?.onesignal_player_id;
      const msg = STATUS_MESSAGES[body.new_status];

      if (playerId && msg) {
        await sendOneSignalNotification(appId, restApiKey, {
          headings: { en: `📦 Order Update — ${body.product_name}` },
          contents: { en: msg },
          include_player_ids: [playerId],
        });
      }
    }

    // ── Clinical: prescription_issued ──
    // Sent immediately to patient. Also schedules medication_reminder pushes
    // (one per dose time per day for the duration) and a health_checkin in 24h.
    if (body.type === 'prescription_issued') {
      const sb = sbSvcKey ? createClient(sbUrl, sbSvcKey) : null;
      const playerId = await getPlayerIdByBooking(sb, body.booking_code as string);

      const drugs: DrugSchedule[] = Array.isArray(body.drugs) ? (body.drugs as DrugSchedule[]) : [];
      const drugSummary = drugs
        .map((d) => `${d.name} ${d.strength || ''} ${d.frequency || ''} at ${(d.dose_times || []).join(', ')}`.trim())
        .join(' • ');

      const headline = `📋 Prescription Ready — ${body.final_diagnosis ?? 'Diagnosis'}`;
      const contentLines: string[] = [`Hi ${body.patient_name ?? 'patient'},`, `Your ${body.patient_type ?? 'outpatient'} prescription is ready.`];
      if (drugSummary) contentLines.push(drugSummary);
      if (body.recovery_date) contentLines.push(`Expected to feel well by ${body.recovery_date}.`);
      if (body.rx_route === 'partner') {
        contentLines.push(`Tap to choose: home delivery or self-pickup at ${body.partner_pharmacy ?? 'partner pharmacy'}.`);
      }

      const target = playerId ? { include_player_ids: [playerId] } : { included_segments: ['Total Subscriptions'] };
      await sendOneSignalNotification(appId, restApiKey, {
        headings: { en: headline },
        contents: { en: contentLines.join(' ') },
        data: { type: 'prescription_issued', rx_id: body.rx_id, deep_link: 'homatt://prescription/' + body.rx_id },
        ...target,
      });

      // If e-prescription was routed to a partner pharmacy, ask the patient
      // to choose delivery or self-pickup as a follow-up notification.
      if (body.rx_route === 'partner') {
        await sendOneSignalNotification(appId, restApiKey, {
          headings: { en: '🚚 Choose Delivery Method' },
          contents: { en: `Your prescription is at ${body.partner_pharmacy ?? 'the partner pharmacy'}. Tap to choose home delivery or self-pickup.` },
          data: { type: 'prescription_delivery', rx_id: body.rx_id, deep_link: 'homatt://prescription/' + body.rx_id + '/delivery' },
          buttons: [
            { id: 'deliver', text: 'Deliver to me' },
            { id: 'pickup',  text: 'I will pick up' },
          ],
          ...target,
        });
      }

      // Schedule per-dose medication reminders.
      // OneSignal supports `send_after` (ISO timestamp) for delayed delivery.
      // We schedule one reminder per dose_time per day for the drug's duration
      // (defaulting to 7 days when duration can't be parsed).
      const startOfTomorrow = new Date();
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      for (const drug of drugs) {
        const days = parseDurationDays(drug.duration) || 7;
        for (let day = 0; day < days; day++) {
          for (const t of (drug.dose_times || [])) {
            const sendAt = buildAt(day, t);
            if (!sendAt) continue;
            await sendOneSignalNotification(appId, restApiKey, {
              headings: { en: `💊 Time for ${drug.name}` },
              contents: { en: `Take ${drug.name} ${drug.strength || ''}${drug.strength ? ' — ' : ''}dose at ${t}.`.trim() },
              send_after: sendAt.toISOString(),
              data: { type: 'medication_reminder', rx_id: body.rx_id, drug: drug.name, dose_time: t },
              ...target,
            });
          }
        }
      }

      // Schedule a health check-in 24h after the prescription is issued.
      const checkinAt = new Date();
      checkinAt.setDate(checkinAt.getDate() + 1);
      await sendOneSignalNotification(appId, restApiKey, {
        headings: { en: '🩺 How are you feeling today?' },
        contents: { en: `It's been a day since you started treatment for ${body.final_diagnosis ?? 'your condition'}. Tap to tell us how you feel — better, same, or worse.` },
        send_after: checkinAt.toISOString(),
        data: { type: 'health_checkin', rx_id: body.rx_id, deep_link: 'homatt://checkin/' + body.rx_id },
        buttons: [
          { id: 'better', text: 'Feeling better' },
          { id: 'same',   text: 'About the same' },
          { id: 'worse',  text: 'Feeling worse' },
        ],
        ...target,
      });
    }

    // ── Clinical: ad-hoc medication_reminder (used by external scheduler if any) ──
    if (body.type === 'medication_reminder') {
      const sb = sbSvcKey ? createClient(sbUrl, sbSvcKey) : null;
      const playerId = body.patient_id
        ? await getPlayerIdByUser(sb, body.patient_id as string)
        : null;
      const target = playerId ? { include_player_ids: [playerId] } : { included_segments: ['Total Subscriptions'] };
      await sendOneSignalNotification(appId, restApiKey, {
        headings: { en: `💊 Time for ${body.drug_name}` },
        contents: { en: `Take ${body.drug_name} ${body.strength ?? ''} — dose at ${body.dose_time}.`.trim() },
        data: { type: 'medication_reminder', rx_id: body.rx_id, drug: body.drug_name, dose_time: body.dose_time },
        ...target,
      });
    }

    // ── Clinical: ad-hoc health_checkin ──
    if (body.type === 'health_checkin') {
      const sb = sbSvcKey ? createClient(sbUrl, sbSvcKey) : null;
      const playerId = body.patient_id
        ? await getPlayerIdByUser(sb, body.patient_id as string)
        : null;
      const target = playerId ? { include_player_ids: [playerId] } : { included_segments: ['Total Subscriptions'] };
      await sendOneSignalNotification(appId, restApiKey, {
        headings: { en: '🩺 How are you feeling?' },
        contents: { en: `Tap to share your recovery progress for ${body.final_diagnosis ?? 'your treatment'}.` },
        data: { type: 'health_checkin', rx_id: body.rx_id, deep_link: 'homatt://checkin/' + body.rx_id },
        buttons: [
          { id: 'better', text: 'Better' },
          { id: 'same',   text: 'Same' },
          { id: 'worse',  text: 'Worse' },
        ],
        ...target,
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Notify error:', err);
    return json({ error: (err as Error).message }, 502);
  }
});

async function sendOneSignalNotification(
  appId: string,
  restApiKey: string,
  payload: Record<string, unknown>,
) {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${restApiKey}`,
    },
    body: JSON.stringify({ app_id: appId, ...payload }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OneSignal ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Helpers for clinical scheduling ──

interface DrugSchedule {
  name: string;
  strength?: string;
  frequency?: string;
  times_per_day?: number;
  dose_times?: string[]; // e.g. ["08:00","14:00","20:00"]
  duration?: string;     // e.g. "7 days"
}

// Parse "7 days", "10 days", "2 weeks" → number of days. Returns null if unparseable.
function parseDurationDays(d?: string): number | null {
  if (!d) return null;
  const m = d.toLowerCase().match(/(\d+)\s*(day|week|wk)s?/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (m[2].startsWith('w')) return n * 7;
  return n;
}

// Build a future Date for `dayOffset` days from now at HH:MM. If the time has
// already passed today and dayOffset is 0, returns null so the dose is skipped.
function buildAt(dayOffset: number, hhmm: string): Date | null {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const at = new Date();
  at.setDate(at.getDate() + dayOffset);
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= Date.now()) return null;
  return at;
}

async function getPlayerIdByUser(
  sb: ReturnType<typeof createClient> | null,
  userId: string,
): Promise<string | null> {
  if (!sb || !userId) return null;
  const { data } = await sb.from('profiles').select('onesignal_player_id').eq('id', userId).single();
  return data?.onesignal_player_id || null;
}

async function getPlayerIdByBooking(
  sb: ReturnType<typeof createClient> | null,
  bookingCode: string,
): Promise<string | null> {
  if (!sb || !bookingCode) return null;
  const { data: booking } = await sb
    .from('bookings')
    .select('user_id')
    .eq('booking_code', bookingCode)
    .single();
  if (!booking?.user_id) return null;
  return getPlayerIdByUser(sb, booking.user_id);
}
