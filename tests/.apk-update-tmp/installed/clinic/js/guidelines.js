/* Homatt Health — clinical guideline lookup
 *
 * TWO BOOKS, ONE SCREEN
 * ---------------------
 *   • Uganda Clinical Guidelines 2023 (Ministry of Health) — all ages.
 *   • WHO Pocket book of primary health care for children and adolescents
 *     (WHO Regional Office for Europe) — paediatric, and dosed per kilogram
 *     of body weight.
 *
 * The Uganda book is the national standard and stays the default. The
 * children's book is there for the question the UCG cannot answer in one
 * step: "this child weighs 11 kg — how much do I give?" It carries the
 * weight-band dosing tables, so the app never has to calculate a paediatric
 * dose itself; it shows the column the book prints.
 *
 * Offline by construction: both SQLite files and the WASM engine are served
 * from this origin and cached by the service worker on first use, so a clinic
 * with no connection still gets the whole book. The children's book is
 * downloaded only when a clinician first opens that tab — 3 MB is real money
 * on a Ugandan phone, so it is never fetched behind their back.
 *
 * Query discipline (unchanged): we NEVER read a whole book. Every render runs
 * narrow, parameterised statements returning one condition's rows.
 * Autocomplete uses FTS5 and is capped at 12 rows.
 */
(function () {
  'use strict';

  try { if (typeof setupClinicLogout === 'function') setupClinicLogout(); } catch (e) {}

  var BOOKS = {
    ucg: {
      // ?v= is what makes a rebuilt book reach a phone that already has one:
      // the service worker caches these files for good and never re-fetches a
      // URL it already holds. Must match DATA_VERSION in clinic-sw.js.
      url: 'data/uganda_clinical_guidelines_2023.db?v=144',
      name: 'Uganda Clinical Guidelines 2023',
      cite: 'UCG 2023',
      mb: 6,
      db: null,
    },
    who: {
      url: 'data/who_child_2023.db',
      name: 'WHO Pocket book — children and adolescents',
      cite: 'WHO children',
      mb: 3,
      db: null,
    },
  };
  var book = 'ucg';          // which book is being searched
  var mode = 'conditions';   // 'conditions' | 'doses' (children's book only)
  var SQL = null;
  var _sevSel = '';
  var _acItems = [], _acIndex = -1;
  var _weight = '';          // the child's weight, for picking a dose column

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
  function cur() { return BOOKS[book]; }

  // ── Loading a book ──────────────────────────────────────────────────────
  async function engine() {
    if (!SQL) SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
    return SQL;
  }

  async function openBook(key) {
    var b = BOOKS[key];
    if (b.db) return b.db;
    setStatus(key === 'who'
      ? 'Getting the children’s book (about ' + b.mb + ' MB). This happens once — '
        + 'after that it works with no internet.'
      : 'Loading clinical guidelines…');
    await engine();
    var res = await fetch(b.url);
    if (!res.ok) throw new Error('database file not found (' + res.status + ')');
    var buf = await res.arrayBuffer();
    b.db = new SQL.Database(new Uint8Array(buf));
    setStatus('');
    return b.db;
  }

  function badge() {
    var el = $('gDbInfo');
    if (!el) return;
    var b = cur();
    if (!b.db) { el.textContent = ''; return; }
    try {
      if (book === 'who' && mode === 'doses') {
        el.textContent = one('SELECT COUNT(DISTINCT name) n FROM drugs').n +
          ' medicines · by weight · offline';
      } else {
        var m = one('SELECT (SELECT COUNT(*) FROM conditions) c, (SELECT COUNT(*) FROM chapters) ch');
        el.textContent = m.c + ' conditions · ' + m.ch + ' chapters · offline';
      }
    } catch (e) { el.textContent = ''; }
  }

  (async function boot() {
    try {
      await openBook('ucg');
      badge();
      $('gSearch').disabled = false;
      $('gSearch').focus();
    } catch (e) {
      setStatus('Could not open the guidelines database: ' + (e && e.message) +
        '. The app still works once the .db file is bundled at ' + BOOKS.ucg.url, 'error');
    }
  })();

  // ── Tiny query helpers (always parameterised, always narrow) ────────────
  function rows(sql, params) {
    var db = cur().db;
    if (!db) return [];
    var st = db.prepare(sql), out = [];
    try {
      st.bind(params || []);
      while (st.step()) out.push(st.getAsObject());
    } finally { st.free(); }
    return out;
  }
  function one(sql, params) { var r = rows(sql, params); return r.length ? r[0] : null; }

  // ── Autocomplete ────────────────────────────────────────────────────────
  function ftsTokens(term) {
    return String(term).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(Boolean);
  }

  function searchConditions(term) {
    var toks = ftsTokens(term);
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
    return rows(
      'SELECT id, number, title, chapter_title, page FROM conditions ' +
      'WHERE title LIKE ? ORDER BY length(title) LIMIT 12', ['%' + term + '%']);
  }

  // Drug search groups the annex rows by name: one drug, one result, however
  // many formulations the book lists under it.
  function searchDrugs(term) {
    var toks = ftsTokens(term);
    if (!toks.length) return [];
    var q = toks.map(function (t) { return '"' + t + '"*'; }).join(' AND ');
    var out = [];
    try {
      out = rows(
        'SELECT d.name_normalized AS key, MIN(d.name) AS title, ' +
        "GROUP_CONCAT(DISTINCT d.indication) AS chapter_title, COUNT(*) AS n " +
        'FROM drugs_fts f JOIN drugs d ON d.id = f.rowid ' +
        'WHERE drugs_fts MATCH ? GROUP BY d.name_normalized LIMIT 12', [q]);
    } catch (e) { out = []; }
    if (!out.length) {
      out = rows(
        'SELECT name_normalized AS key, MIN(name) AS title, ' +
        "GROUP_CONCAT(DISTINCT indication) AS chapter_title, COUNT(*) AS n " +
        'FROM drugs WHERE name LIKE ? GROUP BY name_normalized ' +
        'ORDER BY length(name) LIMIT 12', ['%' + term + '%']);
    }
    return out.map(function (r) {
      return { id: r.key, number: '', title: r.title, chapter_title: r.chapter_title || '', drug: true };
    });
  }

  function renderAutocomplete(items, term) {
    var box = $('gResults');
    _acItems = items; _acIndex = -1;
    if (!items.length) {
      box.innerHTML = '<div class="g-ac-empty">Nothing in this book matches “' +
        esc(term) + '”.' + (book === 'ucg'
          ? ' Try the children’s book above for a paediatric topic.' : '') + '</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = items.map(function (r, i) {
      return '<div class="g-ac-item" data-i="' + i + '">' +
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
    _t = setTimeout(function () {
      var items = (book === 'who' && mode === 'doses') ? searchDrugs(term) : searchConditions(term);
      renderAutocomplete(items, term);
    }, 120);
  }

  // ── Severity (Uganda book) ──────────────────────────────────────────────
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

  // ── Shared render helpers ───────────────────────────────────────────────
  function section(title, body, opts) {
    if (!body) return '';
    opts = opts || {};
    if (opts.collapsible) {
      return '<details class="g-sec g-collapse"><summary>' + esc(title) +
        '</summary><div class="g-body">' + body + '</div></details>';
    }
    return '<section class="g-sec' + (opts.cls ? ' ' + opts.cls : '') + '"><h3>' +
      esc(title) + '</h3><div class="g-body">' + body + '</div></section>';
  }
  // The WHO text keeps the book's markdown emphasis (*Streptococcus
  // pneumoniae*, **DO NOT**). Asterisks on screen are just noise, so they are
  // stripped for display — the source panel still shows the text untouched.
  function deMark(t) {
    return String(t == null ? '' : t)
      .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
      .replace(/\*+/g, '')
      .replace(/<\/?u>/g, '');
  }
  function asText(t) {
    return '<div class="g-text">' + markSeverity(book === 'who' ? deMark(t) : t) + '</div>';
  }

  // A markdown table, rendered as a table. The book's dosing and differential
  // grids are its densest content — reflowing them into prose would lose the
  // very alignment that makes them readable.
  function mdTable(md) {
    var lines = String(md || '').split('\n').filter(function (l) { return l.trim().indexOf('|') === 0; });
    var out = [], head = true;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
      if (/^[\s\-:|]+$/.test(raw)) { head = false; continue; }
      var cells = raw.split('|').map(function (c) { return c.trim(); });
      if (!cells.join('')) continue;
      var tag = head && !out.length ? 'th' : 'td';
      out.push('<tr>' + cells.map(function (c) {
        return '<' + tag + '>' + esc(c.replace(/\*+/g, '')) + '</' + tag + '>';
      }).join('') + '</tr>');
    }
    if (!out.length) return '';
    return '<div class="g-tablewrap"><table class="g-table g-md">' + out.join('') + '</table></div>';
  }

  // ── Weight bands ────────────────────────────────────────────────────────
  // "3– < 6 kg" / "10– < 15 kg" / "40– < 50 kg" / "Adult".
  function bandRange(band) {
    var s = String(band || '').replace(/\s+/g, ' ');
    var m = s.match(/(\d+(?:\.\d+)?)\s*[–\-]\s*<?\s*(\d+(?:\.\d+)?)\s*kg/);
    if (m) return { lo: parseFloat(m[1]), hi: parseFloat(m[2]) };
    m = s.match(/^\s*<\s*(\d+(?:\.\d+)?)\s*kg/);
    if (m) return { lo: 0, hi: parseFloat(m[1]) };
    m = s.match(/(\d+(?:\.\d+)?)\s*kg\s*(?:and\s*)?(?:above|over|\+)/i);
    if (m) return { lo: parseFloat(m[1]), hi: Infinity };
    if (/adult/i.test(s)) return { lo: 50, hi: Infinity };
    return null;
  }
  function bandMatches(band, kg) {
    if (!(kg > 0)) return false;
    var r = bandRange(band);
    return !!r && kg >= r.lo && kg < r.hi;
  }

  // ── Render: Uganda Clinical Guidelines ──────────────────────────────────
  function renderUcg(id) {
    var c = one(
      'SELECT id, number, title, chapter_number, chapter_title, icd10, page, causes, ' +
      'clinical_features, differential, investigations, management, prevention, ' +
      'complications, notes, full_text FROM conditions WHERE id = ? LIMIT 1', [id]);
    if (!c) return '';

    var tr = rows(
      'SELECT level_of_care, treatment, step_order FROM treatments ' +
      'WHERE condition_id = ? ORDER BY CASE level_of_care WHEN \'HC2\' THEN 1 ' +
      "WHEN 'HC3' THEN 2 WHEN 'HC4' THEN 3 WHEN 'H' THEN 4 WHEN 'GH' THEN 5 " +
      "WHEN 'RR' THEN 6 WHEN 'NR' THEN 7 ELSE 8 END, step_order", [id]);
    var meds = rows(
      'SELECT name, dose, unit, route, frequency, duration FROM medicines ' +
      'WHERE condition_id = ? ORDER BY id', [id]);

    var LOC_LABEL = {
      HC2: 'HC2 — Health Centre II', HC3: 'HC3 — Health Centre III',
      HC4: 'HC4 — Health Centre IV', H: 'H — Hospital', GH: 'GH — General Hospital',
      RR: 'RR — Regional Referral', NR: 'NR — National Referral',
    };

    var html = '<div class="g-head">' +
      '<div class="g-head-num">' + esc(c.number || '') + '</div>' +
      '<h2>' + esc(c.title) + '</h2>' +
      '<div class="g-chips">' +
        (c.chapter_title ? '<span class="g-chip">Ch ' + esc(c.chapter_number || '') + ' · ' + esc(c.chapter_title) + '</span>' : '') +
        // ICD-10 IS DELIBERATELY NOT SHOWN.
        //
        // The code in this database is unreliable: the parser took the first
        // ICD-like token on the page, which usually belongs to a neighbouring
        // condition. Spot-checking twelve well-known conditions, nine were
        // wrong — peptic ulcer disease carried K86.0 (chronic pancreatitis),
        // typhoid A75.9 (typhus), appendicitis K85 (acute pancreatitis),
        // meningitis B45.1 (cryptococcosis), measles A80.3 (polio). 351 of the
        // 535 conditions carry one of these.
        //
        // A wrong ICD-10 on a clinician's screen is worse than none: it goes
        // onto forms, claims and returns. It stays hidden until the codes are
        // rebuilt and verified against the real classification.
        '' +
        (c.page ? '<span class="g-chip">UCG 2023 p.' + esc(c.page) + '</span>' : '') +
        (_sevSel ? '<span class="g-chip sev">' + esc(_sevSel) + '</span>' : '') +
      '</div></div>';

    var sev = severityBlock(c.management || c.full_text);
    if (sev) {
      html += '<section class="g-sec g-sevbox"><h3>Management for ' + esc(_sevSel) +
        ' disease</h3><div class="g-body"><div class="g-text">' + markSeverity(sev) +
        '</div><div class="g-sevnote">Matched from the guideline text for “' + esc(_sevSel) +
        '”. The full management section is below.</div></div></section>';
    }

    html += section('Clinical features', c.clinical_features ? asText(c.clinical_features) : '');
    html += section('Investigations / lab tests', c.investigations ? asText(c.investigations) : '');
    html += section('Management', c.management ? asText(c.management) : '');

    if (tr.length) {
      var byLoc = {}, order = [];
      tr.forEach(function (t) {
        var k = t.level_of_care || 'Unspecified';
        if (!byLoc[k]) { byLoc[k] = []; order.push(k); }
        byLoc[k].push(t);
      });
      html += section('Treatment steps by level of care', order.map(function (k) {
        return '<div class="g-loc"><div class="g-loc-h">' +
          esc(LOC_LABEL[k] || k) + '<span class="g-loc-n">' + byLoc[k].length + ' step' +
          (byLoc[k].length !== 1 ? 's' : '') + '</span></div><ol class="g-steps">' +
          byLoc[k].map(function (t) { return '<li>' + markSeverity(t.treatment) + '</li>'; }).join('') +
          '</ol></div>';
      }).join(''));
    }

    if (meds.length) {
      html += section('Medicines & dosages',
        '<div class="g-tablewrap"><table class="g-table"><thead><tr>' +
        '<th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th>' +
        '</tr></thead><tbody>' + meds.map(function (m) {
          return '<tr><td class="g-md-name">' + esc(m.name) + '</td>' +
            '<td class="g-md-dose">' + esc([m.dose, m.unit].filter(Boolean).join(' ')) + '</td>' +
            '<td>' + esc(m.route || '—') + '</td>' +
            '<td>' + esc(m.frequency || '—') + '</td>' +
            '<td>' + esc(m.duration || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="g-verify">Verify every dose against the source text below before prescribing.</div>');
    }

    html += section('Causes', c.causes ? asText(c.causes) : '', { collapsible: true });
    html += section('Differential diagnosis', c.differential ? asText(c.differential) : '', { collapsible: true });
    html += section('Complications', c.complications ? asText(c.complications) : '', { collapsible: true });
    html += section('Prevention', c.prevention ? asText(c.prevention) : '', { collapsible: true });
    html += section('Notes', c.notes ? asText(c.notes) : '', { collapsible: true });
    html += sourcePanel(c.full_text, 'UCG 2023' + (c.page ? ', p.' + c.page : ''));
    return html;
  }

  // ── Render: WHO children's book ─────────────────────────────────────────
  function renderWho(id) {
    var c = one(
      'SELECT id, number, title, chapter_number, chapter_title, page, age_group, ' +
      'definition, causes, history, examination, clinical_features, differential, ' +
      'investigations, diagnosis, management, treatment, referral, follow_up, ' +
      'prevention, counselling, complications, monitoring, red_flags, cautions, ' +
      'notes, full_text FROM conditions WHERE id = ? LIMIT 1', [id]);
    if (!c) return '';

    var tbls = rows('SELECT number, caption, body_md FROM tables WHERE condition_id = ? ORDER BY id', [id]);
    var linked = rows('SELECT drug_name, name_normalized FROM condition_drugs ' +
                      'WHERE condition_id = ? ORDER BY drug_name', [id]);

    var AGE = { newborn: 'Newborn', adolescent: 'Adolescent', child: 'Child' };
    var html = '<div class="g-head g-head-who">' +
      '<div class="g-head-num">' + esc(c.number || 'WHO') + '</div>' +
      '<h2>' + esc(c.title) + '</h2>' +
      '<div class="g-chips">' +
        (c.chapter_title ? '<span class="g-chip">' + esc(c.chapter_title) + '</span>' : '') +
        '<span class="g-chip icd">' + esc(AGE[c.age_group] || 'Child') + '</span>' +
        (c.page ? '<span class="g-chip">WHO pocket book p.' + esc(c.page) + '</span>' : '') +
      '</div></div>';

    // Safety first, always, and never inside a collapsed panel.
    if (c.cautions) {
      html += '<section class="g-sec g-donot"><h3>Do not</h3><div class="g-body">' +
        '<div class="g-text">' + esc(deMark(c.cautions)) + '</div></section>';
    }
    if (c.red_flags) {
      html += section('Red flags', asText(c.red_flags), { cls: 'g-redflag' });
    }

    html += section('Definition', c.definition ? asText(c.definition) : '');
    html += section('History', c.history ? asText(c.history) : '');
    html += section('Examination', c.examination ? asText(c.examination) : '');
    html += section('Signs and symptoms', c.clinical_features ? asText(c.clinical_features) : '');
    html += section('Investigations', c.investigations ? asText(c.investigations) : '');
    html += section('Diagnosis', c.diagnosis ? asText(c.diagnosis) : '');
    html += section('Treatment', c.treatment ? asText(c.treatment) : '');
    html += section('Management', c.management ? asText(c.management) : '');
    html += section('Referral', c.referral ? asText(c.referral) : '');
    html += section('Follow-up', c.follow_up ? asText(c.follow_up) : '');

    if (linked.length) {
      html += section('Medicines named here — tap for the dose by weight',
        '<div class="g-druglist">' + linked.map(function (d) {
          return '<button type="button" class="g-drugchip" data-drug="' +
            esc(d.name_normalized) + '">' + esc(d.drug_name) + '</button>';
        }).join('') + '</div>' +
        '<div class="g-verify">Doses come from the book’s own table, by body weight. ' +
        'Check the child’s weight before you give anything.</div>');
    }

    if (tbls.length) {
      html += section('Tables from the book', tbls.map(function (t) {
        return (t.caption ? '<div class="g-tblcap">' + esc(t.caption) + '</div>' : '') + mdTable(t.body_md);
      }).join(''));
    }

    html += section('Counselling', c.counselling ? asText(c.counselling) : '', { collapsible: true });
    html += section('Causes', c.causes ? asText(c.causes) : '', { collapsible: true });
    html += section('Differential diagnosis', c.differential ? asText(c.differential) : '', { collapsible: true });
    html += section('Complications', c.complications ? asText(c.complications) : '', { collapsible: true });
    html += section('Prevention', c.prevention ? asText(c.prevention) : '', { collapsible: true });
    html += section('Monitoring', c.monitoring ? asText(c.monitoring) : '', { collapsible: true });
    html += section('Notes', c.notes ? asText(c.notes) : '', { collapsible: true });
    html += sourcePanel(c.full_text, 'WHO pocket book' + (c.page ? ', p.' + c.page : ''));
    return html;
  }

  function sourcePanel(text, cite) {
    return '<details class="g-sec g-collapse g-source" id="gSourcePanel"><summary>' +
      'View source guideline text (' + esc(cite) + ')</summary><div class="g-body">' +
      '<div class="g-srcnote">This is the raw, unparsed section exactly as it appears in ' +
      'the guideline — the authoritative reference for everything above.</div>' +
      '<pre class="g-src">' + esc(text || '(no source text captured for this section)') +
      '</pre></div></details>';
  }

  // ── Render: one drug, dosed by weight ───────────────────────────────────
  function renderDrug(key) {
    var ds = rows('SELECT id, name, indication, dosage, formulation, source_caption, ' +
                  'source_row FROM drugs WHERE name_normalized = ? ORDER BY id', [key]);
    if (!ds.length) return '';
    var kg = parseFloat(_weight);

    var html = '<div class="g-head g-head-who">' +
      '<div class="g-head-num">DOSE BY WEIGHT</div>' +
      '<h2>' + esc(ds[0].name) + '</h2>' +
      '<div class="g-chips"><span class="g-chip icd">WHO pocket book</span>' +
      (kg > 0 ? '<span class="g-chip kg">' + esc(_weight) + ' kg</span>' : '') +
      '</div></div>';

    html += '<section class="g-sec"><h3>Child’s weight</h3><div class="g-body">' +
      '<div class="g-wrow"><input id="gWeight" type="number" inputmode="decimal" min="0" ' +
      'step="0.1" placeholder="e.g. 11" value="' + esc(_weight) + '"><span>kg</span>' +
      '<button type="button" id="gWeightClear" class="g-wclear">Clear</button></div>' +
      '<div class="g-wnote">' + (kg > 0
        ? 'The matching column is highlighted below.'
        : 'Enter the weight and the right column is highlighted for you.') +
      '</div></div></section>';

    ds.forEach(function (d) {
      var doses = rows('SELECT band, dose FROM drug_doses WHERE drug_id = ? ORDER BY band_order', [d.id]);
      var body = '';
      if (d.dosage) body += '<div class="g-dfield"><span>Dosage</span><div>' + esc(deMark(d.dosage)) + '</div></div>';
      if (d.formulation) body += '<div class="g-dfield"><span>Formulation</span><div>' + esc(deMark(d.formulation)) + '</div></div>';
      if (doses.length) {
        body += '<div class="g-tablewrap"><table class="g-table g-doses"><thead><tr>' +
          '<th>Body weight</th><th>Give</th></tr></thead><tbody>' +
          doses.map(function (x) {
            var hit = bandMatches(x.band, kg);
            return '<tr' + (hit ? ' class="g-hit"' : '') + '><td>' +
              esc(x.band || '—') + (hit ? ' <span class="g-tick">this child</span>' : '') +
              '</td><td class="g-md-dose">' + esc(deMark(x.dose)) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      body += '<div class="g-verify">Copied exactly from the book. Where a cell holds ' +
        'more than one figure, they belong to the formulations listed above, in that ' +
        'order. The printed row is below — read it before you give anything.</div>';
      if (d.source_row) {
        body += '<details class="g-rowsrc"><summary>The row as the book prints it</summary>' +
          '<pre class="g-src">' + esc(d.source_row.replace(/\|/g, '\n│ ').trim()) + '</pre>' +
          '</details>';
      }
      html += section(d.indication ? d.name + ' — ' + d.indication : d.name, body);
    });

    var cites = {};
    ds.forEach(function (d) { if (d.source_caption) cites[d.source_caption] = 1; });
    var cite = Object.keys(cites);
    if (cite.length) {
      html += '<div class="g-srcnote" style="padding:0 4px">Source: ' +
        esc(cite.join('; ')) + '.</div>';
    }
    return html;
  }

  // ── Opening a result ────────────────────────────────────────────────────
  function open(id) {
    $('gResults').style.display = 'none';
    if (!cur().db) return;
    var card = $('gCard');
    card.setAttribute('data-cid', id);
    card.setAttribute('data-book', book);
    card.setAttribute('data-mode', mode);
    var html;
    if (book === 'who' && mode === 'doses') html = renderDrug(id);
    else if (book === 'who') html = renderWho(id);
    else html = renderUcg(id);
    if (!html) return;
    card.innerHTML = html;
    card.style.display = 'block';
    $('gEmpty').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function reopen() {
    var id = $('gCard').getAttribute('data-cid');
    if (id) open(book === 'who' && mode === 'doses' ? id : Number(id));
  }

  // ── Switching book / mode ───────────────────────────────────────────────
  function paint() {
    Array.prototype.forEach.call(document.querySelectorAll('.g-book-btn'), function (b) {
      b.classList.toggle('on', b.dataset.book === book);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.g-mode-btn'), function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    $('gModeRow').style.display = book === 'who' ? 'flex' : 'none';
    $('gSevRow').style.display = book === 'ucg' ? 'flex' : 'none';
    $('gSearch').placeholder = (book === 'who' && mode === 'doses')
      ? 'Type a medicine — e.g. amoxicillin, paracetamol…'
      : book === 'who'
        ? 'Type a child’s problem — e.g. cough, diarrhoea, fever…'
        : 'Type a disease or condition — e.g. malaria, pneumonia…';
    var d = $('gWhoNote');
    if (d) d.style.display = book === 'who' ? 'block' : 'none';
    badge();
  }

  async function chooseBook(key) {
    if (book === key) return;
    var prev = book;
    book = key;
    paint();
    if (!BOOKS[key].db) {
      $('gSearch').disabled = true;
      try {
        await openBook(key);
      } catch (e) {
        book = prev;
        paint();
        $('gSearch').disabled = false;
        setStatus('Could not open the children’s book: ' + (e && e.message) +
          '. You need internet the first time only — the Uganda guidelines still work.', 'error');
        return;
      }
      $('gSearch').disabled = false;
    }
    // The open card belongs to the other book; clear it rather than show a
    // condition from a book the clinician is no longer reading.
    $('gCard').style.display = 'none';
    $('gCard').removeAttribute('data-cid');
    $('gEmpty').style.display = 'block';
    $('gResults').style.display = 'none';
    paint();
    var term = $('gSearch').value.trim();
    if (term.length >= 2) onType();
    $('gSearch').focus();
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
      if (pick) { $('gSearch').value = pick.title; open(pick.id); }
    } else if (e.key === 'Escape') {
      box.style.display = 'none';
    }
  });
  $('gResults').addEventListener('click', function (e) {
    var item = e.target.closest && e.target.closest('.g-ac-item');
    if (!item) return;
    var pick = _acItems[Number(item.dataset.i)];
    if (pick) { $('gSearch').value = pick.title; open(pick.id); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.g-searchwrap')) $('gResults').style.display = 'none';
  });

  // Weight box and drug chips live inside the card, which is re-rendered on
  // every change — so they are handled by delegation, not by direct binding.
  $('gCard').addEventListener('input', function (e) {
    if (e.target && e.target.id === 'gWeight') {
      _weight = e.target.value;
      clearTimeout(_t);
      _t = setTimeout(function () {
        var typing = document.activeElement === $('gWeight');
        reopen();
        // The card is rebuilt, so the box the clinician is typing in is a new
        // element. Put the cursor back. (A number input refuses
        // setSelectionRange, so focus is all we ask for.)
        if (typing) { var w = $('gWeight'); if (w) w.focus(); }
      }, 280);
    }
  });
  $('gCard').addEventListener('click', function (e) {
    var clear = e.target.closest && e.target.closest('#gWeightClear');
    if (clear) { _weight = ''; reopen(); return; }
    var chip = e.target.closest && e.target.closest('.g-drugchip');
    if (chip) {
      mode = 'doses';
      paint();
      $('gSearch').value = chip.textContent.trim();
      open(chip.dataset.drug);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.g-book-btn'), function (b) {
    b.addEventListener('click', function () { chooseBook(b.dataset.book); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.g-mode-btn'), function (b) {
    b.addEventListener('click', function () {
      if (mode === b.dataset.mode) return;
      mode = b.dataset.mode;
      $('gCard').style.display = 'none';
      $('gCard').removeAttribute('data-cid');
      $('gEmpty').style.display = 'block';
      paint();
      var term = $('gSearch').value.trim();
      if (term.length >= 2) onType(); else $('gResults').style.display = 'none';
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.g-sev-btn'), function (b) {
    b.addEventListener('click', function () {
      var v = b.dataset.sev;
      _sevSel = (_sevSel === v) ? '' : v;
      Array.prototype.forEach.call(document.querySelectorAll('.g-sev-btn'), function (x) {
        x.classList.toggle('on', x.dataset.sev === _sevSel);
      });
      reopen();
    });
  });

  paint();
})();
