/**
 * Homatt Health — Push Notification Edge Function
 *
 * Sends OneSignal push notifications for shop order events.
 *
 * Required Supabase Secrets (set via Dashboard → Settings → Edge Functions):
 *   ONESIGNAL_APP_ID       — from app.onesignal.com → Your App → Keys & IDs
 *   ONESIGNAL_REST_API_KEY — from app.onesignal.com → Your App → Keys & IDs
 *   SUPABASE_SERVICE_ROLE_KEY — from Supabase Dashboard → Settings → API
 *
 * POST /functions/v1/notify
 * Body (new_order from user):
 *   { type: "new_order", product_name, quantity, total_price, phone, address }
 *
 * Body (order_update from admin):
 *   { type: "order_update", user_id, product_name, new_status }
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

  let body: Record<string, string>;
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
