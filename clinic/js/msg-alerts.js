/* Homatt Health — new-message alerts (dashboard / any clinic page)
 * Shows: (1) an unread badge on the sidebar Messages link, (2) a tappable
 * "new messages" alert card on the dashboard Home slide naming the senders
 * and their clinics, (3) a pop-up toast + system notification (Windows toast
 * in the desktop app, Android heads-up while the app is open) the moment a
 * message arrives — driven by BOTH realtime and a 12s hard-timeout poll, so
 * alerts still fire when the websocket silently dies on mobile internet.
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
  var FROMS = [];          // [{name, clinic}] senders with unread, newest first

  function raced(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('timeout')); }, ms);
    })]);
  }

  // Once-per-message memory (persists across pages/reloads).
  var SEEN_KEY = '_msg_alerts_seen';
  function seen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; } }
  function saveSeen(s) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {} }

  // ── Badge + card UI ────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '.msg-badge{display:inline-flex;align-items:center;justify-content:center;' +
    'min-width:20px;height:20px;border-radius:10px;background:#25D366;' +
    'color:#0b3d1f;font-size:11px;font-weight:800;padding:0 6px;margin-left:auto}' +
    '#msgAlertCard{display:flex;align-items:center;gap:12px;background:var(--deep);color:#fff;' +
    'border-radius:14px;padding:13px 16px;margin:0 0 14px;cursor:pointer;' +
    'box-shadow:0 4px 14px rgba(27,94,32,0.35)}' +
    '#msgAlertCard .mac-icon{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.18);' +
    'display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '#msgAlertCard .mac-title{font-size:14.5px;font-weight:800}' +
    '#msgAlertCard .mac-sub{font-size:12px;opacity:.85;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
  document.head.appendChild(css);

  function render() {
    var link = document.querySelector('.sidebar-nav a[href="messages.html"]');
    if (link) {
      var b = link.querySelector('.msg-badge');
      if (UNREAD > 0) {
        if (!b) { b = document.createElement('span'); b.className = 'msg-badge'; link.appendChild(b); }
        b.textContent = UNREAD > 99 ? '99+' : String(UNREAD);
      } else if (b) b.remove();
    }
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
      var who = FROMS.slice(0, 2).map(function (f) {
        return f.name + (f.clinic ? ' — ' + f.clinic : '');
      }).join(' · ');
      if (FROMS.length > 2) who += ' +' + (FROMS.length - 2) + ' more';
      var esc = function (s) { return String(s || '').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
      card.innerHTML =
        '<div class="mac-icon"><span class="material-icons-outlined">forum</span></div>' +
        '<div style="flex:1;min-width:0"><div class="mac-title">' +
        (UNREAD > 1 ? UNREAD + ' new messages' : '1 new message') +
        '</div><div class="mac-sub">' + (who ? 'From ' + esc(who) : 'Tap to open your chats') + '</div></div>' +
        '<span class="material-icons-outlined">chevron_right</span>';
    } else if (card) card.remove();
  }

  // ── System notification (Electron toast / Android heads-up) ────────
  function sysNotify(title, body, fromUser) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var n = new Notification('💬 ' + title, {
        body: body, tag: 'homatt-msg', icon: 'icons/clinic-192.png?v=3',
      });
      n.onclick = function () {
        try { window.focus(); } catch (e) {}
        location.href = 'messages.html' + (fromUser ? '?from=' + fromUser : '');
      };
    } catch (e) {}
  }
  (function armPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    var ask = function () {
      document.removeEventListener('pointerdown', ask);
      try { Notification.requestPermission().catch(function () {}); } catch (e) {}
    };
    document.addEventListener('pointerdown', ask);
  })();

  function preview(t) {
    return t.last_media === 'image' ? '📷 Photo'
      : t.last_media === 'audio' ? '🎤 Voice note' : (t.last_body || 'New message');
  }

  // Alert once per new incoming message, naming sender + clinic.
  function fireAlerts(rows) {
    var s = seen(), changed = false;
    rows.forEach(function (t) {
      if (!t.unread || t.last_from_me) return;
      var prev = s[t.other_user];
      if (prev && !(t.last_at > prev)) return;      // already alerted for this
      s[t.other_user] = t.last_at; changed = true;
      var title = (t.other_name || 'Clinician') + (t.other_clinic ? ' — ' + t.other_clinic : '');
      try { showToast('💬 ' + title + ': ' + preview(t), 'info'); } catch (e) {}
      sysNotify(title, preview(t), t.other_user);
    });
    if (changed) saveSeen(s);
  }

  function applyThreads(rows, alertNew) {
    UNREAD = rows.reduce(function (n, t) { return n + (parseInt(t.unread, 10) || 0); }, 0);
    FROMS = rows.filter(function (t) { return (parseInt(t.unread, 10) || 0) > 0; })
      .map(function (t) { return { name: t.other_name || 'Clinician', clinic: t.other_clinic || '' }; });
    render();
    if (alertNew) fireAlerts(rows);
  }

  function cachedThreads() {
    try { return ((JSON.parse(localStorage.getItem('_co_msg_threads_' + ME) || 'null') || {}).v) || []; }
    catch (e) { return []; }
  }

  // ── Poll (works even when realtime can't connect) ──────────────────
  var _busy = false;
  async function refresh(alertNew) {
    if (!ME || _busy) return;
    _busy = true;
    try {
      if (navigator.onLine === false) { applyThreads(cachedThreads(), false); return; }
      var res = await raced(supabase.rpc('message_threads'), 12000);
      if (res && !res.error && res.data) {
        try { localStorage.setItem('_co_msg_threads_' + ME, JSON.stringify({ ts: Date.now(), v: res.data })); } catch (e) {}
        applyThreads(res.data, alertNew);
      } else {
        applyThreads(cachedThreads(), false);
      }
    } catch (e) { applyThreads(cachedThreads(), false); }
    finally { _busy = false; }
  }

  // ── Realtime (instant when it works; the poll is the safety net) ───
  var _rtGen = 0, _rtRetry = 0, _rtChannel = null;
  // When this socket is connected, new messages arrive on it the moment they
  // are sent — so the timed check below has nothing to add and stays quiet.
  var _rtLive = false;

  function subscribe() {
    try {
      if (!supabase.channel) return;
      var mine = ++_rtGen;
      if (_rtChannel) { try { supabase.removeChannel(_rtChannel); } catch (e) {} _rtChannel = null; }
      _rtChannel = supabase.channel('clinic_messages_alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clinic_messages' }, function (payload) {
          var m = payload.new;
          if (!m || m.to_user !== ME) return;
          refresh(true);                            // fetch names/clinics + alert
        })
        .subscribe(function (status) {
          if (mine !== _rtGen) return;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            var wait = Math.min(30000, 3000 * Math.pow(2, Math.min(_rtRetry++, 4)));
            setTimeout(function () { if (mine === _rtGen) subscribe(); }, wait);
            _rtLive = false;
          } else if (status === 'SUBSCRIBED') { _rtRetry = 0; _rtLive = true; }
        });
    } catch (e) {}
  }

  // ── Boot ───────────────────────────────────────────────────────────
  (async function boot() {
    try {
      var s = await supabase.auth.getSession();
      ME = s && s.data && s.data.session && s.data.session.user && s.data.session.user.id;
      // authorize the realtime socket (RLS tables deliver nothing to anon)
      try { supabase.realtime.setAuth(s.data.session.access_token); } catch (e2) {}
    } catch (e) {}
    if (!ME) ME = session.userId;
    if (!ME) return;
    applyThreads(cachedThreads(), false);           // instant paint from cache
    refresh(true);
    subscribe();
    window.addEventListener('clinic-synced', function () { refresh(true); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh(true);
    });
    // Paced rather than every 12 seconds: silent while the phone is away or
    // the message socket is up, and slower the longer nothing arrives. On a
    // quiet afternoon this alone was ~300 requests an hour.
    if (window.HomattPace) {
      HomattPace.every({
        label: 'msg-alerts', base: 15000, max: 180000,
        live: function () { return _rtLive; },
        run: function () { refresh(true); },
      });
    } else {
      setInterval(function () { if (!document.hidden) refresh(true); }, 12000);
    }
  })();
})();
