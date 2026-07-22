/* Homatt Health — new-message alerts (dashboard / any clinic page)
 * Shows: (1) an unread badge on the sidebar Messages link, (2) a tappable
 * "new messages" alert card on the dashboard Home slide, (3) a system
 * notification (Windows toast in the desktop app, Android heads-up while the
 * app is open — background Android push comes from the OneSignal trigger).
 * The messages page handles its own alerts and is skipped here.
 */
(function () {
  'use strict';
  if (/messages\.html/i.test(location.pathname)) return;

  var session = null;
  try { session = JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch (e) {}
  if (!session || session.demo) return;

  var supabase = null;
  try { supabase = _getClinicSupabase(); } catch (e) {}
  if (!supabase) return;

  var ME = null;
  var UNREAD = 0;

  // ── Badge UI ───────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '.msg-badge{display:inline-flex;align-items:center;justify-content:center;' +
    'min-width:20px;height:20px;border-radius:10px;background:#25D366;color:#063;' +
    'color:#0b3d1f;font-size:11px;font-weight:800;padding:0 6px;margin-left:auto}' +
    '#msgAlertCard{display:flex;align-items:center;gap:12px;background:#1B5E20;color:#fff;' +
    'border-radius:14px;padding:13px 16px;margin:0 0 14px;cursor:pointer;' +
    'box-shadow:0 4px 14px rgba(27,94,32,0.35)}' +
    '#msgAlertCard .mac-icon{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.18);' +
    'display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '#msgAlertCard .mac-title{font-size:14.5px;font-weight:800}' +
    '#msgAlertCard .mac-sub{font-size:12px;opacity:.85;margin-top:1px}';
  document.head.appendChild(css);

  function sidebarLink() { return document.querySelector('.sidebar-nav a[href="messages.html"]'); }

  function render() {
    // sidebar badge
    var link = sidebarLink();
    if (link) {
      var b = link.querySelector('.msg-badge');
      if (UNREAD > 0) {
        if (!b) { b = document.createElement('span'); b.className = 'msg-badge'; link.appendChild(b); }
        b.textContent = UNREAD > 99 ? '99+' : String(UNREAD);
      } else if (b) b.remove();
    }
    // dashboard Home-slide alert card
    var card = document.getElementById('msgAlertCard');
    if (UNREAD > 0) {
      if (!card) {
        var anchor = document.querySelector('[data-slide="home"]');
        if (!anchor || !anchor.parentNode) return;
        card = document.createElement('div');
        card.id = 'msgAlertCard';
        card.setAttribute('data-slide', 'home');
        card.addEventListener('click', function () { location.href = 'messages.html'; });
        anchor.parentNode.insertBefore(card, anchor);
      }
      card.innerHTML =
        '<div class="mac-icon"><span class="material-icons-outlined">forum</span></div>' +
        '<div style="flex:1;min-width:0"><div class="mac-title">' +
        (UNREAD > 1 ? UNREAD + ' new messages' : '1 new message') +
        '</div><div class="mac-sub">Tap to open your chats</div></div>' +
        '<span class="material-icons-outlined">chevron_right</span>';
    } else if (card) card.remove();
  }

  // ── Unread count (shares the messages page cache key) ──────────────
  async function refreshBadge() {
    if (!ME) return;
    try {
      var CO = window.ClinicOffline;
      var run = function () { return supabase.rpc('message_threads'); };
      var res = CO && CO.cachedQuery ? await CO.cachedQuery('msg_threads_' + ME, run) : await run();
      var rows = (res && res.data) || [];
      UNREAD = rows.reduce(function (n, t) { return n + (parseInt(t.unread, 10) || 0); }, 0);
      render();
    } catch (e) {}
  }

  // ── System notification (Electron toast / Android heads-up) ────────
  function sysNotify(fromName, body, fromUser) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var n = new Notification('💬 ' + (fromName || 'Clinician'), {
        body: body, tag: 'homatt-msg', icon: 'icons/clinic-192.png?v=3',
      });
      n.onclick = function () {
        try { window.focus(); } catch (e) {}
        location.href = 'messages.html' + (fromUser ? '?from=' + fromUser : '');
      };
    } catch (e) {}
  }
  // Ask for permission once, on the first tap anywhere (needs a user gesture
  // on Android; the desktop app grants it silently).
  (function armPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    var ask = function () {
      document.removeEventListener('pointerdown', ask);
      try { Notification.requestPermission().catch(function () {}); } catch (e) {}
    };
    document.addEventListener('pointerdown', ask);
  })();

  // ── Realtime ───────────────────────────────────────────────────────
  function subscribe() {
    try {
      if (!supabase.channel) return;
      supabase.channel('clinic_messages_alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clinic_messages' }, function (payload) {
          var m = payload.new;
          if (!m || m.to_user !== ME) return;
          UNREAD++;
          render();
          var preview = m.media_type === 'image' ? '📷 Photo'
            : m.media_type === 'audio' ? '🎤 Voice note' : (m.body || 'New message');
          try { showToast((m.from_name || 'Clinician') + ': ' + preview, 'info'); } catch (e) {}
          sysNotify(m.from_name, preview, m.from_user);
        })
        .subscribe();
    } catch (e) {}
  }

  // ── Boot ───────────────────────────────────────────────────────────
  (async function boot() {
    try {
      var s = await supabase.auth.getSession();
      ME = s && s.data && s.data.session && s.data.session.user && s.data.session.user.id;
    } catch (e) {}
    if (!ME) ME = session.userId;
    if (!ME) return;
    refreshBadge();
    subscribe();
    window.addEventListener('clinic-synced', refreshBadge);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshBadge();
    });
    setInterval(refreshBadge, 90000);   // fallback when realtime can't connect
  })();
})();
