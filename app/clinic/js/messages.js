/* Homatt Health — clinician messenger
 * 1-to-1 chat (text / photo / voice note) between clinic staff, within a
 * clinic or across partner clinics. Realtime + push. Text sends offline
 * (queued); media needs a connection to upload.
 */
(function () {
  'use strict';

  var session = requireClinic();
  setupClinicLogout();
  try { applyRoleGating(); } catch (e) {}
  var supabase = _getClinicSupabase();

  var ME = null;                 // my auth uid
  var MY_NAME = (session && session.staffName) || 'Clinician';
  var MY_CLINIC = (session && session.clinicId) || null;
  var current = null;            // { user, name, clinic }
  var _rtChannel = null;
  var _esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var initials = function (n) { return (n || '?').split(' ').map(function (x) { return x[0]; }).slice(0, 2).join('').toUpperCase(); };
  var fmtTime = function (ts) {
    try { return new Date(ts).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  };
  var fmtDay = function (ts) {
    try {
      var d = new Date(ts), now = new Date();
      if (d.toDateString() === now.toDateString()) return fmtTime(ts);
      return d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  };

  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }

  // ── Resolve my user id, then boot ──────────────────────────────────
  (async function boot() {
    if (session && session.demo) {
      document.getElementById('threadList').innerHTML =
        '<div style="text-align:center;padding:30px;color:#9AA0A6;font-size:13px">Messaging is available when you sign in with a real clinic account.</div>';
      return;
    }
    try {
      var s = await supabase.auth.getSession();
      ME = s && s.data && s.data.session && s.data.session.user && s.data.session.user.id;
    } catch (e) {}
    if (!ME) { ME = session && session.userId; }
    if (!ME) {
      document.getElementById('threadList').innerHTML =
        '<div style="text-align:center;padding:30px;color:#9AA0A6;font-size:13px">Could not verify your account — sign in again.</div>';
      return;
    }
    if (!MY_CLINIC) { try { MY_CLINIC = await resolveClinicId(); } catch (e) {} }
    loadThreads();
    subscribeRealtime();
    // open a conversation if arrived via ?from=<uid> (push tap)
    try {
      var q = new URLSearchParams(location.search);
      var from = q.get('from');
      if (from) openConversation(from, 'Clinician', '');
    } catch (e) {}
  })();

  // ── Inbox ──────────────────────────────────────────────────────────
  async function loadThreads() {
    var list = document.getElementById('threadList');
    var CO = window.ClinicOffline;
    var run = function () { return supabase.rpc('message_threads'); };
    var res = CO ? await CO.cachedQuery('msg_threads_' + ME, run) : await run();
    if (res.error && !(res.data || []).length) {
      var m = res.error.message || '';
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#9AA0A6;font-size:13px">'
        + (/message_threads|does not exist|schema cache/i.test(m)
            ? 'Messaging needs a database update — run 20260728_clinician_messenger.sql.'
            : 'Could not load chats.') + '</div>';
      return;
    }
    var rows = res.data || [];
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px 24px;color:#9AA0A6;font-size:13px">'
        + '<span class="material-icons-outlined" style="font-size:34px;display:block;margin-bottom:8px;color:#B0BEC5">forum</span>'
        + 'No chats yet. Tap <strong>New</strong> to message a clinician.</div>';
      return;
    }
    list.innerHTML = rows.map(function (t) {
      var preview = t.last_media === 'image' ? '📷 Photo'
        : t.last_media === 'audio' ? '🎤 Voice note'
        : (t.last_from_me ? 'You: ' : '') + (t.last_body || '');
      return '<div class="thread" data-user="' + _esc(t.other_user) + '" data-name="' + _esc(t.other_name) + '" data-clinic="' + _esc(t.other_clinic || '') + '">'
        + '<div class="thr-avatar">' + _esc(initials(t.other_name)) + '</div>'
        + '<div class="thr-main">'
        +   '<div class="thr-name">' + _esc(t.other_name) + '</div>'
        +   (t.other_clinic ? '<div class="thr-clinic">' + _esc(t.other_clinic) + '</div>' : '')
        +   '<div class="thr-last">' + _esc(preview) + '</div>'
        + '</div>'
        + '<div class="thr-meta">'
        +   '<div class="thr-time">' + _esc(fmtDay(t.last_at)) + '</div>'
        +   (t.unread > 0 ? '<div class="thr-badge">' + t.unread + '</div>' : '')
        + '</div>'
        + '</div>';
    }).join('');
    list.querySelectorAll('.thread').forEach(function (el) {
      el.addEventListener('click', function () {
        openConversation(el.dataset.user, el.dataset.name, el.dataset.clinic);
      });
    });
  }

  // ── Contact picker ─────────────────────────────────────────────────
  document.getElementById('newMsgBtn').addEventListener('click', openContactPicker);
  document.getElementById('cmClose').addEventListener('click', function () {
    document.getElementById('contactModal').style.display = 'none';
  });
  document.getElementById('contactModal').addEventListener('click', function (e) {
    if (e.target === this) this.style.display = 'none';
  });

  async function openContactPicker() {
    var modal = document.getElementById('contactModal');
    var list = document.getElementById('contactList');
    modal.style.display = 'flex';
    list.innerHTML = '<div style="text-align:center;padding:24px;color:#9AA0A6;font-size:13px">Loading clinicians…</div>';
    var CO = window.ClinicOffline;
    var run = function () { return supabase.rpc('list_message_contacts'); };
    var res = CO ? await CO.cachedQuery('msg_contacts_' + ME, run) : await run();
    if (res.error && !(res.data || []).length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:#9AA0A6;font-size:13px">Could not load clinicians.</div>';
      return;
    }
    var rows = res.data || [];
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:#9AA0A6;font-size:13px">No other clinicians found yet.</div>';
      return;
    }
    var html = '', lastGroup = null;
    rows.forEach(function (c) {
      var group = c.is_own_clinic ? 'My clinic' : (c.clinic_name || 'Partner clinic');
      if (group !== lastGroup) { html += '<div class="cm-group">' + _esc(group) + '</div>'; lastGroup = group; }
      html += '<div class="cm-item" data-user="' + _esc(c.user_id) + '" data-name="' + _esc(c.full_name) + '" data-clinic="' + _esc(c.clinic_name || '') + '">'
        + '<div class="cm-av">' + _esc(initials(c.full_name)) + '</div>'
        + '<div style="min-width:0"><div style="font-size:14.5px;font-weight:700;color:var(--text)">' + _esc(c.full_name || 'Clinician') + '</div>'
        + '<div style="font-size:11.5px;color:var(--text-lt)">' + _esc((c.staff_role || '') + (c.is_own_clinic ? '' : ' · ' + (c.clinic_name || ''))) + '</div></div>'
        + '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.cm-item').forEach(function (el) {
      el.addEventListener('click', function () {
        modal.style.display = 'none';
        openConversation(el.dataset.user, el.dataset.name, el.dataset.clinic);
      });
    });
  }

  // ── Conversation ───────────────────────────────────────────────────
  document.getElementById('convBack').addEventListener('click', closeConversation);

  function closeConversation() {
    current = null;
    document.getElementById('convView').style.display = 'none';
    document.getElementById('inboxView').style.display = 'flex';
    loadThreads();
  }

  async function openConversation(user, name, clinic) {
    current = { user: user, name: name, clinic: clinic };
    document.getElementById('inboxView').style.display = 'none';
    var cv = document.getElementById('convView');
    cv.style.display = 'flex';
    document.getElementById('convAvatar').textContent = initials(name);
    document.getElementById('convName').textContent = name || 'Clinician';
    document.getElementById('convSub').textContent = clinic || '';
    document.getElementById('msgList').innerHTML = '<div class="conv-empty">Loading…</div>';
    await loadMessages();
    markRead();
  }

  function byCreated(a, b) { return new Date(a.created_at) - new Date(b.created_at); }
  function convQuery() {
    return supabase.from('clinic_messages')
      .select('id,from_user,body,media_url,media_type,duration_ms,created_at,read_at')
      .or('and(from_user.eq.' + ME + ',to_user.eq.' + current.user + '),and(from_user.eq.' + current.user + ',to_user.eq.' + ME + ')')
      .order('created_at', { ascending: true }).limit(200);
  }
  function convKey() { return '_co_msg_conv_' + ME + '_' + current.user; }

  async function loadMessages() {
    if (!current) return;
    var CO = window.ClinicOffline;
    var key = 'msg_conv_' + ME + '_' + current.user;
    var res = CO ? await CO.cachedQuery(key, convQuery) : await convQuery();
    foldAndRender((res.data || []).slice());
  }

  // Fold in my messages the base rows don't have yet, deduped by id:
  // server copy wins, then still-queued outbox rows, then this session's echo.
  function foldAndRender(rows) {
    if (!current) return;
    var have = {};
    rows.forEach(function (r) { if (r.id) have[r.id] = 1; });
    pendingToThis().forEach(function (p) {
      if (p.id && have[p.id]) return;
      if (p.id) have[p.id] = 1;
      rows.push(p);
    });
    echoToThis().forEach(function (p) {
      if (p.id && have[p.id]) return;
      if (p.id) have[p.id] = 1;
      rows.push(p);
    });
    rows.sort(byCreated);
    renderMessages(rows);
    maybeMarkRead(rows);
  }

  // Tell the sender their message was seen — once per message.
  var _markedIds = {};
  function maybeMarkRead(rows) {
    if (!current) return;
    var fresh = rows.filter(function (r) {
      return r.from_user === current.user && !r.read_at && r.id && !_markedIds[r.id];
    });
    if (!fresh.length) return;
    fresh.forEach(function (r) { _markedIds[r.id] = 1; });
    markRead();
  }

  function name_isPlaceholder() { return current && (current.name === 'Clinician' || !current.name); }
  function refreshHeaderName(rows) {
    // If we opened from a push (name unknown), infer it from an incoming message.
    var inc = rows.filter(function (r) { return r.from_user === current.user; });
    // from_name isn't selected here; leave as-is. Header will correct on inbox reload.
  }

  // Signature guard: rebuilding innerHTML resets a playing voice note and
  // flickers images, so with the poll running every few seconds we only
  // redraw when a message was added or a tick actually changed.
  var _lastSig = '';
  function msgSig(rows) {
    return rows.map(function (m) {
      return (m.id || m.created_at) + ':' + (m.read_at ? 1 : 0) + (m._pending ? 'p' : '') + (m._failed ? 'f' : '');
    }).join('|');
  }

  function renderMessages(rows) {
    var box = document.getElementById('msgList');
    if (!rows.length) { _lastSig = ''; box.innerHTML = '<div class="conv-empty">No messages yet. Say hello 👋</div>'; return; }
    var sig = msgSig(rows);
    if (sig === _lastSig) return;
    _lastSig = sig;
    // keep the reader's place unless they're already at the newest messages
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || !box.childElementCount;
    box.innerHTML = rows.map(function (m) {
      var mine = m.from_user === ME;
      var inner = '';
      if (m.media_type === 'image' && m.media_url) {
        inner = '<img src="' + _esc(m.media_url) + '" loading="lazy" alt="photo" onclick="_msgLightbox(this.src)">';
        if (m.body) inner += '<div style="margin-top:5px">' + _esc(m.body) + '</div>';
      } else if (m.media_type === 'audio' && m.media_url) {
        inner = '<audio controls preload="none" src="' + _esc(m.media_url) + '"></audio>';
      } else {
        inner = _esc(m.body || '');
      }
      var tick = mine
        ? (m._failed
            ? '<span class="material-icons-outlined b-tick" style="color:#e57373">error_outline</span>'
            : '<span class="material-icons-outlined b-tick">' + (m.read_at ? 'done_all' : (m._pending ? 'schedule' : 'done')) + '</span>')
        : '';
      return '<div class="bubble ' + (mine ? 'me' : 'them') + '">' + inner
        + '<div class="b-time">' + _esc(fmtTime(m.created_at)) + tick + '</div></div>';
    }).join('');
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  window._msgLightbox = function (src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').style.display = 'flex';
  };
  document.getElementById('lightbox').addEventListener('click', function () { this.style.display = 'none'; });

  async function markRead() {
    if (!current) return;
    try { await supabase.rpc('mark_messages_read', { p_other_user: current.user }); } catch (e) {}
  }

  // Offline: my queued messages to the person on screen (so they show instantly)
  function pendingToThis() {
    try {
      var CO = window.ClinicOffline; if (!CO) return [];
      var box = (JSON.parse(localStorage.getItem('_co_outbox') || '{}').v) || [];
      return box.filter(function (o) {
        return o.type === 'table_insert' && o.payload && o.payload.table === 'clinic_messages'
          && o.payload.row && o.payload.row.to_user === current.user;
      }).map(function (o) { return Object.assign({ _pending: true }, o.payload.row); });
    } catch (e) { return []; }
  }

  // ── Sending ────────────────────────────────────────────────────────
  var input = document.getElementById('msgInput');
  var sendBtn = document.getElementById('sendBtn');
  var micBtn = document.getElementById('micBtn');

  // ONE-TAP buttons. Plain 'click' on Android is unreliable next to an open
  // keyboard: the keyboard-dismiss reflow moves the button between touchstart
  // and click, so the click lands elsewhere and the user must tap many times.
  // Fire on POINTERDOWN (the first instant of the touch, before any reflow),
  // with pointerup + click as deduped fallbacks — the exact pattern that fixed
  // the Quick Sale Sell button.
  // The dedupe timestamp is SHARED across all composer buttons: sendText()
  // swaps Send→Mic in the same spot while the finger is still down, so the
  // follow-up pointerup/click lands on the Mic and would start a recording.
  // A global window means the ghost events hit a still-warm dedupe and die.
  var _lastTap = 0;
  function instantTap(btn, handler) {
    if (!btn) return;
    function fire(e) {
      var now = Date.now();
      if (now - _lastTap < 700) return;    // dedupe the trio + ghost taps on swapped-in buttons
      _lastTap = now;
      if (e && e.cancelable) e.preventDefault();  // keep focus (and keyboard) where it is
      handler(e);
    }
    btn.addEventListener('pointerdown', fire);
    btn.addEventListener('pointerup', fire);
    btn.addEventListener('click', fire);
    btn.addEventListener('touchstart', fire, { passive: false });  // pre-Pointer WebViews
  }

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(100, input.scrollHeight) + 'px';
    var has = input.value.trim().length > 0;
    sendBtn.style.display = has ? 'flex' : 'none';
    micBtn.style.display = has ? 'none' : 'flex';
  });
  instantTap(sendBtn, sendText);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  });

  function baseRow() {
    var row = {
      from_user: ME, from_name: MY_NAME, from_clinic_id: MY_CLINIC,
      to_user: current.user, to_clinic_id: null,
      created_at: new Date().toISOString(),
    };
    if (window.ClinicOffline && ClinicOffline.uuid) row.id = ClinicOffline.uuid();
    else if (window.crypto && crypto.randomUUID) row.id = crypto.randomUUID();
    return row;
  }

  // Everything sent this session, kept in memory. loadMessages() re-renders
  // from a CACHED query (fresh data arrives later), so without this a just-sent
  // message vanishes on the first 'clinic-synced' re-render — the outbox no
  // longer has it and the cache doesn't yet. Folded in (deduped by id) until
  // the server copy shows up.
  var _echo = [];
  function rememberEcho(row) { _echo.push(row); }
  function echoToThis() {
    return current ? _echo.filter(function (r) { return r.to_user === current.user; }) : [];
  }

  function persist(row) {
    var CO = window.ClinicOffline;
    if (CO) {
      CO.enqueue('table_insert', { table: 'clinic_messages', row: row, stripUnknownColumns: true });
      CO.flush();
    } else if (supabase) {
      supabase.from('clinic_messages').insert(row).then(function () {}).catch(function () {});
    }
  }

  function sendText() {
    if (!current) return;
    var text = input.value.trim();
    if (!text) return;
    var row = baseRow(); row.body = text;
    rememberEcho(row);
    persist(row);
    input.value = ''; input.style.height = 'auto';
    sendBtn.style.display = 'none'; micBtn.style.display = 'flex';
    appendOptimistic(row);
  }

  function appendOptimistic(row) {
    var box = document.getElementById('msgList');
    if (box.querySelector('.conv-empty')) box.innerHTML = '';
    var inner = row.media_type === 'image' && row.media_url ? '<img src="' + _esc(row.media_url) + '">'
      : row.media_type === 'audio' && row.media_url ? '<audio controls src="' + _esc(row.media_url) + '"></audio>'
      : _esc(row.body || '');
    var d = document.createElement('div');
    d.className = 'bubble me';
    d.innerHTML = inner + '<div class="b-time">' + fmtTime(row.created_at) + '<span class="material-icons-outlined b-tick">schedule</span></div>';
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    return d;
  }

  function markSent(bubble) {
    var t = bubble && bubble.querySelector('.b-tick');
    if (t) t.textContent = 'done';
  }
  function markFailed(bubble) {
    var t = bubble && bubble.querySelector('.b-tick');
    if (t) { t.textContent = 'error_outline'; t.style.color = '#e57373'; }
  }

  // ── Photo ──────────────────────────────────────────────────────────
  instantTap(document.getElementById('photoBtn'), function () {
    if (navigator.onLine === false) { toast('Photos need a connection', 'error'); return; }
    document.getElementById('photoInput').click();
  });
  document.getElementById('photoInput').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !current) return;
    var row = baseRow(); row.media_type = 'image';
    row.media_url = URL.createObjectURL(file);   // local preview; swapped after upload
    rememberEcho(row);
    var bubble = appendOptimistic(row);
    var url = await uploadMedia(file, 'jpg');
    if (!url) { row._failed = true; markFailed(bubble); toast('Photo failed — check connection and try again', 'error'); return; }
    row.media_url = url;
    persist(row); markSent(bubble);
  });

  async function uploadMedia(blob, ext) {
    try {
      var name = ME + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      var up = await supabase.storage.from('clinic-chat').upload(name, blob, {
        contentType: blob.type || (ext === 'webm' ? 'audio/webm' : 'image/jpeg'), upsert: false,
      });
      if (up.error) { console.warn('upload:', up.error.message); return null; }
      return supabase.storage.from('clinic-chat').getPublicUrl(name).data.publicUrl;
    } catch (e) { console.warn('upload threw:', e); return null; }
  }

  // ── Voice note ─────────────────────────────────────────────────────
  var _rec = null, _chunks = [], _recStart = 0, _recTimer = null;
  instantTap(micBtn, startRecording);
  instantTap(document.getElementById('recStop'), function () { stopRecording(true); });
  instantTap(document.getElementById('recCancel'), function () { stopRecording(false); });

  async function startRecording() {
    if (navigator.onLine === false) { toast('Voice notes need a connection', 'error'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Recording not supported on this device', 'error'); return; }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _chunks = [];
      _rec = new MediaRecorder(stream);
      _rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) _chunks.push(ev.data); };
      _rec.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); };
      _rec.start();
      _recStart = Date.now();
      document.getElementById('recBar').style.display = 'flex';
      micBtn.style.display = 'none';
      document.getElementById('photoBtn').style.display = 'none';
      _recTimer = setInterval(function () {
        var s = Math.floor((Date.now() - _recStart) / 1000);
        document.getElementById('recTime').textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      }, 300);
    } catch (e) { toast('Microphone permission needed', 'error'); }
  }

  function resetRecUI() {
    clearInterval(_recTimer);
    document.getElementById('recBar').style.display = 'none';
    document.getElementById('recTime').textContent = '0:00';
    micBtn.style.display = 'flex';
    document.getElementById('photoBtn').style.display = 'flex';
  }

  async function stopRecording(send) {
    if (!_rec) { resetRecUI(); return; }
    var dur = Date.now() - _recStart;
    var rec = _rec; _rec = null;
    var done = new Promise(function (resolve) {
      rec.addEventListener('stop', function () { resolve(new Blob(_chunks, { type: 'audio/webm' })); });
    });
    try { rec.stop(); } catch (e) {}
    resetRecUI();                              // timer + bar disappear the instant you tap
    if (!send || dur < 500) return;
    var blob = await done;                     // ms — just the recorder flushing its buffer
    var row = baseRow(); row.media_type = 'audio'; row.duration_ms = dur;
    row.media_url = URL.createObjectURL(blob); // playable locally; swapped after upload
    rememberEcho(row);
    var bubble = appendOptimistic(row);
    var url = await uploadMedia(blob, 'webm');
    if (!url) { row._failed = true; markFailed(bubble); toast('Voice note failed — check connection and try again', 'error'); return; }
    row.media_url = url;
    persist(row); markSent(bubble);
  }

  // ── Real-time delivery ─────────────────────────────────────────────
  // Two layers, because a websocket alone dies silently on flaky 4G:
  //  1. Supabase realtime — instant when it works, and it RESUBSCRIBES
  //     itself with backoff whenever the channel errors or closes.
  //  2. A relentless incremental poll — every few seconds, fetch only the
  //     messages newer than the newest one we have (tiny on slow links; a
  //     full re-sync every ~6th tick refreshes read ticks). Rendering is
  //     signature-guarded, so quiet polls repaint nothing.
  var _rtGen = 0;
  function subscribeRealtime() {
    try {
      if (!supabase.channel) return;
      var mine = ++_rtGen;
      if (_rtChannel) { try { supabase.removeChannel(_rtChannel); } catch (e) {} _rtChannel = null; }
      _rtChannel = supabase.channel('clinic_messages_rt')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clinic_messages' }, function (payload) {
          var m = payload.new;
          if (!m) return;
          if (m.to_user !== ME && m.from_user !== ME) return;   // not mine
          if (current && (m.from_user === current.user || m.to_user === current.user)) {
            pollConversation(true);   // fetch + render now (dedupes by id)
          } else if (m.to_user === ME) {
            toast((m.from_name || 'Clinician') + ': ' + (m.media_type === 'image' ? '📷 Photo' : m.media_type === 'audio' ? '🎤 Voice note' : (m.body || 'New message')), 'info');
          }
          if (document.getElementById('inboxView').style.display !== 'none') pollThreads(true);
        })
        .subscribe(function (status) {
          if (mine !== _rtGen) return;            // superseded subscription
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            var wait = Math.min(30000, 3000 * Math.pow(2, Math.min(_rtRetry++, 4)));
            setTimeout(function () { if (mine === _rtGen) subscribeRealtime(); }, wait);
          } else if (status === 'SUBSCRIBED') _rtRetry = 0;
        });
    } catch (e) {}
  }
  var _rtRetry = 0;

  var _pollBusy = false, _fullTick = 0;
  function cachedConvRows() {
    try { return ((JSON.parse(localStorage.getItem(convKey()) || 'null') || {}).v) || []; }
    catch (e) { return []; }
  }
  async function pollConversation(force) {
    if (!current || !ME || _pollBusy) return;
    if (!force && document.hidden) return;
    if (navigator.onLine === false) return;
    _pollBusy = true;
    try {
      _fullTick++;
      var cached = cachedConvRows();
      var newest = cached.length ? cached[cached.length - 1].created_at : null;
      var incremental = !!newest && !force && _fullTick % 6 !== 0;
      var q = convQuery();
      if (incremental) q = q.gt('created_at', newest);
      var res = await q;
      if (!res || res.error || !res.data) return;
      var rows;
      if (incremental) {
        if (!res.data.length) return;                  // nothing new
        var have = {};
        cached.forEach(function (r) { if (r.id) have[r.id] = 1; });
        rows = cached.concat(res.data.filter(function (r) { return !have[r.id]; }));
      } else {
        rows = res.data;
      }
      rows.sort(byCreated);
      try { localStorage.setItem(convKey(), JSON.stringify({ ts: Date.now(), v: rows })); } catch (e) {}
      foldAndRender(rows.slice());
    } catch (e) {} finally { _pollBusy = false; }
  }
  setInterval(function () { pollConversation(false); }, 3500);

  // Inbox: keep the thread list fresh too (only re-renders when it changed).
  var _thrBusy = false;
  async function pollThreads(force) {
    if (!ME || _thrBusy || current) return;
    if (!force && document.hidden) return;
    if (navigator.onLine === false) return;
    if (document.getElementById('inboxView').style.display === 'none') return;
    _thrBusy = true;
    try {
      var res = await supabase.rpc('message_threads');
      if (!res || res.error || !res.data) return;
      var key = '_co_msg_threads_' + ME;
      var next = JSON.stringify({ ts: Date.now(), v: res.data });
      var prev = '';
      try { prev = JSON.stringify(((JSON.parse(localStorage.getItem(key) || 'null') || {}).v) || []); } catch (e) {}
      try { localStorage.setItem(key, next); } catch (e) {}
      if (JSON.stringify(res.data) !== prev) loadThreads();
    } catch (e) {} finally { _thrBusy = false; }
  }
  setInterval(function () { pollThreads(false); }, 9000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { pollConversation(true); pollThreads(true); }
  });

  function appendIncoming(m) {
    var box = document.getElementById('msgList');
    if (box.querySelector('.conv-empty')) box.innerHTML = '';
    var mine = m.from_user === ME;
    var inner = m.media_type === 'image' && m.media_url ? '<img src="' + _esc(m.media_url) + '" onclick="_msgLightbox(this.src)">'
      : m.media_type === 'audio' && m.media_url ? '<audio controls preload="none" src="' + _esc(m.media_url) + '"></audio>'
      : _esc(m.body || '');
    var d = document.createElement('div');
    d.className = 'bubble ' + (mine ? 'me' : 'them');
    d.innerHTML = inner + '<div class="b-time">' + fmtTime(m.created_at) + '</div>';
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }

  // ── Keyboard-aware layout ──────────────────────────────────────────
  // The compose bar is kept above the keyboard by the BROWSER, not by JS:
  // the viewport meta declares interactive-widget=resizes-content, so when
  // the keyboard opens the layout viewport shrinks and the 100dvh flex
  // column re-lays out with the composer pinned at its bottom. (The old
  // visualViewport resize/scroll JS made the composer bounce while
  // scrolling — vv 'scroll' fires constantly — and moved it mid-tap, which
  // is why taps on the text box kept missing. Don't bring it back.)
  // All that's left to do: keep the newest messages in view when the
  // keyboard opens, and focus the input when the composer padding is hit.
  input.addEventListener('focus', function () {
    setTimeout(function () {
      var list = document.getElementById('msgList');
      if (list) list.scrollTop = list.scrollHeight;
    }, 300);
  });
  var _composer = document.querySelector('.composer');
  if (_composer) _composer.addEventListener('pointerdown', function (e) {
    if (e.target === _composer) { e.preventDefault(); input.focus(); }
  });

  // Measure the real topbar height into --msg-top (the chat is pinned right
  // below it). The topbar sizes to its buttons and differs per phone; assuming
  // 60px left the composer pushed off-screen on taller topbars.
  (function msgTop() {
    function set() {
      var tb = document.querySelector('.admin-topbar');
      var h = tb ? Math.ceil(tb.getBoundingClientRect().height) : 60;
      if (h > 0) document.documentElement.style.setProperty('--msg-top', h + 'px');
    }
    set();
    window.addEventListener('resize', set);
    window.addEventListener('load', set);
    setTimeout(set, 400);   // after fonts/topbar buttons settle
  })();

  // When our queued messages finish syncing, refresh so ticks/read update.
  window.addEventListener('clinic-synced', function () { if (current) loadMessages(); else loadThreads(); });
})();
