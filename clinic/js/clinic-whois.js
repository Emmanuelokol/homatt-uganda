/* Homatt Health — who is this, while the name is still being typed
 *
 * A clinician starts a treatment by typing a name. Until now that box did
 * nothing at all: `quickPatientName` had one listener, `_syncQuickPatient`,
 * which copied the text into `state.patient` and stopped. The only patient
 * search in the wizard is bound to the PHONE box, returns a name and a phone
 * and nothing else, and the money and the history are only fetched after
 * somebody has been picked from it.
 *
 * So a clinic could treat the same person for the fourth time, with two unpaid
 * visits behind them, and nothing on the screen said so until the bill was
 * already being written.
 *
 * ── WHAT IT ANSWERS, AND WHY THOSE THREE ─────────────────────────────────
 *
 *   MONEY OWED    the request was "say if money is demanded". A clinic that
 *                 learns about a debt after the consultation has to chase it;
 *                 one that learns before can ask while the patient is there.
 *   LAST SEEN     "when they last visited". Two days ago is a return visit and
 *                 probably the same illness; eight months ago is a new one.
 *   LAST TREATED  what for. The single most useful line of a history, and the
 *                 one a clinician would otherwise open a second screen to read.
 *
 * ── IT OFFERS; IT NEVER FILLS ────────────────────────────────────────────
 *
 * Nothing is written into any box until a person taps a row. Two people in one
 * village share a name, and a clinic's own records are full of near-duplicates
 * — "Okello John" and "Okello  John" and "okello john" are three rows and one
 * man. Auto-selecting on a name match is how one visit gets filed against
 * somebody else's debt. The same rule the dictation name matching follows, for
 * the same reason.
 *
 * ── NO MIGRATION ─────────────────────────────────────────────────────────
 *
 * It reads `clinic_diagnoses`, which every clinic already has, rather than
 * asking for a new RPC. `search_clinic_patients` would have been the tidier
 * home for it — but the deploy token is revoked, nothing new reaches the
 * database, and a feature that needs a migration nobody can apply is a feature
 * that does not exist. This works on the database as it is today.
 *
 * Grouping is by normalised phone where there is one and by normalised name
 * where there is not, using the same shape as `homatt_norm_phone`: the last
 * nine digits. +256772004455, 0772004455 and 772004455 are one person.
 */
(function (root) {
  'use strict';

  var MIN_CHARS = 2;
  var DEBOUNCE_MS = 260;
  var LOOKBACK_ROWS = 400;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ugx(n) {
    var v = Math.round(Number(n) || 0);
    return 'UGX ' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* The same canonical key the database uses — the last nine significant
   * digits. Anything shorter is not a Ugandan mobile line and is not a key. */
  function normPhone(p) {
    var d = String(p == null ? '' : p).replace(/\D/g, '');
    return d.length < 9 ? '' : d.slice(-9);
  }
  function normName(n) {
    return String(n == null ? '' : n).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* ── One row per PERSON, not per visit ────────────────────────────────────
   * A returning patient has several visits and the clinician wants one line
   * about them, not five. Money is summed across every visit, because a debt
   * from March is still a debt. */
  function group(rows) {
    var by = {}, order = [];
    (rows || []).forEach(function (v) {
      var name = String(v.patient_name || '').trim();
      var phone = String(v.patient_phone || '').trim();
      var key = normPhone(phone) || normName(name);
      if (!key) return;
      if (!by[key]) {
        by[key] = {
          key: key, name: name || 'Unnamed', phone: phone,
          visits: 0, owed: 0, charged: 0, paid: 0,
          lastAt: null, lastDx: '', clinicPatientId: null
        };
        order.push(key);
      }
      var g = by[key];
      g.visits++;
      var total = Number(v.total_charged_ugx) || 0;
      var paid = Number(v.amount_paid) || 0;
      g.charged += total;
      g.paid += paid;
      /* Only a positive balance is a debt. An over-payment on one visit does
       * NOT cancel a debt on another — the clinic may owe change on the first
       * and still be owed money on the second, and netting them off hides both.
       * Summed per visit, floored at zero each time. */
      if (total - paid > 0) g.owed += (total - paid);

      var t = new Date(v.created_at).getTime();
      if (isFinite(t) && (g.lastAt === null || t > g.lastAt)) {
        g.lastAt = t;
        g.lastDx = String(v.confirmed_diagnosis || '').trim();
      }
      /* Prefer the more complete name — but compare and display it with its
       * whitespace collapsed, or "Okello  John" beats "Okello John" purely by
       * having a stray space in it, and the clinic is shown its own typo back
       * as the canonical spelling. */
      var tidy = name.replace(/\s+/g, ' ').trim();
      if (tidy.length > String(g.name).length) g.name = tidy;
      if (!g.phone && phone) g.phone = phone;
      if (!g.clinicPatientId && v.clinic_patient_id) g.clinicPatientId = v.clinic_patient_id;
    });
    return order.map(function (k) { return by[k]; });
  }

  function matches(g, q) {
    var n = normName(q);
    if (!n) return false;
    var name = normName(g.name);
    if (name.indexOf(n) >= 0) return true;
    // Every typed word must appear somewhere in the name, so "john okello"
    // finds "Okello John" — which is how half of Uganda writes it.
    var parts = n.split(' ').filter(Boolean);
    if (parts.length < 2) return false;
    for (var i = 0; i < parts.length; i++) {
      if (name.indexOf(parts[i]) < 0) return false;
    }
    return true;
  }

  function ago(ms) {
    if (!ms) return '';
    var d = Math.floor((new Date().getTime() - ms) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    if (d < 60) return 'last month';
    if (d < 365) return Math.round(d / 30) + ' months ago';
    var y = Math.floor(d / 365);
    return y === 1 ? 'a year ago' : y + ' years ago';
  }

  function rowHTML(g, i) {
    var bits = [];
    if (g.lastAt) {
      bits.push('Last seen ' + esc(ago(g.lastAt)) +
        (g.lastDx ? ' · ' + esc(g.lastDx) : ''));
    }
    bits.push(g.visits + ' visit' + (g.visits === 1 ? '' : 's'));
    if (g.phone) bits.push(esc(g.phone));
    return '<div class="who-row" data-idx="' + i + '" role="button" tabindex="0">' +
      '<div class="who-main">' +
        '<div class="who-name">' + esc(g.name) + '</div>' +
        '<div class="who-sub">' + bits.join(' · ') + '</div>' +
      '</div>' +
      (g.owed > 0
        ? '<div class="who-owed"><b>' + esc(ugx(g.owed)) + '</b><span>owing</span></div>'
        : '<div class="who-clear"><span class="material-icons-outlined">check</span></div>') +
    '</div>';
  }

  var CSS = [
    '#whoBox{position:relative}',
    '#whoList{margin-top:6px;border:1px solid var(--border);border-radius:11px;',
      'background:var(--surface);overflow:hidden;display:none}',
    '#whoList.on{display:block}',
    '#whoList .who-head{font-size:10.5px;font-weight:800;letter-spacing:.4px;',
      'text-transform:uppercase;color:var(--text-lt);padding:7px 11px 5px}',
    '.who-row{display:flex;align-items:center;gap:10px;padding:9px 11px;cursor:pointer;',
      'border-top:1px solid var(--border);min-height:44px}',
    '.who-row:first-of-type{border-top:0}',
    '.who-row:active{background:var(--tint-2)}',
    '.who-main{flex:1;min-width:0}',
    '.who-name{font-size:13.5px;font-weight:700;color:var(--text);line-height:1.3;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.who-sub{font-size:11px;color:var(--text-lt);margin-top:1px;line-height:1.35;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* The money is the reason this exists, so it is the one thing that carries
       a colour — a fill and its ink defined together, as everything on a
       themed surface in this app must be. */
    '.who-owed{flex:0 0 auto;text-align:right;padding:3px 9px;border-radius:9px;',
      'background:rgba(230,81,0,.12);border:1px solid rgba(230,81,0,.30)}',
    '.who-owed b{display:block;font-size:12.5px;font-weight:800;color:var(--warning-ink);',
      'line-height:1.2;white-space:nowrap}',
    '.who-owed span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.4px;',
      'color:var(--warning-ink)}',
    '.who-clear{flex:0 0 auto;color:var(--success-ink);display:flex;align-items:center}',
    '.who-clear .material-icons-outlined{font-size:18px}',
    '#whoList .who-note{font-size:10.5px;color:var(--text-lt);padding:6px 11px 8px;',
      'line-height:1.45;border-top:1px solid var(--border)}'
  ].join('');

  var _rows = null;          // the clinic's recent visits, fetched once
  var _loading = null;
  var _timer = null;
  var _io = null;
  var _onPick = null;
  var _last = [];

  function ensure() {
    if (document.getElementById('whoStyle')) return;
    var st = document.createElement('style');
    st.id = 'whoStyle'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* Fetched ONCE per screen, not per keystroke. A clinic has a few hundred
   * recent visits; filtering them on the phone is instant and costs nothing,
   * where a query per keystroke on a Ugandan mobile connection is both slow
   * and expensive. Refreshed only if the screen is open long enough to matter. */
  function load() {
    if (_rows) return Promise.resolve(_rows);
    if (_loading) return _loading;
    _loading = Promise.resolve()
      .then(function () { return _io && _io.recentVisits ? _io.recentVisits(LOOKBACK_ROWS) : []; })
      .then(function (rows) { _rows = rows || []; _loading = null; return _rows; })
      .catch(function () { _rows = []; _loading = null; return _rows; });
    return _loading;
  }

  function hide() {
    var l = document.getElementById('whoList');
    if (l) { l.className = ''; l.innerHTML = ''; }
  }

  function show(q) {
    ensure();
    var l = document.getElementById('whoList');
    if (!l) return;
    var found = group(_rows || []).filter(function (g) { return matches(g, q); });
    // Somebody owed money first — that is the thing most likely to be acted on
    // while the patient is still standing there — then most recently seen.
    found.sort(function (a, b) {
      if ((b.owed > 0 ? 1 : 0) !== (a.owed > 0 ? 1 : 0)) return (b.owed > 0 ? 1 : 0) - (a.owed > 0 ? 1 : 0);
      return (b.lastAt || 0) - (a.lastAt || 0);
    });
    found = found.slice(0, 5);
    _last = found;
    if (!found.length) { hide(); return; }

    var owing = found.filter(function (g) { return g.owed > 0; }).length;
    l.innerHTML =
      '<div class="who-head">' + found.length + ' already in this clinic’s records' +
        (owing ? ' · ' + owing + ' owing' : '') + '</div>' +
      found.map(rowHTML).join('') +
      '<div class="who-note">Tap one to use their details. Nothing is filled in ' +
        'until you do — two people can share a name.</div>';
    l.className = 'on';

    var rows = l.querySelectorAll('.who-row');
    for (var i = 0; i < rows.length; i++) {
      (function (el) {
        function go() {
          var g = _last[parseInt(el.getAttribute('data-idx'), 10)];
          if (g && _onPick) _onPick(g);
          hide();
        }
        el.onclick = go;
        el.onkeydown = function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        };
      })(rows[i]);
    }
  }

  /* ── Wire it to a box ─────────────────────────────────────────────────────
   * `input` only, and debounced. Nothing runs on focus, so opening the screen
   * costs no request at all; the first keystroke pays for the one fetch. */
  function attach(opts) {
    opts = opts || {};
    var box = document.getElementById(opts.inputId || 'quickPatientName');
    if (!box) return;
    _io = opts.io || _io;
    _onPick = opts.onPick || _onPick;
    ensure();

    if (!document.getElementById('whoList')) {
      var wrap = document.createElement('div');
      wrap.id = 'whoBox';
      var list = document.createElement('div');
      list.id = 'whoList';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Patients already in this clinic’s records');
      wrap.appendChild(list);
      var host = opts.mountAfter
        ? document.getElementById(opts.mountAfter)
        : (box.parentElement || box);
      (host.parentElement || host).insertBefore(wrap, (host.nextSibling || null));
    }

    box.addEventListener('input', function () {
      var q = String(box.value || '').trim();
      clearTimeout(_timer);
      if (q.length < MIN_CHARS) { hide(); return; }
      _timer = setTimeout(function () {
        load().then(function () { show(q); });
      }, DEBOUNCE_MS);
    });
    // Leaving the box does NOT hide the list — the tap that chooses a row is
    // what blurs it, and hiding on blur makes the row impossible to hit on a
    // touch screen. It closes when something is picked, or when the text no
    // longer matches anybody.
  }

  root.HomattWhoIs = {
    attach: attach,
    // for the tests and for anything that wants the same facts
    _group: group, _matches: matches, _normPhone: normPhone, _ago: ago,
    _reset: function () { _rows = null; _loading = null; hide(); },
    _seed: function (rows) { _rows = rows || []; },
    _shown: function () { return _last; }
  };
})(window);
