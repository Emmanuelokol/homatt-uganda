/* Homatt Health — Uganda Clinical Guidelines 2023 consultation lookup
 *
 * Offline by construction: the SQLite file (uganda_clinical_guidelines_2023.db)
 * and the SQLite WASM engine are bundled with the app and cached by the service
 * worker, so a clinic with no connectivity still gets the full guideline.
 *
 * Query discipline (per the brief): we NEVER read the whole book. Every render
 * runs narrow, parameterised statements that return only the selected
 * condition's rows — one conditions row, its treatments, its medicines.
 * Autocomplete uses the FTS5 index (conditions_fts) for typo/partial tolerance
 * and is capped at 12 rows.
 */
(function () {
  'use strict';

  // Portal chrome (hamburger, sidebar, theme toggle, exit). Guarded so this
  // page still works standalone if clinic.js hasn't loaded.
  try { if (typeof setupClinicLogout === 'function') setupClinicLogout(); } catch (e) {}

  var DB_URL = 'data/uganda_clinical_guidelines_2023.db';
  var db = null, SQL = null;
  var _sevSel = '';          // '', 'mild', 'moderate', 'severe'
  var _acItems = [], _acIndex = -1;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setStatus(msg, kind) {
    var el = $('gStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
    el.style.color = kind === 'error' ? '#C62828' : 'var(--text-lt)';
  }

  // ── Boot: load the engine + the database file ───────────────────────────
  (async function boot() {
    try {
      setStatus('Loading clinical guidelines…');
      SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(DB_URL);
      if (!res.ok) throw new Error('database file not found (' + res.status + ')');
      var buf = await res.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buf));
      var meta = one('SELECT (SELECT COUNT(*) FROM conditions) c, (SELECT COUNT(*) FROM chapters) ch');
      setStatus('');
      var badge = $('gDbInfo');
      if (badge && meta) badge.textContent = meta.c + ' conditions · ' + meta.ch + ' chapters · offline';
      $('gSearch').disabled = false;
      $('gSearch').focus();
    } catch (e) {
      setStatus('Could not open the guidelines database: ' + (e && e.message) +
        '. The app still works once the .db file is bundled at ' + DB_URL, 'error');
    }
  })();

  // ── Tiny query helpers (always parameterised, always narrow) ────────────
  function rows(sql, params) {
    if (!db) return [];
    var st = db.prepare(sql), out = [];
    try {
      st.bind(params || []);
      while (st.step()) out.push(st.getAsObject());
    } finally { st.free(); }
    return out;
  }
  function one(sql, params) { var r = rows(sql, params); return r.length ? r[0] : null; }

  // ── Autocomplete: FTS5 first (typo/partial tolerant), LIKE as a net ─────
  function ftsQuery(term) {
    // Build a prefix query so "pneu" matches "Pneumonia"; quote each token so
    // punctuation can never break the FTS syntax.
    var toks = String(term).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    var q = toks.map(function (t) { return '"' + t + '"*'; }).join(' AND ');
    var out = [];
    try {
      out = rows(
        'SELECT c.id, c.number, c.title, c.chapter_title, c.page ' +
        'FROM conditions_fts f JOIN conditions c ON c.id = f.rowid ' +
        'WHERE conditions_fts MATCH ? ORDER BY rank LIMIT 12', [q]);
    } catch (e) { out = []; }
    if (out.length) return out;
    // Fallback: plain substring match on the title (also covers 1-2 letter input)
    return rows(
      'SELECT id, number, title, chapter_title, page FROM conditions ' +
      'WHERE title LIKE ? ORDER BY length(title) LIMIT 12', ['%' + term + '%']);
  }

  function renderAutocomplete(items, term) {
    var box = $('gResults');
    _acItems = items; _acIndex = -1;
    if (!items.length) {
      box.innerHTML = '<div class="g-ac-empty">No condition matches “' + esc(term) + '”.</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = items.map(function (r, i) {
      return '<div class="g-ac-item" data-i="' + i + '" data-id="' + r.id + '">' +
        '<span class="g-ac-num">' + esc(r.number || '') + '</span>' +
        '<span class="g-ac-title">' + esc(r.title) + '</span>' +
        '<span class="g-ac-ch">' + esc(r.chapter_title || '') + '</span></div>';
    }).join('');
    box.style.display = 'block';
  }

  var _t;
  function onType() {
    clearTimeout(_t);
    var term = $('gSearch').value.trim();
    if (term.length < 2) { $('gResults').style.display = 'none'; return; }
    _t = setTimeout(function () { renderAutocomplete(ftsQuery(term), term); }, 120);
  }

  // ── Severity: highlight the matching management block when present ──────
  var SEV_RE = {
    mild:     /\b(mild|uncomplicated|simple)\b/i,
    moderate: /\b(moderate|moderately)\b/i,
    severe:   /\b(severe|severely|complicated|very severe|critical|emergency)\b/i,
  };
  function severityBlock(text) {
    if (!_sevSel || !text) return null;
    var rx = SEV_RE[_sevSel];
    if (!rx) return null;
    var lines = String(text).split('\n'), hit = [], on = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var isHead = l.length < 90 && rx.test(l);
      var otherHead = l.length < 90 && !isHead &&
        (SEV_RE.mild.test(l) || SEV_RE.moderate.test(l) || SEV_RE.severe.test(l));
      if (isHead) { on = true; hit.push(l); continue; }
      if (on && otherHead) { on = false; continue; }
      if (on) hit.push(l);
    }
    var txt = hit.join('\n').trim();
    return txt.length > 20 ? txt : null;
  }
  function markSeverity(text) {
    var safe = esc(text);
    if (!_sevSel) return safe;
    var rx = new RegExp('(' + SEV_RE[_sevSel].source.replace(/^\\b|\\b$/g, '') + ')', 'gi');
    return safe.replace(rx, '<mark class="g-mark">$1</mark>');
  }

  // ── Render one consultation card ────────────────────────────────────────
  function section(title, body, opts) {
    if (!body) return '';
    opts = opts || {};
    var id = 'sec-' + Math.random().toString(36).slice(2, 8);
    if (opts.collapsible) {
      return '<details class="g-sec g-collapse"><summary>' + esc(title) +
        '</summary><div class="g-body">' + body + '</div></details>';
    }
    return '<section class="g-sec"><h3>' + esc(title) + '</h3><div class="g-body" id="' + id + '">' +
      body + '</div></section>';
  }
  function asText(t) { return '<div class="g-text">' + markSeverity(t) + '</div>'; }

  function openCondition(id) {
    $('gResults').style.display = 'none';
    $('gCard').setAttribute('data-cid', id);   // remembered for severity re-render
    if (!db) return;

    // ONE condition row — never the whole table.
    var c = one(
      'SELECT id, number, title, chapter_number, chapter_title, icd10, page, causes, ' +
      'clinical_features, differential, investigations, management, prevention, ' +
      'complications, notes, full_text FROM conditions WHERE id = ? LIMIT 1', [id]);
    if (!c) return;

    // Its treatment steps, grouped by level of care.
    var tr = rows(
      'SELECT level_of_care, treatment, step_order FROM treatments ' +
      'WHERE condition_id = ? ORDER BY CASE level_of_care WHEN \'HC2\' THEN 1 ' +
      "WHEN 'HC3' THEN 2 WHEN 'HC4' THEN 3 WHEN 'H' THEN 4 WHEN 'GH' THEN 5 " +
      "WHEN 'RR' THEN 6 WHEN 'NR' THEN 7 ELSE 8 END, step_order", [id]);

    // Its medicines.
    var meds = rows(
      'SELECT name, dose, unit, route, frequency, duration FROM medicines ' +
      'WHERE condition_id = ? ORDER BY id', [id]);

    var LOC_LABEL = {
      HC2: 'HC2 — Health Centre II', HC3: 'HC3 — Health Centre III',
      HC4: 'HC4 — Health Centre IV', H: 'H — Hospital', GH: 'GH — General Hospital',
      RR: 'RR — Regional Referral', NR: 'NR — National Referral',
    };

    var html = '';

    // 1. Condition header
    html += '<div class="g-head">' +
      '<div class="g-head-num">' + esc(c.number || '') + '</div>' +
      '<h2>' + esc(c.title) + '</h2>' +
      '<div class="g-chips">' +
        (c.chapter_title ? '<span class="g-chip">Ch ' + esc(c.chapter_number || '') + ' · ' + esc(c.chapter_title) + '</span>' : '') +
        (c.icd10 ? '<span class="g-chip icd">ICD-10 ' + esc(c.icd10) + '</span>' : '') +
        (c.page ? '<span class="g-chip">UCG 2023 p.' + esc(c.page) + '</span>' : '') +
        (_sevSel ? '<span class="g-chip sev">' + esc(_sevSel) + '</span>' : '') +
      '</div></div>';

    // Severity-specific management, surfaced first when we find one
    var sev = severityBlock(c.management || c.full_text);
    if (sev) {
      html += '<section class="g-sec g-sevbox"><h3>Management for ' + esc(_sevSel) +
        ' disease</h3><div class="g-body"><div class="g-text">' + markSeverity(sev) +
        '</div><div class="g-sevnote">Matched from the guideline text for “' + esc(_sevSel) +
        '”. The full management section is below.</div></div></section>';
    }

    // 2–4. Clinical features / Investigations / Management
    html += section('Clinical features', c.clinical_features ? asText(c.clinical_features) : '');
    html += section('Investigations / lab tests', c.investigations ? asText(c.investigations) : '');
    html += section('Management', c.management ? asText(c.management) : '');

    // 5. Treatment steps by level of care
    if (tr.length) {
      var byLoc = {}, order = [];
      tr.forEach(function (t) {
        var k = t.level_of_care || 'Unspecified';
        if (!byLoc[k]) { byLoc[k] = []; order.push(k); }
        byLoc[k].push(t);
      });
      var body = order.map(function (k) {
        return '<div class="g-loc"><div class="g-loc-h">' +
          esc(LOC_LABEL[k] || k) + '<span class="g-loc-n">' + byLoc[k].length + ' step' +
          (byLoc[k].length !== 1 ? 's' : '') + '</span></div><ol class="g-steps">' +
          byLoc[k].map(function (t) {
            return '<li>' + markSeverity(t.treatment) + '</li>';
          }).join('') + '</ol></div>';
      }).join('');
      html += section('Treatment steps by level of care', body);
    }

    // 6. Medicines & dosages
    if (meds.length) {
      var tbl = '<div class="g-tablewrap"><table class="g-table"><thead><tr>' +
        '<th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th>' +
        '</tr></thead><tbody>' +
        meds.map(function (m) {
          return '<tr><td class="g-md-name">' + esc(m.name) + '</td>' +
            '<td class="g-md-dose">' + esc([m.dose, m.unit].filter(Boolean).join(' ')) + '</td>' +
            '<td>' + esc(m.route || '—') + '</td>' +
            '<td>' + esc(m.frequency || '—') + '</td>' +
            '<td>' + esc(m.duration || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="g-verify">Verify every dose against the source text below before prescribing.</div>';
      html += section('Medicines & dosages', tbl);
    }

    // 7. Collapsible extras
    html += section('Causes', c.causes ? asText(c.causes) : '', { collapsible: true });
    html += section('Differential diagnosis', c.differential ? asText(c.differential) : '', { collapsible: true });
    html += section('Complications', c.complications ? asText(c.complications) : '', { collapsible: true });
    html += section('Prevention', c.prevention ? asText(c.prevention) : '', { collapsible: true });
    html += section('Notes', c.notes ? asText(c.notes) : '', { collapsible: true });

    // 8. Source text — ALWAYS present, never hidden
    html += '<details class="g-sec g-collapse g-source" id="gSourcePanel"><summary>' +
      'View source guideline text (UCG 2023' + (c.page ? ', p.' + esc(c.page) : '') + ')' +
      '</summary><div class="g-body"><div class="g-srcnote">This is the raw, unparsed section ' +
      'exactly as it appears in the guideline — the authoritative reference for everything above.' +
      '</div><pre class="g-src">' + esc(c.full_text || '(no source text captured for this section)') +
      '</pre></div></details>';

    $('gCard').innerHTML = html;
    $('gCard').style.display = 'block';
    $('gEmpty').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  $('gSearch').addEventListener('input', onType);
  $('gSearch').addEventListener('focus', onType);
  $('gSearch').addEventListener('keydown', function (e) {
    var box = $('gResults');
    if (box.style.display === 'none' || !_acItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      _acIndex += (e.key === 'ArrowDown' ? 1 : -1);
      if (_acIndex < 0) _acIndex = _acItems.length - 1;
      if (_acIndex >= _acItems.length) _acIndex = 0;
      Array.prototype.forEach.call(box.children, function (el, i) {
        el.classList.toggle('active', i === _acIndex);
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var pick = _acIndex >= 0 ? _acItems[_acIndex] : _acItems[0];
      if (pick) { $('gSearch').value = pick.title; openCondition(pick.id); }
    } else if (e.key === 'Escape') {
      box.style.display = 'none';
    }
  });
  $('gResults').addEventListener('click', function (e) {
    var item = e.target.closest && e.target.closest('.g-ac-item');
    if (!item) return;
    var pick = _acItems[Number(item.dataset.i)];
    if (pick) { $('gSearch').value = pick.title; openCondition(pick.id); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.g-searchwrap')) $('gResults').style.display = 'none';
  });
  Array.prototype.forEach.call(document.querySelectorAll('.g-sev-btn'), function (b) {
    b.addEventListener('click', function () {
      var v = b.dataset.sev;
      _sevSel = (_sevSel === v) ? '' : v;
      Array.prototype.forEach.call(document.querySelectorAll('.g-sev-btn'), function (x) {
        x.classList.toggle('on', x.dataset.sev === _sevSel);
      });
      // Re-render the open condition so the severity block/highlight updates.
      var open = $('gCard').getAttribute('data-cid');
      if (open) openCondition(Number(open));
    });
  });
})();
