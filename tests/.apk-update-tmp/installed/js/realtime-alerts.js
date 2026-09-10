/**
 * Homatt Health — Realtime In-App Alerts
 *
 * Shared module for all portals (clinic, pharmacy, proxy, admin).
 * Subscribes to Supabase Realtime channels and shows:
 *   - Toast banners (slide-in, auto-dismiss)
 *   - Badge counts on nav items
 *   - An alert panel / drawer
 *
 * Usage (include after supabase client is created):
 *
 *   initRealtimeAlerts({
 *     client:    <supabase client>,
 *     portal:    'clinic' | 'pharmacy' | 'proxy' | 'admin' | 'patient',
 *     entityId:  clinic_id | pharmacy_id | proxy_id | user_id
 *   });
 */

(function (global) {
  'use strict';

  // ── Internal state ────────────────────────────────────────────
  const _alerts = [];         // { id, title, body, table, ts }
  let   _unreadCount = 0;
  let   _badgeEl = null;      // DOM element for the badge
  let   _channels = [];       // active Supabase channels (for cleanup)

  // ── Styles injected once ──────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('_rtaStyles')) return;
    const s = document.createElement('style');
    s.id = '_rtaStyles';
    s.textContent = `
      /* Toast */
      .rta-toast {
        position: fixed; top: 16px; right: 16px; left: 16px;
        max-width: 420px; margin: 0 auto;
        background: #1B5E20; color: #fff;
        border-radius: 12px; padding: 14px 16px;
        display: flex; align-items: flex-start; gap: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,.35);
        z-index: 10000; cursor: pointer;
        animation: rtaSlideIn .3s ease;
        font-family: inherit; font-size: 14px; line-height: 1.4;
      }
      .rta-toast.rta-warning { background: #E65100; }
      .rta-toast.rta-info    { background: #1565C0; }
      .rta-toast-icon   { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
      .rta-toast-body   { flex: 1; }
      .rta-toast-title  { font-weight: 600; margin-bottom: 2px; }
      .rta-toast-msg    { opacity: .9; font-size: 13px; }
      .rta-toast-close  { background: none; border: none; color: #fff;
                          cursor: pointer; padding: 2px; flex-shrink: 0; opacity: .7; }
      @keyframes rtaSlideIn {
        from { opacity: 0; transform: translateY(-12px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* Badge */
      .rta-badge {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 18px; height: 18px; padding: 0 4px;
        background: #E53935; color: #fff;
        border-radius: 9px; font-size: 11px; font-weight: 700;
        margin-left: 6px; line-height: 1;
      }
      .rta-badge[data-count="0"] { display: none; }

      /* Alert panel */
      .rta-panel {
        position: fixed; top: 0; right: 0; bottom: 0; width: 320px;
        background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,.18);
        z-index: 9998; transform: translateX(100%);
        transition: transform .3s ease; overflow-y: auto;
        font-family: inherit;
      }
      .rta-panel.open { transform: translateX(0); }
      .rta-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; background: #1B5E20; color: #fff;
        position: sticky; top: 0; z-index: 1;
      }
      .rta-panel-title { font-size: 16px; font-weight: 600; }
      .rta-panel-close { background: none; border: none; color: #fff; cursor: pointer; }
      .rta-panel-empty { padding: 40px 20px; text-align: center; color: #9E9E9E; }
      .rta-alert-item {
        padding: 14px 20px; border-bottom: 1px solid #F0F0F0;
        display: flex; gap: 10px; align-items: flex-start; cursor: pointer;
      }
      .rta-alert-item:hover { background: #F9FBE7; }
      .rta-alert-item.unread { border-left: 3px solid #388E3C; }
      .rta-alert-item-icon { color: #388E3C; font-size: 20px; flex-shrink: 0; margin-top: 2px; }
      .rta-alert-item-icon.warning { color: #E65100; }
      .rta-alert-item-body { flex: 1; }
      .rta-alert-item-title { font-size: 13px; font-weight: 600; color: #1B1B1B; }
      .rta-alert-item-msg   { font-size: 12px; color: #555; margin-top: 2px; }
      .rta-alert-item-time  { font-size: 11px; color: #9E9E9E; margin-top: 4px; }
    `;
    document.head.appendChild(s);
  }

  // ── Toast ──────────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(title, msg, type = 'success', onClick) {
    // Remove any existing toast
    document.querySelectorAll('.rta-toast').forEach(el => el.remove());
    clearTimeout(_toastTimer);

    const iconMap = { success: 'notifications', warning: 'warning', info: 'info' };
    const toast = document.createElement('div');
    toast.className = `rta-toast rta-${type}`;
    toast.innerHTML = `
      <span class="material-icons-outlined rta-toast-icon">${iconMap[type] || 'notifications'}</span>
      <div class="rta-toast-body">
        <div class="rta-toast-title">${_esc(title)}</div>
        <div class="rta-toast-msg">${_esc(msg)}</div>
      </div>
      <button class="rta-toast-close material-icons-outlined" title="Dismiss">close</button>`;

    document.body.appendChild(toast);

    const dismiss = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); };
    toast.querySelector('.rta-toast-close').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    toast.addEventListener('click', () => { dismiss(); if (onClick) onClick(); });

    _toastTimer = setTimeout(dismiss, 6000);
  }

  function _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Badge ──────────────────────────────────────────────────────
  function _setBadge(el, count) {
    if (!el) return;
    el.textContent = count > 99 ? '99+' : count;
    el.setAttribute('data-count', count);
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function _incrementBadge() {
    _unreadCount++;
    _setBadge(_badgeEl, _unreadCount);
  }

  // ── Alert panel ───────────────────────────────────────────────
  function _buildPanel() {
    if (document.getElementById('_rtaPanel')) return;
    const panel = document.createElement('div');
    panel.id = '_rtaPanel';
    panel.className = 'rta-panel';
    panel.innerHTML = `
      <div class="rta-panel-header">
        <span class="rta-panel-title">Alerts</span>
        <button class="rta-panel-close material-icons-outlined" id="_rtaPanelClose">close</button>
      </div>
      <div id="_rtaPanelList"></div>`;
    document.body.appendChild(panel);
    document.getElementById('_rtaPanelClose').addEventListener('click', closeAlertPanel);
  }

  function openAlertPanel() {
    _buildPanel();
    document.getElementById('_rtaPanel').classList.add('open');
    _unreadCount = 0;
    _setBadge(_badgeEl, 0);
    _renderPanelList();
  }

  function closeAlertPanel() {
    const p = document.getElementById('_rtaPanel');
    if (p) p.classList.remove('open');
  }

  function _renderPanelList() {
    const list = document.getElementById('_rtaPanelList');
    if (!list) return;
    if (_alerts.length === 0) {
      list.innerHTML = '<div class="rta-panel-empty"><span class="material-icons-outlined" style="font-size:40px;display:block;margin-bottom:8px">notifications_none</span>No new alerts</div>';
      return;
    }
    list.innerHTML = _alerts.slice().reverse().map(a => `
      <div class="rta-alert-item unread" data-id="${_esc(a.id)}">
        <span class="material-icons-outlined rta-alert-item-icon${a.type === 'warning' ? ' warning' : ''}">${
          a.type === 'warning' ? 'warning' : 'notifications'
        }</span>
        <div class="rta-alert-item-body">
          <div class="rta-alert-item-title">${_esc(a.title)}</div>
          <div class="rta-alert-item-msg">${_esc(a.body)}</div>
          <div class="rta-alert-item-time">${_formatTime(a.ts)}</div>
        </div>
      </div>`).join('');
  }

  function _formatTime(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = Math.floor((now - d) / 1000);
      if (diff < 60)   return 'Just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return d.toLocaleDateString('en-UG', { day:'numeric', month:'short' });
    } catch (_) { return ''; }
  }

  // ── Add alert to local list ───────────────────────────────────
  function _addAlert(title, body, type = 'success') {
    const a = { id: Date.now() + Math.random(), title, body, type, ts: new Date().toISOString() };
    _alerts.push(a);
    if (_alerts.length > 50) _alerts.shift(); // keep last 50
    _incrementBadge();
    showToast(title, body, type, openAlertPanel);
    if (document.getElementById('_rtaPanel')?.classList.contains('open')) {
      _renderPanelList();
    }
  }

  // ── Attach notification bell to a nav link ────────────────────
  function _attachBell(selector) {
    const navLink = document.querySelector(selector);
    if (!navLink) return;

    // Build bell button
    const bell = document.createElement('button');
    bell.id = '_rtaBellBtn';
    bell.title = 'Alerts';
    bell.style.cssText = 'background:none;border:none;cursor:pointer;position:relative;display:flex;align-items:center;padding:6px 8px;color:inherit';
    bell.innerHTML = `<span class="material-icons-outlined" style="font-size:22px">notifications</span>`;

    const badge = document.createElement('span');
    badge.className = 'rta-badge';
    badge.setAttribute('data-count', '0');
    badge.style.display = 'none';
    badge.style.cssText += 'position:absolute;top:2px;right:2px;pointer-events:none';
    bell.appendChild(badge);
    _badgeEl = badge;

    bell.addEventListener('click', openAlertPanel);

    // Inject into topbar if it exists, otherwise after the selector element
    const topbar = document.querySelector('.admin-topbar');
    if (topbar) {
      topbar.style.display = 'flex';
      topbar.style.alignItems = 'center';
      topbar.appendChild(bell);
    } else {
      navLink.parentNode.insertBefore(bell, navLink.nextSibling);
    }
  }

  // ── Portal subscriptions ──────────────────────────────────────

  function _subscribeClinic(client, clinicId) {
    _attachBell('.sidebar-link[href="dashboard.html"]');

    const ch = client.channel('clinic-alerts-' + clinicId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'bookings',
        filter: `clinic_id=eq.${clinicId}`
      }, (payload) => {
        const b = payload.new;
        _addAlert(
          'New Patient Booking',
          `${b.patient_name || 'A patient'} has a new booking. View in your portal.`
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'bookings',
        filter: `clinic_id=eq.${clinicId}`
      }, (payload) => {
        const b = payload.new;
        if (b.status === 'confirmed') {
          _addAlert(
            'Booking Confirmed',
            `Patient ${b.patient_name || ''} confirmed for today. Prepare their record.`
          );
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'e_prescriptions',
        filter: `clinic_id=eq.${clinicId}`
      }, (payload) => {
        _addAlert('Prescription Created', 'New prescription issued — ready to send to pharmacy.');
      })
      .subscribe();

    _channels.push(ch);
  }

  function _subscribePharmacy(client, pharmacyId) {
    _attachBell('.sidebar-link[href="orders.html"]');

    const ch = client.channel('pharmacy-alerts-' + pharmacyId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pharmacy_orders',
        filter: `pharmacy_id=eq.${pharmacyId}`
      }, (payload) => {
        const o = payload.new;
        const itemCount = Array.isArray(o.items) ? o.items.length : (o.items ? JSON.parse(o.items).length : 1);
        _addAlert(
          'New Medicine Order',
          `Order received — ${itemCount} item${itemCount !== 1 ? 's' : ''}. Patient is waiting ⏱️`
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pharmacy_inventory',
        filter: `pharmacy_id=eq.${pharmacyId}`
      }, (payload) => {
        const inv = payload.new;
        if (inv.quantity <= inv.reorder_threshold) {
          _addAlert(
            'Low Stock Alert',
            `${inv.medicine_name} has only ${inv.quantity} units left.`,
            'warning'
          );
        }
      })
      .subscribe();

    _channels.push(ch);
  }

  function _subscribeProxy(client, proxyId) {
    _attachBell('.sidebar-link');

    const ch = client.channel('proxy-alerts-' + proxyId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'bookings',
        filter: `proxy_id=eq.${proxyId}`
      }, (payload) => {
        const b = payload.new;
        _addAlert(
          'Patient Booked',
          `${b.patient_name || 'A patient you registered'} has a new booking.`
        );
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'follow_up_alerts',
        filter: `vht_id=eq.${proxyId}`
      }, (payload) => {
        _addAlert(
          'Follow-Up Needed',
          'A patient in your area missed their follow-up. Please check on them.',
          'warning'
        );
      })
      .subscribe();

    _channels.push(ch);
  }

  function _subscribeAdmin(client) {
    _attachBell('.sidebar-link[href="dashboard.html"]');

    const ch = client.channel('admin-alerts')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'admin_alerts'
      }, (payload) => {
        const a = payload.new;
        _addAlert(
          a.type === 'payment_failed' ? 'Payment Failed' :
          a.type === 'patient_dropout' ? 'Patient Dropout' : 'System Alert',
          a.message,
          a.severity === 'critical' ? 'warning' : 'info'
        );
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'payments',
        filter: 'status=eq.failed'
      }, (payload) => {
        const p = payload.new;
        _addAlert(
          'Payment Failed',
          `Payment failed for booking. Review needed.`,
          'warning'
        );
      })
      .subscribe();

    _channels.push(ch);
  }

  function _subscribePatient(client, userId) {
    const ch = client.channel('patient-alerts-' + userId)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'bookings',
        filter: `patient_user_id=eq.${userId}`
      }, (payload) => {
        const b = payload.new;
        const statusLabels = {
          confirmed:   'Your appointment has been confirmed ✅',
          in_progress: 'Your appointment is in progress.',
          completed:   'Your visit is complete. Check for your prescription.',
          cancelled:   'Your booking was cancelled. Rebook anytime.',
        };
        const msg = statusLabels[b.status];
        if (msg) _addAlert('Appointment Update', msg);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pharmacy_orders',
        filter: `patient_user_id=eq.${userId}`
      }, (payload) => {
        const o = payload.new;
        const statusLabels = {
          confirmed:  'Your medicine order has been confirmed.',
          preparing:  'The pharmacy is packing your order.',
          dispatched: 'Your medicine is on the way 🏍️ Est. 1–2 hours.',
          delivered:  'Medicines delivered ✅ Remember to complete the full course.',
        };
        const msg = statusLabels[o.status];
        if (msg) _addAlert('Order Update', msg);
      })
      .subscribe();

    _channels.push(ch);
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * @param {{ client, portal, entityId }} opts
   *   portal: 'clinic' | 'pharmacy' | 'proxy' | 'admin' | 'patient'
   *   entityId: clinic_id / pharmacy_id / proxy_id / user_id
   */
  function initRealtimeAlerts(opts) {
    if (!opts || !opts.client || !opts.portal) return;
    _injectStyles();
    _buildPanel();

    const { client, portal, entityId } = opts;

    switch (portal) {
      case 'clinic':   if (entityId) _subscribeClinic(client, entityId);   break;
      case 'pharmacy': if (entityId) _subscribePharmacy(client, entityId); break;
      case 'proxy':    if (entityId) _subscribeProxy(client, entityId);    break;
      case 'admin':    _subscribeAdmin(client);                            break;
      case 'patient':  if (entityId) _subscribePatient(client, entityId);  break;
    }
  }

  /** Manually show a toast from portal code. */
  function realtimeToast(title, msg, type) {
    _injectStyles();
    showToast(title, msg, type);
  }

  /** Tear down all subscriptions (call on logout). */
  function destroyRealtimeAlerts() {
    _channels.forEach(ch => { try { ch.unsubscribe(); } catch (_) {} });
    _channels = [];
    _alerts.length = 0;
    _unreadCount = 0;
  }

  // Export
  global.initRealtimeAlerts   = initRealtimeAlerts;
  global.realtimeToast        = realtimeToast;
  global.openAlertPanel       = openAlertPanel;
  global.destroyRealtimeAlerts = destroyRealtimeAlerts;

}(window));
