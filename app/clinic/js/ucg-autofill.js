/* Homatt Health — One-tap standard package (UCG 2023 auto-fill)
 *
 * The clinician confirms a diagnosis and taps ONE button. This opens a
 * worksheet pre-filled from the Uganda Clinical Guidelines 2023: the
 * investigations to run, the medicines with dose/frequency/duration/quantity,
 * the follow-up interval, and the charges. Everything is editable, every row
 * has an [×], and a [+] adds another test, drug or condition.
 *
 * It LEARNS: when the clinician changes a package, the app asks before saving
 * it as the clinic's standard for that condition+severity. Next time the same
 * case comes up it auto-fills the learned version — including the money.
 *
 * Fully offline: the guideline database and SQLite engine are bundled, and the
 * learned packages live in local storage (mirrored to the sync outbox so they
 * follow the clinic to other devices).
 */
(function () {
  'use strict';

  var DB_URL = 'data/uganda_clinical_guidelines_2023.db';
  var EM_URL = 'data/emhslu_2023.db';       // national essential medicines list
  var db = null, loading = null;
  var emdb = null, emLoading = null;
  var state = null;              // the wizard's state object
  var pkg = null;                // the package being edited
  var srcPkg = null;             // what was auto-filled (to detect edits)
  var ctx = { conditionId: null, title: '', severity: '', page: null, learned: false };

  var LEVELS = ['HC1', 'HC2', 'HC3', 'HC4', 'H', 'RR', 'NR'];

  // How the visit was settled. Mirrors the chips on the wizard's second screen
  // so the money can be closed off without leaving the package.
  var PAY_OPTS = [
    { k: 'paid',    label: 'Paid',    icon: '\u2713', hint: 'Money received in full — goes into Money In today.' },
    { k: 'pending', label: 'Pending', icon: '\u23F3', hint: 'Not paid yet — shows under Pending Payments.' },
    { k: 'credit',  label: 'Credit',  icon: '\uD83D\uDCCB', hint: 'On credit — shows under Pending Payments until paid.' },
    { k: 'waived',  label: 'Waived',  icon: '\uD83E\uDD1D', hint: 'No charge — nothing owed, nothing collected.' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }

  // ── Database (lazy: only opened when the clinician asks for a package) ────
  function openDb() {
    if (db) return Promise.resolve(db);
    if (loading) return loading;
    loading = (async function () {
      if (typeof initSqlJs !== 'function') throw new Error('SQLite engine not loaded');
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(DB_URL);
      if (!res.ok) throw new Error('guideline database not found');
      db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      return db;
    })();
    return loading;
  }
  // The Essential Medicines & Health Supplies List for Uganda (EMHSLU 2023) is
  // the national formulary: official name, form, strength, the LEVEL of facility
  // allowed to stock it, and its VEN class (Vital/Essential/Necessary).
  function openEm() {
    if (emdb) return Promise.resolve(emdb);
    if (emLoading) return emLoading;
    emLoading = (async function () {
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(EM_URL);
      if (!res.ok) throw new Error('EMHSLU database not found');
      emdb = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      return emdb;
    })();
    return emLoading;
  }
  function emRows(sql, params) {
    if (!emdb) return [];
    var st = emdb.prepare(sql), out = [];
    try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); }
    finally { st.free(); }
    return out;
  }
  // What level is this clinic? Used to flag drugs above the facility's level.
  function myLevel() {
    try {
      var s = JSON.parse(localStorage.getItem('clinic_session') || '{}');
      return (s.level || s.facilityLevel || '').toUpperCase() || null;
    } catch (e) { return null; }
  }

  function rows(sql, params) {
    if (!db) return [];
    var st = db.prepare(sql), out = [];
    try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); }
    finally { st.free(); }
    return out;
  }

  // ── Learned packages (offline-first) ─────────────────────────────────────
  function clinicId() {
    try { return (JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId) || 'local'; }
    catch (e) { return 'local'; }
  }
  function storeKey() { return 'ucg_packages_' + clinicId(); }
  function allLearned() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || '{}'); } catch (e) { return {}; }
  }
  function learnKey(condId, sev) {
    // Free-text conditions (not in the guidelines) are keyed by their name so
    // the clinic's own package is found again next time.
    var base = condId ? String(condId) : 'free:' + String(ctx.title || '').toLowerCase().trim();
    return base + '|' + (sev || 'any');
  }
  function getLearned(condId, sev) {
    var all = allLearned();
    return all[learnKey(condId, sev)] || all[learnKey(condId, 'any')] || null;
  }
  function saveLearned(condId, sev, p) {
    var all = allLearned();
    var k = learnKey(condId, sev);
    var prev = all[k];
    all[k] = {
      title: ctx.title, severity: sev || 'any',
      tests: p.tests.slice(), drugs: JSON.parse(JSON.stringify(p.drugs)),
      fees: { consult: p.fees.consult, lab: p.fees.lab, meds: p.fees.meds },
      followUpDays: p.followUpDays,
      uses: (prev && prev.uses || 0) + 1,
      updated: new Date().toISOString(),
    };
    try { localStorage.setItem(storeKey(), JSON.stringify(all)); } catch (e) {}
    // Mirror to the clinic's other devices when a sync path exists.
    try {
      var CO = window.ClinicOffline;
      if (CO && CO.enqueue) {
        CO.enqueue('table_upsert', {
          table: 'clinic_care_packages',
          rows: [{
            clinic_id: clinicId(), condition_id: String(condId), severity: sev || 'any',
            title: ctx.title, package: all[k],
          }],
          onConflict: 'clinic_id,condition_id,severity',
        });
      }
    } catch (e) {}
  }

  // ── Build a package from the guideline ───────────────────────────────────
  var TEST_HINTS = ['RDT', 'smear', 'microscopy', 'culture', 'x-ray', 'xray', 'ultrasound',
    'CBC', 'FBC', 'ESR', 'CRP', 'glucose', 'sugar', 'urinalysis', 'stool', 'HIV',
    'widal', 'LFT', 'RFT', 'electrolyte', 'biopsy', 'ECG', 'blood', 'test', 'scan', 'count'];

  function extractTests(investigations, fullText) {
    var src = investigations || '';
    if (!src && fullText) {
      var m = /investigations?\s*[:\n]([\s\S]{0,700})/i.exec(fullText);
      src = m ? m[1] : '';
    }
    var out = [], seen = {};
    src.split('\n').forEach(function (raw) {
      var l = raw.replace(/^[\s•~\-–•]+/, '').trim();
      if (l.length < 3 || l.length > 90) return;
      if (!TEST_HINTS.some(function (h) { return l.toLowerCase().indexOf(h.toLowerCase()) >= 0; })) return;
      l = l.replace(/^(do|perform|order|take|check|obtain)\s+(a|an|the)?\s*/i, '').trim();
      l = l.charAt(0).toUpperCase() + l.slice(1);
      var k = l.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1; out.push(l);
      });
    return out.slice(0, 8);
  }

  // frequency text → times/day (so quantity can be computed)
  function freqPerDay(f) {
    var s = String(f || '').toLowerCase();
    if (/once|\bod\b|daily(?!.*\d)/.test(s) && !/twice|three|thrice/.test(s)) return 1;
    if (/twice|\bbd\b|12\s*hourly|every\s*12/.test(s)) return 2;
    if (/thrice|three times|\btds\b|8\s*hourly|every\s*8/.test(s)) return 3;
    if (/four times|\bqid\b|6\s*hourly|every\s*6/.test(s)) return 4;
    var m = /(\d+)\s*(?:times|x)\s*(?:a|per)?\s*day/.exec(s);
    if (m) return Math.min(6, Number(m[1]) || 2);
    return 2;
  }
  function durDays(d) {
    var m = /(\d+)/.exec(String(d || ''));
    return m ? Math.min(90, Number(m[1])) : 5;
  }

  function buildFromGuideline(condId, sev) {
    var c = rows('SELECT id,title,page,causes,clinical_features,differential,investigations,' +
      'management,complications,prevention,notes,full_text FROM conditions WHERE id=? LIMIT 1', [condId])[0];
    if (!c) return null;
    ctx.info = {
      causes: c.causes, clinical_features: c.clinical_features, differential: c.differential,
      investigations: c.investigations, management: c.management, complications: c.complications,
      prevention: c.prevention, notes: c.notes, full_text: c.full_text,
    };
    var meds = rows('SELECT name,dose,unit,route,frequency,duration FROM medicines WHERE condition_id=? ORDER BY id LIMIT 12', [condId]);
    // Prefer medicines whose source line matches the chosen severity.
    var drugs = meds.map(function (m) {
      var tpd = freqPerDay(m.frequency), dd = durDays(m.duration);
      return {
        drug: m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : ''),
        dosage: (m.dose ? m.dose + (m.unit || '') : '') + (m.route ? ' ' + m.route : ''),
        timesPerDay: tpd, durationDays: dd,
        qty: tpd * dd,
        from: 'guideline',
      };
    }).filter(function (d, i, a) {
      return a.findIndex(function (x) { return x.drug.toLowerCase() === d.drug.toLowerCase(); }) === i;
    }).slice(0, 6);
    return {
      tests: extractTests(c.investigations, c.full_text),
      drugs: drugs,
      fees: { consult: 0, lab: 0, meds: 0 },
      paymentStatus: 'pending',
      followUpDays: 7,
      page: c.page, title: c.title,
    };
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function ensurePanel() {
    if (document.getElementById('ucgPanel')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#ucgOverlay{display:none;position:fixed;inset:0;background:rgba(10,20,16,.55);z-index:900;align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}',
      '#ucgPanel{background:var(--bg);width:100%;max-width:640px;max-height:94vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;overflow:hidden}',
      '.ucg-top{background:linear-gradient(140deg,#0B3D2E,#10855F 60%,#17A46F);color:#fff;padding:16px 18px;flex:none}',
      '.ucg-top .k{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.85}',
      '.ucg-top h3{font-size:19px;font-weight:800;margin:2px 0 8px;letter-spacing:-.02em}',
      '.ucg-tags{display:flex;flex-wrap:wrap;gap:6px}',
      '.ucg-tag{font-size:10.5px;font-weight:700;background:rgba(255,255,255,.18);padding:3px 9px;border-radius:999px}',
      '.ucg-tag.learn{background:#FFE0B2;color:#7A4F01}',
      '.ucg-body{overflow-y:auto;padding:14px;flex:1;-webkit-overflow-scrolling:touch}',
      '.ucg-block{background:var(--surface);border-radius:16px;box-shadow:var(--shadow);margin-bottom:12px;overflow:hidden}',
      '.ucg-bh{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--border)}',
      '.ucg-step{width:24px;height:24px;border-radius:8px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;font-size:12px;font-weight:800;display:grid;place-items:center;flex:none}',
      '.ucg-bh h4{font-size:13.5px;font-weight:800;flex:1;color:var(--text)}',
      '.ucg-count{font-size:11px;font-weight:700;color:var(--text-lt)}',
      '.ucg-rows{padding:10px 12px}',
      '.ucg-chip{display:inline-flex;align-items:center;gap:7px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;border-radius:999px;padding:7px 8px 7px 13px;font-size:12.5px;font-weight:700;margin:0 6px 6px 0}',
      '.ucg-x{border:none;background:rgba(0,0,0,.10);color:inherit;width:19px;height:19px;border-radius:50%;font-size:13px;line-height:1;cursor:pointer;display:grid;place-items:center;flex:none;font-family:inherit}',
      '.ucg-x:hover{background:#E0454B;color:#fff}',
      '.ucg-drug{display:flex;align-items:center;gap:9px;padding:9px;border-radius:12px;background:var(--bg);margin-bottom:8px}',
      '.ucg-drug .nm{flex:1;min-width:0}',
      '.ucg-drug .nm b{font-size:13.5px;font-weight:800;color:var(--text);display:block;line-height:1.25}',
      '.ucg-drug .nm span{font-size:11px;color:var(--text-lt)}',
      '.ucg-num{width:44px;text-align:center;border:1.5px solid var(--border);border-radius:9px;padding:6px 2px;font:inherit;font-size:13px;font-weight:700;background:var(--surface);color:var(--text)}',
      '.ucg-lbl{font-size:9.5px;font-weight:700;color:var(--text-lt);text-transform:uppercase;letter-spacing:.4px;text-align:center;display:block;margin-bottom:2px}',
      '.ucg-add{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;background:linear-gradient(135deg,#7C6CF0,#5B49D6);color:#fff;border-radius:13px;padding:12px 18px;font:inherit;font-size:13.5px;font-weight:800;cursor:pointer;margin-top:8px;box-shadow:0 6px 14px rgba(108,92,231,.30);touch-action:manipulation}',
      '.ucg-add:active{transform:scale(.98)}',
      '.ucg-money{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;padding:12px}',
      '.ucg-money label{font-size:10px;font-weight:800;color:var(--text-lt);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:4px}',
      '.ucg-money input{width:100%;border:1.5px solid var(--border);border-radius:11px;padding:10px;font:inherit;font-size:15px;font-weight:700;background:var(--surface);color:var(--text);text-align:right}',
      '.ucg-total{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;border-top:1px solid var(--border);font-size:13px;font-weight:800;color:var(--text)}',
      '.ucg-total b{font-size:18px;color:#0E7C5A;letter-spacing:-.02em}',
      '.ucg-foot{flex:none;padding:12px 14px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:9px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}',
      '.ucg-btn{flex:1;border:none;border-radius:14px;padding:14px;font:inherit;font-size:14.5px;font-weight:800;cursor:pointer}',
      '.ucg-btn.ghost{background:var(--bg);color:var(--text-lt);flex:0 0 34%}',
      '.ucg-btn.go{background:linear-gradient(135deg,#17936B,#0C6A4C);color:#fff;box-shadow:0 8px 18px rgba(14,124,90,.3)}',
      '.ucg-src{font-size:11px;color:var(--text-lt);padding:2px 2px 10px}',
      '#ucgSearchWrap{padding:0 12px 12px}',
      '#ucgSearchWrap input{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:11px 13px;font:inherit;font-size:15px;background:var(--surface);color:var(--text)}',
      '#ucgSearchRes,#ucgTestRes{background:var(--surface);border-radius:12px;box-shadow:var(--shadow);max-height:260px;overflow-y:auto;display:none;margin-top:8px;border:1.5px solid var(--brand-tint,#DBF4EA)}',
      '#ucgSearchRes div,#ucgTestRes div{padding:11px 13px;font-size:13.5px;cursor:pointer;border-bottom:1px solid var(--border)}',
      '#ucgSearchRes div:hover,#ucgTestRes div:hover{background:var(--brand-tint,#DBF4EA)}',
      '.ucg-ask{position:fixed;inset:0;background:rgba(10,20,16,.6);z-index:950;display:none;align-items:center;justify-content:center;padding:20px}',
      '.ucg-ask-card{background:var(--surface);border-radius:20px;max-width:420px;width:100%;padding:20px;box-shadow:var(--shadow-lg)}',
      '.ucg-ask-card h4{font-size:16px;font-weight:800;margin-bottom:6px;color:var(--text)}',
      '.ucg-ask-card p{font-size:13px;color:var(--text-lt);line-height:1.5;margin-bottom:10px}',
      '.ucg-diff{background:var(--bg);border-radius:12px;padding:10px 12px;font-size:12.5px;color:var(--text);margin-bottom:14px;max-height:180px;overflow-y:auto}',
      '.ucg-diff div{padding:2px 0}',
      '.em-tag{display:inline-block;margin-left:6px;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;vertical-align:1px}',
      '.em-tag.warn{background:#FCEFCF;color:#8A5A06}',
      '.em-tag.ven-V{background:#FBE1DE;color:#B3261E}',
      '.em-tag.ven-E{background:#DBEFFB;color:#0B5C8A}',
      '.em-tag.ven-N{background:var(--bg);color:var(--text-lt)}',
      '.ucg-paylbl{margin:14px 0 7px;font-size:10.5px;font-weight:800;color:var(--text-lt);letter-spacing:.6px;text-transform:uppercase}',
      '.ucg-pay{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.ucg-paychip{padding:12px 8px;border:1.5px solid var(--border);border-radius:14px;background:var(--surface,#fff);'
        + 'font:inherit;font-size:13.5px;font-weight:700;color:var(--text);cursor:pointer;text-align:center}',
      '.ucg-paychip.on{border-color:#0E7C5A;background:var(--brand-tint,#DBF4EA);color:#0A5C43;box-shadow:0 0 0 3px rgba(14,124,90,.10)}',
      '.ucg-payhint{margin-top:8px;font-size:12px;line-height:1.45;color:var(--text-lt)}',
      '.em-src{float:right;font-size:9.5px;font-weight:800;color:var(--text-lt);letter-spacing:.06em;margin-top:3px}',
      '.ucg-det{border-radius:12px;background:var(--bg);margin-bottom:7px;overflow:hidden}',
      '.ucg-det summary{display:flex;align-items:center;gap:9px;padding:12px 13px;cursor:pointer;list-style:none;font-size:13px;font-weight:700;color:var(--text)}',
      '.ucg-det summary::-webkit-details-marker{display:none}',
      '.ucg-det summary .material-icons-outlined{font-size:18px;color:#0E7C5A;flex:none}',
      '.ucg-det summary .chev{margin-left:auto;color:var(--text-lt);transition:transform .18s}',
      '.ucg-det[open] summary .chev{transform:rotate(180deg)}',
      '.ucg-det-b{padding:0 13px 13px;font-size:13px;line-height:1.55;color:var(--text);white-space:pre-line;max-height:44vh;overflow-y:auto}',
    ].join('\n');
    document.head.appendChild(css);

    var ov = document.createElement('div');
    ov.id = 'ucgOverlay';
    ov.innerHTML =
      '<div id="ucgPanel">' +
        '<div class="ucg-top">' +
          '<div class="k" id="ucgKicker">Standard package</div>' +
          '<h3 id="ucgTitle">—</h3>' +
          '<div class="ucg-tags" id="ucgTags"></div>' +
        '</div>' +
        '<div class="ucg-body" id="ucgBody"></div>' +
        '<div class="ucg-foot" style="flex-wrap:wrap">' +
          '<button class="ucg-btn ghost" id="ucgCancel" style="flex:0 0 auto;padding-left:16px;padding-right:16px">Cancel</button>' +
          '<button class="ucg-btn ghost" id="ucgApply" style="flex:1 1 40%">Apply &amp; review</button>' +
          '<button class="ucg-btn go" id="ucgSave" style="flex:1 1 100%">Save consultation</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var ask = document.createElement('div');
    ask.className = 'ucg-ask'; ask.id = 'ucgAsk';
    ask.innerHTML =
      '<div class="ucg-ask-card">' +
        '<h4 id="ucgAskTitle">Save as your clinic standard?</h4>' +
        '<p id="ucgAskText"></p>' +
        '<div class="ucg-diff" id="ucgAskDiff"></div>' +
        '<div style="display:flex;gap:9px">' +
          '<button class="ucg-btn ghost" id="ucgAskNo" style="flex:1">Not now</button>' +
          '<button class="ucg-btn go" id="ucgAskYes" style="flex:1">Save standard</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ask);

    document.getElementById('ucgCancel').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('ucgApply').onclick = apply;
    document.getElementById('ucgSave').onclick = applyAndSave;
  }

  // "Save consultation" — the whole point of a one-tap package. Apply it and
  // record the consultation, full stop.
  //
  // The phone number is OPTIONAL: a walk-in is identified by the case number
  // (#001M2208O) from the moment they are seen, and the name and contact are
  // filled in afterwards. This used to divert to the phone box, which defeated
  // the entire one-tap idea.
  function applyAndSave() {
    applyToWizard();
    close();
    // The clinic still gets asked whether to learn the changes — but the
    // consultation is saved either way, so the question can never swallow it.
    var changes = changeSummary();
    if (!changes.length) { _finishSave(); return; }
    askToLearn(changes, _finishSave);
  }

  function _finishSave() {
    try { if (window._showStep) window._showStep(2); } catch (e) {}
    var btn = document.getElementById('submitBtn');
    if (!btn) { toast('Could not find the save button — press Send below.', 'error'); return; }
    try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    setTimeout(function () { try { btn.click(); } catch (e) {} }, 250);
  }

  // The learn prompt, shared by "Apply & review" and "Save consultation".
  // `then` runs after either answer.
  function askToLearn(changes, then) {
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent =
      ctx.learned ? 'Update your clinic standard?' : 'Save as your clinic standard?';
    document.getElementById('ucgAskText').textContent =
      'You changed this package for ' + ctx.title +
      (ctx.severity ? ' (' + ctx.severity + ')' : '') +
      '. Should the app auto-fill it this way next time?';
    document.getElementById('ucgAskDiff').innerHTML =
      changes.map(function (c) { return '<div>' + esc(c) + '</div>'; }).join('');
    document.getElementById('ucgAskYes').textContent = ctx.learned ? 'Update standard' : 'Save standard';
    ask.style.display = 'flex';
    document.getElementById('ucgAskNo').onclick = function () {
      ask.style.display = 'none';
      if (then) then();
    };
    document.getElementById('ucgAskYes').onclick = function () {
      saveLearned(ctx.conditionId, ctx.severity, pkg);
      ask.style.display = 'none';
      toast('Saved — this is now your standard for ' + ctx.title, 'success');
      if (then) then();
    };
  }

  function close() { var o = document.getElementById('ucgOverlay'); if (o) o.style.display = 'none'; }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    var b = document.getElementById('ucgBody');
    var totalQty = pkg.drugs.reduce(function (s, d) { return s + (Number(d.qty) || 0); }, 0);
    b.innerHTML =
      '<div class="ucg-src">From the Uganda Clinical Guidelines 2023' +
        (ctx.page ? ' · p.' + esc(ctx.page) : '') +
        '. Everything below is editable — remove with ×, add with +.</div>' +

      // ① Investigations
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">1</span>' +
        '<h4>Investigations / lab tests</h4><span class="ucg-count">' + pkg.tests.length + '</span></div>' +
        '<div class="ucg-rows" id="ucgTests">' +
          (pkg.tests.length ? pkg.tests.map(function (t, i) {
            return '<span class="ucg-chip">' + esc(t) +
              '<button class="ucg-x" data-rmtest="' + i + '" title="Remove">×</button></span>';
          }).join('') : '<div style="font-size:12.5px;color:var(--text-lt);padding:2px 0 6px">No tests suggested — add one.</div>') +
          '<div><button class="ucg-add" id="ucgAddTest">+ Add test</button></div>' +
        '</div></div>' +

      // ② Medicines
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">2</span>' +
        '<h4>Medicines &amp; dosage</h4><span class="ucg-count">' + pkg.drugs.length +
        ' · ' + totalQty + ' units</span></div>' +
        '<div class="ucg-rows" id="ucgDrugs">' +
          (pkg.drugs.length ? pkg.drugs.map(function (d, i) {
            return '<div class="ucg-drug">' +
              '<div class="nm"><b>' + esc(d.drug) + '</b><span>' + esc(d.dosage || '') +
                (d.from === 'learned' ? ' · your standard' : '') + '</span></div>' +
              '<div><span class="ucg-lbl">×/day</span>' +
                '<input class="ucg-num" type="number" min="1" max="6" value="' + (d.timesPerDay || 2) + '" data-fd="' + i + '"></div>' +
              '<div><span class="ucg-lbl">Days</span>' +
                '<input class="ucg-num" type="number" min="1" max="90" value="' + (d.durationDays || 5) + '" data-dd="' + i + '"></div>' +
              '<div><span class="ucg-lbl">Qty</span>' +
                '<input class="ucg-num" type="number" min="0" value="' + (d.qty || 0) + '" data-qt="' + i + '"></div>' +
              '<button class="ucg-x" data-rmdrug="' + i + '" title="Remove">×</button></div>';
          }).join('') : '<div style="font-size:12.5px;color:var(--text-lt);padding:2px 0 6px">No medicines suggested — add one.</div>') +
        '</div>' +
        '<div id="ucgSearchWrap">' +
          '<input id="ucgDrugSearch" placeholder="Search a drug to add — type e.g. amo…" autocomplete="off">' +
          '<div id="ucgSearchRes"></div>' +
        '</div></div>' +

      // ③ Charges
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">3</span>' +
        '<h4>Charges (UGX)</h4><span class="ucg-count">you enter</span></div>' +
        '<div class="ucg-money">' +
          '<div><label>Consultation</label><input type="number" min="0" id="ucgFeeC" value="' + (pkg.fees.consult || 0) + '"></div>' +
          '<div><label>Lab</label><input type="number" min="0" id="ucgFeeL" value="' + (pkg.fees.lab || 0) + '"></div>' +
          '<div><label>Medicines</label><input type="number" min="0" id="ucgFeeM" value="' + (pkg.fees.meds || 0) + '"></div>' +
        '</div>' +
        '<div class="ucg-total"><span>Total charged</span><b id="ucgTotal">UGX ' +
          ((pkg.fees.consult || 0) + (pkg.fees.lab || 0) + (pkg.fees.meds || 0)).toLocaleString('en-UG') + '</b></div>' +
        // Saving straight from here means the money has to be settled here too.
        // "Paid" writes to the payments ledger, so it shows in Money In at once.
        '<div class="ucg-paylbl">Payment</div>' +
        '<div class="ucg-pay" id="ucgPay">' +
          PAY_OPTS.map(function (o) {
            return '<button type="button" class="ucg-paychip' +
              (pkg.paymentStatus === o.k ? ' on' : '') + '" data-pay="' + o.k + '">' +
              o.icon + ' ' + o.label + '</button>';
          }).join('') +
        '</div>' +
        '<div class="ucg-payhint" id="ucgPayHint"></div>' +
        '</div>' +

      // ④ Clinical guidance from the guideline — tap to open
      (ctx.info ? '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">4</span>' +
        '<h4>Guideline notes for this condition</h4><span class="ucg-count">tap to open</span></div>' +
        '<div class="ucg-rows">' + guidanceHtml() + '</div></div>' : '') +

      // ⑤ Follow-up + another condition
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">' + (ctx.info ? '5' : '4') + '</span>' +
        '<h4>Review &amp; next visit</h4></div>' +
        '<div class="ucg-rows" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:13px;color:var(--text)">Return in</span>' +
          '<input class="ucg-num" style="width:56px" type="number" min="0" max="120" id="ucgFollow" value="' + (pkg.followUpDays || 7) + '">' +
          '<span style="font-size:13px;color:var(--text)">days</span>' +
          '<button class="ucg-add" id="ucgAddCond" style="margin-left:auto">+ Add another condition</button>' +
        '</div></div>';

    wireRows();
  }

  // Collapsible guideline detail: management, what else to check, what it could
  // be if you're not certain, complications, and the raw source text.
  function guidanceHtml() {
    var i = ctx.info || {};
    function d(title, body, icon) {
      if (!body || !String(body).trim()) return '';
      return '<details class="ucg-det"><summary>' +
        '<span class="material-icons-outlined">' + icon + '</span>' + esc(title) +
        '<span class="material-icons-outlined chev">expand_more</span></summary>' +
        '<div class="ucg-det-b">' + esc(String(body).trim()) + '</div></details>';
    }
    var html =
      d('Management (guideline)', i.management, 'medical_information') +
      d('What to look for — clinical features', i.clinical_features, 'visibility') +
      d('If you are not certain — other possibilities', i.differential, 'help_outline') +
      d('Investigations in full', i.investigations, 'biotech') +
      d('Complications to watch for', i.complications, 'warning_amber') +
      d('Causes / risk factors', i.causes, 'coronavirus') +
      d('Prevention & advice for the patient', i.prevention, 'health_and_safety') +
      d('Notes & cautions', i.notes, 'sticky_note_2') +
      d('Full guideline text (source)', i.full_text, 'menu_book');
    return html || '<div style="font-size:12.5px;color:var(--text-lt)">No extra guideline detail for this section.</div>';
  }

  function recalc() {
    var t = (Number(pkg.fees.consult) || 0) + (Number(pkg.fees.lab) || 0) + (Number(pkg.fees.meds) || 0);
    var el = document.getElementById('ucgTotal');
    if (el) el.textContent = 'UGX ' + t.toLocaleString('en-UG');
  }

  function wireRows() {
    var body = document.getElementById('ucgBody');
    body.querySelectorAll('[data-rmtest]').forEach(function (b) {
      b.onclick = function () { pkg.tests.splice(Number(b.dataset.rmtest), 1); render(); };
    });
    body.querySelectorAll('[data-rmdrug]').forEach(function (b) {
      b.onclick = function () { pkg.drugs.splice(Number(b.dataset.rmdrug), 1); render(); };
    });
    body.querySelectorAll('[data-fd]').forEach(function (inp) {
      inp.onchange = function () {
        var d = pkg.drugs[Number(inp.dataset.fd)];
        d.timesPerDay = Math.max(1, Number(inp.value) || 1);
        d.qty = d.timesPerDay * (d.durationDays || 1);
        render();
      };
    });
    body.querySelectorAll('[data-dd]').forEach(function (inp) {
      inp.onchange = function () {
        var d = pkg.drugs[Number(inp.dataset.dd)];
        d.durationDays = Math.max(1, Number(inp.value) || 1);
        d.qty = (d.timesPerDay || 1) * d.durationDays;
        render();
      };
    });
    body.querySelectorAll('[data-qt]').forEach(function (inp) {
      inp.onchange = function () { pkg.drugs[Number(inp.dataset.qt)].qty = Math.max(0, Number(inp.value) || 0); };
    });
    ['C:consult', 'L:lab', 'M:meds'].forEach(function (pair) {
      var p = pair.split(':'), el = document.getElementById('ucgFee' + p[0]);
      if (el) el.oninput = function () { pkg.fees[p[1]] = Math.max(0, Number(el.value) || 0); recalc(); };
    });
    // Payment chips — pick how the visit was settled without leaving the panel.
    var payHint = document.getElementById('ucgPayHint');
    function paintPay() {
      var opt = null;
      PAY_OPTS.forEach(function (o) { if (o.k === pkg.paymentStatus) opt = o; });
      body.querySelectorAll('[data-pay]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.pay === pkg.paymentStatus);
      });
      if (payHint) payHint.textContent = opt ? opt.hint : '';
    }
    body.querySelectorAll('[data-pay]').forEach(function (b) {
      b.onclick = function () { pkg.paymentStatus = b.dataset.pay; paintPay(); };
    });
    paintPay();

    var fu = document.getElementById('ucgFollow');
    if (fu) fu.onchange = function () { pkg.followUpDays = Math.max(0, Number(fu.value) || 0); };

    var addT = document.getElementById('ucgAddTest');
    if (addT) addT.onclick = function () {
      var name = window.prompt ? null : null;      // prompt() is blocked in WebViews
      openInlineAdd('test');
    };
    var addC = document.getElementById('ucgAddCond');
    if (addC) addC.onclick = function () {
      close();
      toast('Pick the next condition, then tap the package button again', 'info');
      var dx = document.getElementById('confirmedDx');
      if (dx) { dx.focus(); dx.select && dx.select(); }
    };
    wireDrugSearch();
  }

  // Inline "add a test" (no window.prompt — blocked in Android WebViews)
  // Every lab test name this clinic could reasonably mean: the tests the
  // consultation form already offers, plus any the clinic added itself. Read
  // from the page and from local storage, so suggestions work with no network.
  function labTestNames() {
    var out = [], seen = {};
    function add(n) {
      n = String(n || '').trim();
      if (!n) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1; out.push(n);
    }
    try {
      document.querySelectorAll('[data-lab]').forEach(function (c) { add(c.dataset.lab); });
    } catch (e) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf('custom_labs_') !== 0) continue;
        var list = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(list)) list.forEach(add);
      }
    } catch (e) {}
    return out;
  }

  function openInlineAdd(kind) {
    var host = document.getElementById('ucgTests');
    if (!host || host.querySelector('.ucg-inline')) return;
    var wrap = document.createElement('div');
    wrap.className = 'ucg-inline';
    wrap.style.cssText = 'margin-top:8px';
    wrap.innerHTML =
      '<div style="display:flex;gap:7px">' +
        '<input id="ucgNewTest" placeholder="Type a test — e.g. mal…" autocomplete="off" ' +
          'style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;background:var(--surface);color:var(--text)">' +
        '<button class="ucg-add" id="ucgNewTestOk">Add</button>' +
      '</div>' +
      '<div id="ucgTestRes"></div>';
    host.appendChild(wrap);
    var inp = document.getElementById('ucgNewTest');
    var box = document.getElementById('ucgTestRes');
    var names = labTestNames();
    inp.focus();

    function commit(v) {
      v = (v == null ? (inp.value || '') : v).trim();
      if (v) { pkg.tests.push(v); render(); } else { wrap.remove(); }
    }

    // As-you-type suggestions. Deliberately plain: match anywhere in the name,
    // shortest first, tap to add. No network, no database — instant on a slow
    // phone, and it still accepts anything typed that is not on the list.
    function suggest() {
      var q = (inp.value || '').trim().toLowerCase();
      if (q.length < 1) { box.innerHTML = ''; box.style.display = 'none'; return; }
      var hits = names.filter(function (n) {
        return n.toLowerCase().indexOf(q) >= 0 && pkg.tests.indexOf(n) < 0;
      }).sort(function (a, b) {
        var ap = a.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        var bp = b.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        return ap - bp || a.length - b.length;
      }).slice(0, 8);
      if (!hits.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
      box.innerHTML = hits.map(function (n, i) {
        return '<div data-t="' + i + '"><b>' + esc(n) + '</b></div>';
      }).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-t]').forEach(function (el) {
        el.onclick = function () { commit(hits[Number(el.dataset.t)]); };
      });
    }

    inp.oninput = suggest;
    document.getElementById('ucgNewTestOk').onclick = function () { commit(); };
    inp.onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Enter takes the top suggestion when the box is showing, else the text.
      var top = box.querySelector('[data-t]');
      if (top && box.style.display !== 'none') top.click(); else commit();
    };
    suggest();
  }

  // Drug search: "amo" → Amoxicillin 250 mg / 500 mg → tap → dosage popup
  function wireDrugSearch() {
    var inp = document.getElementById('ucgDrugSearch');
    var box = document.getElementById('ucgSearchRes');
    if (!inp || !box) return;
    var t;
    inp.oninput = function () {
      clearTimeout(t);
      var q = inp.value.trim();
      if (q.length < 2) { box.style.display = 'none'; return; }
      t = setTimeout(async function () {
        // 1) The national formulary (EMHSLU 2023) — official name, form,
        //    strength, facility level and VEN class.
        var found = [];
        try {
          await openEm();
          found = emRows(
            'SELECT name, dosage_form, strength, level_of_care, ven_class ' +
            'FROM emhslu_items WHERE item_type=\'medicine\' AND name LIKE ? ' +
            'ORDER BY length(name), name LIMIT 16', [q + '%']);
          if (!found.length) {
            found = emRows(
              'SELECT name, dosage_form, strength, level_of_care, ven_class ' +
              'FROM emhslu_items WHERE item_type=\'medicine\' AND name LIKE ? ' +
              'ORDER BY length(name), name LIMIT 16', ['%' + q + '%']);
          }
          found = found.map(function (r) {
            return { name: r.name, dose: r.strength || '', unit: '', route: '',
                     frequency: '', duration: '', form: r.dosage_form || '',
                     level: r.level_of_care, ven: r.ven_class, src: 'EMHSLU' };
          });
        } catch (e) { found = []; }
        // 2) Fall back to the doses mentioned in the clinical guideline.
        if (!found.length) {
          found = rows(
            'SELECT DISTINCT name, dose, unit, route, frequency, duration FROM medicines ' +
            'WHERE name LIKE ? ORDER BY length(name) LIMIT 14', [q + '%']);
        }
        if (!found.length) {
          found = rows('SELECT DISTINCT name, dose, unit, route, frequency, duration FROM medicines ' +
            'WHERE name LIKE ? ORDER BY length(name) LIMIT 14', ['%' + q + '%']);
        }
        if (!found.length) {
          box.innerHTML = '<div style="color:var(--text-lt)">No match — “' + esc(q) +
            '” will be added as typed.<br><b>Tap to add</b></div>';
          box.style.display = 'block';
          box.firstChild.onclick = function () { askDosage({ name: q, dose: '', unit: '' }); };
          return;
        }
        var lvl = myLevel();
        box.innerHTML = found.map(function (m, i) {
          var venTxt = { V: 'Vital', E: 'Essential', N: 'Necessary' }[m.ven] || '';
          var above = lvl && m.level && LEVELS.indexOf(m.level) > LEVELS.indexOf(lvl);
          return '<div data-i="' + i + '"><b>' + esc(m.name) + '</b>' +
            (m.dose ? ' <span style="color:#0E7C5A;font-weight:700">' + esc(m.dose + (m.unit || '')) + '</span>' : '') +
            (m.form ? ' <span style="color:var(--text-lt);font-size:11.5px">' + esc(m.form) + '</span>' : '') +
            (m.route ? ' <span style="color:var(--text-lt);font-size:11.5px">' + esc(m.route) + '</span>' : '') +
            (m.level ? '<span class="em-tag' + (above ? ' warn' : '') + '">' + esc(m.level) + '</span>' : '') +
            (venTxt ? '<span class="em-tag ven-' + esc(m.ven) + '" title="' + venTxt + '">' + esc(m.ven) + '</span>' : '') +
            (m.src ? '<span class="em-src">EMHSLU</span>' : '') +
            '</div>';
        }).join('');
        box.style.display = 'block';
        box.querySelectorAll('[data-i]').forEach(function (el) {
          el.onclick = function () { askDosage(found[Number(el.dataset.i)]); };
        });
      }, 130);
    };
  }

  // Small popup asking the dosage, pre-filled from the guideline, editable.
  function askDosage(m) {
    var box = document.getElementById('ucgSearchRes');
    if (box) box.style.display = 'none';
    var tpd = freqPerDay(m.frequency), dd = durDays(m.duration);
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent = m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : '');
    document.getElementById('ucgAskText').textContent = 'How should this be taken?';
    document.getElementById('ucgAskDiff').innerHTML =
      '<div style="display:flex;gap:10px;align-items:end">' +
        '<div><span class="ucg-lbl">Times/day</span><input class="ucg-num" id="dqF" type="number" min="1" max="6" value="' + tpd + '"></div>' +
        '<div><span class="ucg-lbl">Days</span><input class="ucg-num" id="dqD" type="number" min="1" max="90" value="' + dd + '"></div>' +
        '<div><span class="ucg-lbl">Quantity</span><input class="ucg-num" id="dqQ" type="number" min="0" value="' + (tpd * dd) + '"></div>' +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--text-lt);margin-top:8px">e.g. 3 × daily for 5 days = 15 units</div>';
    document.getElementById('ucgAskYes').textContent = 'Add drug';
    ask.style.display = 'flex';
    var f = document.getElementById('dqF'), d = document.getElementById('dqD'), q = document.getElementById('dqQ');
    function sync() { q.value = (Number(f.value) || 1) * (Number(d.value) || 1); }
    f.onchange = sync; d.onchange = sync;
    document.getElementById('ucgAskNo').onclick = function () { ask.style.display = 'none'; };
    document.getElementById('ucgAskYes').onclick = function () {
      pkg.drugs.push({
        drug: m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : ''),
        dosage: (m.dose ? m.dose + (m.unit || '') : '') +
                (m.form ? ' ' + m.form : '') + (m.route ? ' ' + m.route : ''),
        timesPerDay: Number(f.value) || 2,
        durationDays: Number(d.value) || 5,
        qty: Number(q.value) || 0,
        from: 'added',
      });
      ask.style.display = 'none';
      render();
    };
  }

  // ── Open the package ─────────────────────────────────────────────────────
  async function open(condId, title, severity, page) {
    ensurePanel();
    ctx = { conditionId: condId, title: title, severity: severity, page: page, learned: false, info: null };
    var ov = document.getElementById('ucgOverlay');
    document.getElementById('ucgTitle').textContent = title;
    document.getElementById('ucgBody').innerHTML =
      '<div style="padding:30px;text-align:center;color:var(--text-lt);font-size:13px">Loading the standard package…</div>';
    ov.style.display = 'flex';

    try { await openDb(); } catch (e) {
      document.getElementById('ucgBody').innerHTML =
        '<div style="padding:24px;text-align:center;color:#C62828;font-size:13px">Could not open the guideline database: ' +
        esc(e.message) + '</div>';
      return;
    }

    // A parent heading (e.g. "Malaria") often carries no drugs — the real
    // packages live in its subsections ("Uncomplicated Malaria", "Severe
    // Malaria"). Offer those instead of an empty package.
    // Not in the guidelines at all → open a blank worksheet the clinician fills
    // in (and can save as a clinic standard for next time).
    if (!condId) {
      pkg = { tests: [], drugs: [], fees: { consult: 0, lab: 0, meds: 0 }, paymentStatus: 'pending', followUpDays: 7, page: null, title: title };
      srcPkg = JSON.parse(JSON.stringify(pkg));
      document.getElementById('ucgKicker').textContent = 'New package · not in the guidelines';
      document.getElementById('ucgTags').innerHTML =
        (severity ? '<span class="ucg-tag" style="text-transform:capitalize">' + esc(severity) + '</span>' : '') +
        '<span class="ucg-tag learn">build your own</span>';
      render();
      return;
    }

    var self = rows('SELECT number FROM conditions WHERE id=? LIMIT 1', [condId])[0];
    var ownDrugs = rows('SELECT COUNT(*) n FROM medicines WHERE condition_id=?', [condId])[0];
    if (self && (!ownDrugs || !ownDrugs.n) && !getLearned(condId, severity)) {
      var kids = rows(
        'SELECT c.id,c.title,c.page,(SELECT COUNT(*) FROM medicines m WHERE m.condition_id=c.id) n ' +
        'FROM conditions c WHERE c.number LIKE ? AND c.id<>? ORDER BY c.number LIMIT 8',
        [self.number + '.%', condId]).filter(function (k) { return k.n > 0; });
      if (kids.length) { pickFrom(kids, title, severity); return; }
    }

    var learned = getLearned(condId, severity);
    if (learned && condId) {
      // load the guideline detail for the notes block even when using a learned package
      try {
        var gi = rows('SELECT causes,clinical_features,differential,investigations,management,' +
          'complications,prevention,notes,full_text FROM conditions WHERE id=? LIMIT 1', [condId])[0];
        if (gi) ctx.info = gi;
      } catch (e) {}
    }
    if (learned) {
      ctx.learned = true;
      pkg = {
        tests: learned.tests.slice(),
        drugs: learned.drugs.map(function (d) { return Object.assign({}, d, { from: 'learned' }); }),
        fees: Object.assign({ consult: 0, lab: 0, meds: 0 }, learned.fees),
        followUpDays: learned.followUpDays || 7,
        page: page, title: title,
      };
    } else {
      pkg = buildFromGuideline(condId, severity) ||
        { tests: [], drugs: [], fees: { consult: 0, lab: 0, meds: 0 }, paymentStatus: 'pending', followUpDays: 7, page: page, title: title };
    }
    srcPkg = JSON.parse(JSON.stringify(pkg));
    ctx.page = pkg.page || page;

    document.getElementById('ucgKicker').textContent =
      ctx.learned ? 'Your clinic standard' : 'Standard package · UCG 2023';
    document.getElementById('ucgTags').innerHTML =
      (severity ? '<span class="ucg-tag" style="text-transform:capitalize">' + esc(severity) + '</span>' : '') +
      (ctx.page ? '<span class="ucg-tag">UCG p.' + esc(ctx.page) + '</span>' : '') +
      (ctx.learned ? '<span class="ucg-tag learn">learned · used ' + (learned.uses || 1) + '×</span>' : '');
    render();
  }

  // Chooser: several guideline sections match — let the clinician pick.
  function pickFrom(list, term, severity) {
    ensurePanel();
    close();
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent = 'Which one?';
    document.getElementById('ucgAskText').textContent =
      'Sections under “' + term + '” that carry a treatment package';
    document.getElementById('ucgAskDiff').innerHTML = list.map(function (h, i) {
      return '<div data-h="' + i + '" style="cursor:pointer;padding:10px 4px;border-bottom:1px solid var(--border);font-weight:700">' +
        esc(h.title) + (h.n ? '<span style="float:right;font-weight:600;color:var(--text-lt)">' + h.n + ' drugs</span>' : '') +
        '</div>';
    }).join('');
    document.getElementById('ucgAskYes').style.display = 'none';
    document.getElementById('ucgAskNo').textContent = 'Cancel';
    ask.style.display = 'flex';
    document.getElementById('ucgAskNo').onclick = function () {
      ask.style.display = 'none';
      document.getElementById('ucgAskYes').style.display = '';
      document.getElementById('ucgAskNo').textContent = 'Not now';
    };
    document.getElementById('ucgAskDiff').querySelectorAll('[data-h]').forEach(function (el) {
      el.onclick = function () {
        var h = list[Number(el.dataset.h)];
        ask.style.display = 'none';
        document.getElementById('ucgAskYes').style.display = '';
        document.getElementById('ucgAskNo').textContent = 'Not now';
        open(h.id, h.title, severity, h.page);
      };
    });
  }

  // ── Apply to the consultation (+ ask before learning) ────────────────────
  function changeSummary() {
    var out = [];
    var a = srcPkg, b = pkg;
    a.tests.forEach(function (t) { if (b.tests.indexOf(t) < 0) out.push('− test: ' + t); });
    b.tests.forEach(function (t) { if (a.tests.indexOf(t) < 0) out.push('+ test: ' + t); });
    var an = a.drugs.map(function (d) { return d.drug; });
    var bn = b.drugs.map(function (d) { return d.drug; });
    an.forEach(function (n) { if (bn.indexOf(n) < 0) out.push('− drug: ' + n); });
    bn.forEach(function (n) { if (an.indexOf(n) < 0) out.push('+ drug: ' + n); });
    b.drugs.forEach(function (d) {
      var o = a.drugs.find(function (x) { return x.drug === d.drug; });
      if (o && (o.timesPerDay !== d.timesPerDay || o.durationDays !== d.durationDays || o.qty !== d.qty)) {
        out.push('~ ' + d.drug + ': ' + d.timesPerDay + '×/day for ' + d.durationDays + 'd (qty ' + d.qty + ')');
      }
    });
    ['consult', 'lab', 'meds'].forEach(function (k) {
      if ((a.fees[k] || 0) !== (b.fees[k] || 0)) out.push('~ ' + k + ' fee: UGX ' + (b.fees[k] || 0).toLocaleString('en-UG'));
    });
    if ((a.followUpDays || 0) !== (b.followUpDays || 0)) out.push('~ return in ' + b.followUpDays + ' days');
    return out;
  }

  function applyToWizard() {
    if (!state) return;
    // The wizard starts with one blank medicine row — drop it so the package
    // doesn't leave an empty prescription line behind.
    state.medications = (state.medications || []).filter(function (m) {
      return m && String(m.drug || '').trim();
    });
    pkg.tests.forEach(function (t) { if (state.labTests.indexOf(t) < 0) state.labTests.push(t); });
    pkg.drugs.forEach(function (d) {
      var tpd = Math.max(1, Math.min(4, Number(d.timesPerDay) || 2));
      // Give every row real intake times. Leaving these empty meant the
      // consultation could never be sent — the package looked applied, the
      // clinician pressed Send, and nothing was ever recorded.
      var times = (typeof window._wizDefaultTimes === 'function')
        ? window._wizDefaultTimes(tpd)
        : ({ 1: ['08:00'], 2: ['08:00', '20:00'],
             3: ['08:00', '14:00', '20:00'],
             4: ['07:00', '12:00', '17:00', '22:00'] }[tpd] || ['08:00', '20:00']).slice();
      state.medications.push({
        drug: d.drug,
        // A prescription line with no dose cannot be dispensed safely, and the
        // wizard rightly refuses it. Fall back to the strength carried on the
        // drug so the row arrives complete.
        dosage: (d.dosage || d.dose || d.strength || '').toString().trim(),
        timesPerDay: tpd,
        intakeTimes: times,
        durationDays: Number(d.durationDays) > 0 ? Number(d.durationDays) : 5,
        inventoryItemId: null,
        qtyToDeduct: Number(d.qty) || 0,
      });
    });
    state.feeConsult = Number(pkg.fees.consult) || 0;
    state.feeLab = Number(pkg.fees.lab) || 0;
    state.feeMeds = Number(pkg.fees.meds) || 0;
    // Carry the payment choice through, so saving from the panel settles the
    // money too. "Paid" is what writes the amount into the payments ledger.
    if (pkg.paymentStatus) {
      state.paymentStatus = pkg.paymentStatus;
      // Keep the wizard's own chips in step, so screen 2 shows the same choice.
      document.querySelectorAll('.pay-chip[data-pay]').forEach(function (c) {
        c.classList.toggle('active', c.dataset.pay === pkg.paymentStatus);
      });
    }
    if (pkg.followUpDays) state.followUpDays = pkg.followUpDays;
    try { if (typeof window._wizRefreshAfterAutofill === 'function') window._wizRefreshAfterAutofill(); } catch (e) {}
  }

  function apply() {
    var changes = changeSummary();
    applyToWizard();
    close();
    // "Package applied" on its own read as "consultation recorded" — it is not,
    // nothing is saved until the consultation is sent. Say what is still needed.
    var _need = 'Not saved yet — press Send at the bottom to record it.';
    toast('Package applied (' + pkg.drugs.length + ' medicine' + (pkg.drugs.length !== 1 ? 's' : '') +
      ', ' + pkg.tests.length + ' test' + (pkg.tests.length !== 1 ? 's' : '') + '). ' + _need, 'success');

    if (!changes.length) return;                 // nothing to learn
    askToLearn(changes, null);   // ASK before changing what auto-fills next time
  }

  // ── Public entry: find the condition for the typed diagnosis, then open ──
  async function start(dxText, severity, wizState) {
    state = wizState || window._wizState || null;
    var term = (dxText || '').trim();
    if (!term) { toast('Enter the diagnosis first', 'error'); return; }
    ensurePanel();
    try { await openDb(); } catch (e) { toast('Guideline database unavailable offline yet', 'error'); return; }

    var toks = term.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    var hits = [];
    if (toks.length) {
      try {
        hits = rows('SELECT c.id,c.title,c.page FROM conditions_fts f JOIN conditions c ON c.id=f.rowid ' +
          'WHERE conditions_fts MATCH ? ORDER BY rank LIMIT 8',
          [toks.map(function (t) { return '"' + t + '"*'; }).join(' AND ')]);
      } catch (e) { hits = []; }
    }
    if (!hits.length) {
      hits = rows('SELECT id,title,page FROM conditions WHERE title LIKE ? ORDER BY length(title) LIMIT 8', ['%' + term + '%']);
    }
    if (!hits.length) {
      // Nothing in the guidelines — still give the clinician a worksheet.
      toast('Not in the guidelines — start a package for “' + term + '”', 'info');
      open(null, term, severity, null);
      return;
    }
    // Prefer sections that actually carry a treatment package.
    hits = hits.map(function (h) {
      var n = rows('SELECT COUNT(*) n FROM medicines WHERE condition_id=?', [h.id])[0];
      return Object.assign({}, h, { n: (n && n.n) || 0 });
    }).sort(function (a, b) { return b.n - a.n; });
    if (hits.length === 1) { open(hits[0].id, hits[0].title, severity, hits[0].page); return; }

    pickFrom(hits, term, severity);
  }

  // ── Diagnosis suggestions ────────────────────────────────────────────────
  // Typing the condition should offer it, not make the clinician spell it out.
  // Three sources, cheapest first, so something useful appears on the first
  // keystroke even before the 6 MB guideline database has finished opening:
  //   1. what THIS clinic has diagnosed before (its own learned packages)
  //   2. a short list of the conditions seen most in Ugandan primary care
  //   3. the Uganda Clinical Guidelines themselves, once the database is open
  var COMMON_DX = [
    'Malaria', 'Malaria (uncomplicated)', 'Severe malaria', 'Typhoid fever',
    'Upper respiratory tract infection', 'Pneumonia', 'Bronchitis', 'Asthma',
    'Urinary tract infection', 'Diarrhoea', 'Dysentery', 'Cholera',
    'Intestinal worms', 'Amoebiasis', 'Giardiasis', 'Peptic ulcer disease',
    'Gastritis', 'Anaemia', 'Malnutrition', 'HIV/AIDS', 'Tuberculosis',
    'Sexually transmitted infection', 'Syphilis', 'Gonorrhoea', 'Candidiasis',
    'Pelvic inflammatory disease', 'Hypertension', 'Diabetes mellitus',
    'Epilepsy', 'Otitis media', 'Tonsillitis', 'Conjunctivitis', 'Skin infection',
    'Scabies', 'Ringworm', 'Wound infection', 'Cellulitis', 'Abscess', 'Burns',
    'Arthritis', 'Back pain', 'Headache', 'Migraine', 'Allergic reaction',
    'Measles', 'Chickenpox', 'Mumps', 'Meningitis', 'Hepatitis', 'Snake bite',
    'Antenatal care', 'Malaria prophylaxis', 'Family planning', 'Immunisation',
  ];

  function learnedTitles() {
    var out = [];
    try {
      var all = allLearned();
      Object.keys(all).forEach(function (k) {
        if (all[k] && all[k].title) out.push({ t: all[k].title, uses: all[k].uses || 0 });
      });
    } catch (e) {}
    return out.sort(function (a, b) { return b.uses - a.uses; }).map(function (x) { return x.t; });
  }

  function suggestDx(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    var out = [], seen = {};
    function add(title, tag) {
      var t = String(title || '').trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ title: t, tag: tag });
    }
    // 1. the clinic's own standards come first — these are its real caseload
    learnedTitles().forEach(function (t) {
      if (t.toLowerCase().indexOf(q) >= 0) add(t, 'your standard');
    });
    // 2. common conditions
    COMMON_DX.filter(function (t) { return t.toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) {
        var ap = a.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        var bp = b.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        return ap - bp || a.length - b.length;
      }).forEach(function (t) { add(t, ''); });
    // 3. the guidelines, when they are already loaded (never blocks typing)
    if (db) {
      try {
        rows('SELECT title FROM conditions WHERE title LIKE ? ORDER BY length(title) LIMIT 10',
             ['%' + q + '%']).forEach(function (r) { add(r.title, 'UCG 2023'); });
      } catch (e) {}
    }
    return out.slice(0, 8);
  }

  function wireDxSuggest() {
    var inp = document.getElementById('confirmedDx');
    if (!inp || inp._ucgWired) return;
    inp._ucgWired = true;

    var box = document.createElement('div');
    box.id = 'ucgDxRes';
    box.style.cssText = 'display:none;margin-top:8px;background:var(--surface,#fff);' +
      'border:1.5px solid var(--brand-tint,#DBF4EA);border-radius:12px;overflow:hidden;' +
      'max-height:270px;overflow-y:auto;box-shadow:var(--shadow,0 6px 18px rgba(20,24,43,.07))';
    inp.parentNode.insertBefore(box, inp.nextSibling);

    // Warm the guideline database the moment the clinician starts typing, so
    // the fuller list is ready a keystroke or two later.
    var warmed = false;
    function warm() { if (warmed) return; warmed = true; openDb().catch(function () {}); }

    var t, justPicked = false;
    function paint() {
      if (justPicked) { justPicked = false; return; }
      var hits = suggestDx(inp.value);
      if (!hits.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = hits.map(function (h, i) {
        return '<div data-d="' + i + '" style="padding:11px 13px;font-size:14px;cursor:pointer;' +
          'border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px">' +
          '<b style="font-weight:600;color:var(--text)">' + esc(h.title) + '</b>' +
          (h.tag ? '<span style="font-size:10.5px;font-weight:800;color:var(--text-lt);' +
            'letter-spacing:.3px;white-space:nowrap;align-self:center">' + esc(h.tag) + '</span>' : '') +
          '</div>';
      }).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-d]').forEach(function (el) {
        el.onclick = function () {
          inp.value = hits[Number(el.dataset.d)].title;
          // Tell the wizard the value changed, but do NOT let that re-open the
          // list we just picked from.
          justPicked = true;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          clearTimeout(t);
          box.style.display = 'none';
          box.innerHTML = '';
        };
      });
    }

    inp.addEventListener('input', function () {
      warm();
      clearTimeout(t);
      if (justPicked) { justPicked = false; return; }
      t = setTimeout(paint, 110);
    });
    inp.addEventListener('focus', warm);
    document.addEventListener('click', function (e) {
      if (e.target !== inp && !box.contains(e.target)) box.style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireDxSuggest);
  } else {
    wireDxSuggest();
  }

  window.UCGPackage = { start: start, open: open, close: close, suggestDx: suggestDx };
})();
