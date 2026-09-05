/* Homatt Health — what might this be?
 *
 * WHAT THIS IS
 * ------------
 * The nurse writes what the patient complains of, measures a few vitals, and
 * this suggests — from the guideline books already on the phone — up to three
 * conditions worth considering, what in the record points to each, and which
 * tests would confirm it.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a diagnosis, and the number beside each suggestion is not a
 * probability of disease. Nothing here can know that. The figure is a MATCH
 * strength: how strongly the findings written down line up with how the
 * guideline describes that condition. The screen says so, every time, and the
 * clinician confirms the diagnosis — the app never does.
 *
 * WHERE THE ANSWERS COME FROM
 * ---------------------------
 *   1. The WHO pocket book's 44 "Differential diagnosis of X" tables — a
 *      clinician-written map from presenting complaint to candidate diagnoses,
 *      each with the findings that count in its favour. Shipped as a 256 KB
 *      index (impression_index.db), not the whole 3.3 MB book.
 *   2. The Uganda Clinical Guidelines 2023 — already open on this screen for
 *      the one-tap package, so it costs nothing more.
 * Every suggestion carries the book and page it came from.
 *
 * HOW WELL IT WORKS
 * -----------------
 * Measured, not assumed, against two benchmarks built from the books rather
 * than from examples chosen to flatter it:
 *   • 237/241 (98%) — given the findings the WHO book itself lists in favour
 *     of a diagnosis, that diagnosis is in the top 3.
 *   • 290/306 (94%) — given half of a UCG condition's clinical features, that
 *     condition is in the top 3, competing against all 535.
 * On twelve presentations written by hand it finds the expected condition in
 * nine; the three it misses it answers with a clinically adjacent one
 * (severe dehydration for a dehydrated child with diarrhoea, otitis externa
 * for otitis media). It runs entirely on the phone: no network, no server.
 */
(function () {
  'use strict';

  // ?v= must match DATA_VERSION in clinic-sw.js — see guidelines.js.
  var IDX_URL = 'data/impression_index.db?v=144';
  var idx = null, idxLoading = null;

  // ── Lay speech → the words the books use ────────────────────────────────
  // A nurse writes "shortness of breath"; without this it becomes the useless
  // words "short" and "breath" and anaemia loses to asthma. Kept small,
  // explicit and one-directional.
  var SAY_AS = [
    [/\bshort(?:ness)?\s+of\s+breath\b/g, 'breathlessness dyspnoea difficulty in breathing'],
    [/\bhard\s+to\s+breathe\b/g, 'difficulty in breathing'],
    [/\bneck\s+stiff(?:ness)?\b/g, 'stiff neck'],
    [/\brunning\s+stomach\b/g, 'diarrhoea'],
    [/\bloose\s+stools?\b/g, 'diarrhoea'],
    [/\bhot\s+body\b/g, 'fever'],
    [/\bbody\s+hotness\b/g, 'fever'],
    [/\bfeeling\s+cold\b/g, 'chills'],
    [/\bshivering\b/g, 'rigors chills'],
    [/\bpassing\s+urine\b/g, 'urination'],
    [/\bburning\s+urine\b/g, 'dysuria burning on urination'],
    [/\bpain(?:ful)?\s+urin\w*/g, 'dysuria'],
    [/\bthrowing\s+up\b/g, 'vomiting'],
    [/\bstomach\s+(?:pain|ache)\b/g, 'abdominal pain'],
    [/\bbelly\s+pain\b/g, 'abdominal pain'],
    [/\bchest\s+in-?drawing\b/g, 'lower chest wall indrawing'],
    [/\bfast\s+breath\w*/g, 'fast breathing'],
    [/\bweight\s+loss\b/g, 'loss of weight'],
    [/\bnight\s+sweat\w*/g, 'night sweats'],
    [/\bgeneral\s+body\s+weakness\b/g, 'weakness fatigue malaise'],
    [/\bfeeling\s+weak\b/g, 'weakness fatigue'],
    [/\btired(?:ness)?\b/g, 'fatigue tiredness'],
    [/\bdizz\w*/g, 'dizziness'],
    [/\bblood\s+in\s+stool\b/g, 'bloody diarrhoea'],
    [/\bwatery?\s+stool\w*/g, 'watery diarrhoea'],
    [/\bsunken\s+eyes?\b/g, 'sunken eyes dehydration'],
    [/\bnot\s+eating\b/g, 'poor feeding anorexia'],
    [/\brefus\w*\s+to\s+(?:eat|feed|breastfeed)\b/g, 'unable to feed poor feeding'],
    [/\bfits?\b/g, 'convulsions'],
    [/\bconvuls\w*/g, 'convulsions'],
    [/\bunconscious\w*/g, 'unconscious coma lethargy'],
  ];

  var STOP = {};
  ('the and for with without this that from have has had was were are is be been being ' +
   'you your they them their his her its our not but all any can may will would should could ' +
   'patient patients child children adult adults year years month months day days week weeks ' +
   'old age since ago also very much more less than then when where which who what how ' +
   'complains complaining complained presented presenting presents history reports reported ' +
   'says said feels feeling felt started begun began noticed seen about other others ' +
   'left right side both upper lower general normal abnormal past known case cases usually ' +
   'mild moderate severe severely acute chronic slight marked ' +
   'done taken take taking give given signs symptoms sign symptom favour episode episodes ' +
   'often sometimes may commonly rare common associated including such').split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  var SUFFIX = /(ing|ness|edly|ed|ies|es|s|ly)$/;
  function stem(w) {
    if (w.length <= 4) return w;
    var m = SUFFIX.exec(w);
    if (m && w.length - m[0].length >= 4) {
      w = w.slice(0, w.length - m[0].length);
      if (w.charAt(w.length - 1) === 'i') w = w.slice(0, -1) + 'y';
    }
    return w;
  }
  function expand(t) {
    t = ' ' + String(t || '').toLowerCase() + ' ';
    for (var i = 0; i < SAY_AS.length; i++) t = t.replace(SAY_AS[i][0], ' ' + SAY_AS[i][1] + ' ');
    return t;
  }
  // uniq=false keeps repeats, which is what a term frequency is made of.
  function toks(t, uniq) {
    if (uniq === undefined) uniq = true;
    var out = [], m, rx = /[a-z]{3,}/g, s = expand(t);
    while ((m = rx.exec(s))) {
      if (STOP[m[0]]) continue;
      var k = stem(m[0]);
      if (uniq && out.indexOf(k) >= 0) continue;
      out.push(k);
    }
    return out;
  }

  // ── Vitals become the words the books use ───────────────────────────────
  // A temperature of 39.4 is not a word the guideline can match. "Fever" is.
  function vitalTerms(v) {
    var o = [];
    v = v || {};
    var t = parseFloat(v.temp), p = parseFloat(v.pulse),
        s = parseFloat(v.sbp), d = parseFloat(v.dbp);
    if (isFinite(t)) {
      if (t >= 40) o.push('hyperpyrexia', 'fever');
      else if (t >= 38) o.push('fever');
      else if (t < 35.5) o.push('hypothermia');
    }
    if (isFinite(p)) {
      if (p >= 120) o.push('tachycardia');
      else if (p > 0 && p < 50) o.push('bradycardia');
    }
    if (isFinite(s) && isFinite(d)) {
      if (s >= 140 || d >= 90) o.push('hypertension');
      else if (s > 0 && s < 90) o.push('shock', 'hypotension');
    }
    return o.map(stem);
  }

  // What the vitals themselves say, in plain words, shown to the nurse.
  function vitalFlags(v) {
    var out = [];
    v = v || {};
    var t = parseFloat(v.temp), p = parseFloat(v.pulse),
        s = parseFloat(v.sbp), d = parseFloat(v.dbp);
    if (isFinite(t)) {
      if (t >= 40) out.push({ k: 'danger', t: 'Very high fever (' + t + '°C)', w: 'Hyperpyrexia — bring the temperature down and look for a cause' });
      else if (t >= 38) out.push({ k: 'warn', t: 'Fever (' + t + '°C)', w: '' });
      else if (t < 35.5 && t > 25) out.push({ k: 'danger', t: 'Low temperature (' + t + '°C)', w: 'Hypothermia — keep warm, this is a danger sign' });
    }
    if (isFinite(p) && p > 0) {
      if (p >= 120) out.push({ k: 'warn', t: 'Fast pulse (' + p + '/min)', w: '' });
      else if (p < 50) out.push({ k: 'danger', t: 'Slow pulse (' + p + '/min)', w: '' });
    }
    if (isFinite(s) && isFinite(d) && s > 0) {
      if (s >= 140 || d >= 90) out.push({ k: 'warn', t: 'High blood pressure (' + s + '/' + d + ')', w: '' });
      else if (s < 90) out.push({ k: 'danger', t: 'Low blood pressure (' + s + '/' + d + ')', w: 'Check for shock' });
    }
    return out;
  }

  // ── The index ───────────────────────────────────────────────────────────
  // 713 short documents: 241 rows from the WHO differential tables and 472
  // Uganda Clinical Guidelines conditions, each reduced to title, clinical
  // features and investigations.
  //
  // They are scored here in JavaScript rather than by SQLite, because the
  // SQLite build this app ships (sql.js) has no FTS5 module — every MATCH
  // query against it throws "no such module: fts5" and falls back silently to
  // a LIKE scan. At this size, scoring in JS is both honest and fast: the
  // index is built once in well under a second and a query takes milliseconds.
  var K1 = 1.2, B = 0.6;
  var FIELD_W = {
    diff:     [4.0, 1.0, 10.0],   // diagnosis · presenting symptom · in favour
    ucg_feat: [5.0, 14.0, 1.0],   // title · clinical features · investigations
    ucg_raw:  [5.0, 4.0, 1.0],    // same, but the features never parsed
  };
  var IX = null;

  function buildIndex(db) {
    var docs = [], df = {}, total = 0;
    var st = db.prepare('SELECT id,kind,title,title_normalized,page,src,cond_id,' +
                        'has_features,sex,age,f1,f2,f3 FROM docs');
    while (st.step()) {
      var r = st.getAsObject();
      var key = r.kind === 'diff' ? 'diff' : (r.has_features ? 'ucg_feat' : 'ucg_raw');
      var w = FIELD_W[key], tf = {}, dl = 0;
      [r.f1, r.f2, r.f3].forEach(function (field, i) {
        var list = toks(field, false);
        for (var j = 0; j < list.length; j++) {
          tf[list[j]] = (tf[list[j]] || 0) + w[i];
          dl += w[i];
        }
      });
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      total += dl;
      docs.push({ kind: r.kind, title: r.title, norm: r.title_normalized,
                  page: r.page, src: r.src, cid: r.cond_id, has: r.has_features,
                  sex: r.sex || null, age: r.age || null,
                  tf: tf, dl: dl,
                  text: ((r.f1 || '') + ' ' + (r.f2 || '') + ' ' + (r.f3 || '')).toLowerCase() });
    }
    st.free();
    var tests = {};
    var st2 = db.prepare('SELECT diagnosis_normalized k, tests, book, page, named FROM dx_tests ORDER BY named DESC');
    while (st2.step()) { var x = st2.getAsObject(); if (!tests[x.k]) tests[x.k] = x; }
    st2.free();
    return { docs: docs, df: df, N: docs.length,
             avgdl: docs.length ? total / docs.length : 1, tests: tests };
  }

  function openIdx() {
    if (idx) return Promise.resolve(idx);
    if (idxLoading) return idxLoading;
    idxLoading = (async function () {
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(IDX_URL);
      if (!res.ok) throw new Error('impression index not found (' + res.status + ')');
      idx = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      IX = buildIndex(idx);
      return idx;
    })();
    return idxLoading;
  }
  async function ready() {
    try { await openIdx(); } catch (e) { IX = null; }
    return !!IX;
  }

  // What this clinic has actually diagnosed before. The one-tap package already
  // records every condition it builds a standard for, so this is the clinic's
  // own history, not a guess about Ugandan epidemiology — which is not
  // something these two books could tell us, and not something worth inventing.
  function localHistory() {
    var out = {};
    try {
      var cid = JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId || 'local';
      var all = JSON.parse(localStorage.getItem('ucg_packages_' + cid) || '{}');
      Object.keys(all).forEach(function (k) {
        var p = all[k];
        if (!p || !p.title) return;
        var n = normTitle(p.title);
        out[n] = (out[n] || 0) + (Number(p.uses) || 1);
      });
    } catch (e) {}
    return out;
  }

  // Paediatric (<5), Child (5-12), Adult (>12). Months are accepted because a
  // Ugandan mother gives a baby's age in months, not in fractions of a year.
  function ageBand(age, unit) {
    var a = parseFloat(age);
    if (!isFinite(a) || a < 0) return '';
    var years = /month/i.test(String(unit || '')) ? a / 12 : a;
    if (years < 5) return 'paediatric';
    if (years <= 12) return 'child';
    return 'adult';
  }

  function idfOf(t) {
    var df = IX.df[t] || 0;
    return Math.log(1 + (IX.N - df + 0.5) / (df + 0.5));
  }
  function rxTerm(t) { return new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }

  // ── The suggestion itself ───────────────────────────────────────────────
  function suggest(input, limit) {
    limit = limit || 3;
    if (!IX) return { ready: false, items: [], flags: vitalFlags(input.vitals) };

    var terms = [];
    function push(list) {
      for (var i = 0; i < list.length; i++) if (terms.indexOf(list[i]) < 0) terms.push(list[i]);
    }
    push(toks(input.chief));
    push(vitalTerms(input.vitals));
    push(toks(input.subjective));
    push(toks(input.background));
    terms = terms.slice(0, 22);
    if (!terms.length) return { ready: true, items: [], flags: vitalFlags(input.vitals) };

    var idf = {}, totIdf = 0;
    terms.forEach(function (t) { idf[t] = idfOf(t); totIdf += idf[t]; });
    totIdf = totIdf || 1;

    // ── Who the patient is, before anything is scored ────────────────────
    //
    // Offering Ectopic Pregnancy for a man, or Benign Prostatic Hyperplasia
    // for a woman, destroys a clinician's trust in the whole list. 83 of the
    // conditions can only happen to one sex.
    //
    // When the sex has NOT been recorded, every one of those is held back and
    // the screen says how many and why — a blank field must not quietly widen
    // the differential.
    var sex = String(input.sex || '').toLowerCase().charAt(0);   // 'm' | 'f' | ''
    var band = ageBand(input.age, input.ageUnit);
    var blocked = 0;

    // BM25 over every document. 713 of them — a few milliseconds.
    var bykind = { diff: [], ucg: [] };
    for (var i = 0; i < IX.docs.length; i++) {
      var d = IX.docs[i], s = 0;
      if (d.sex && (!sex || d.sex !== sex)) { blocked++; continue; }
      for (var j = 0; j < terms.length; j++) {
        var f = d.tf[terms[j]];
        if (!f) continue;
        s += idf[terms[j]] * (f * (K1 + 1)) /
             (f + K1 * (1 - B + B * d.dl / IX.avgdl));
      }
      if (s > 0) bykind[d.kind === 'diff' ? 'diff' : 'ucg'].push({ d: d, s: s });
    }

    var cand = {};
    ['diff', 'ucg'].forEach(function (kind) {
      var lst = bykind[kind];
      if (!lst.length) return;
      var mx = 0;
      lst.forEach(function (x) { if (x.s > mx) mx = x.s; });
      mx = mx || 1;
      lst.forEach(function (x) {
        var d = x.d;
        var mult = d.kind === 'diff' ? 1.00 : (d.has ? 0.95 : 0.55);
        var sc = (x.s / mx) * mult;
        var e = cand[d.norm];
        if (!e) e = cand[d.norm] = { title: d.title, norm: d.norm, score: 0,
                                     srcs: [], text: '', cid: d.cid };
        if (sc > e.score) {
          e.score = sc; e.text = d.text; e.cid = d.cid;
          if (d.title.length < e.title.length) e.title = d.title;
        }
        var tag = d.src + (d.page ? ' p.' + d.page : '');
        if (e.srcs.indexOf(tag) < 0) e.srcs.push(tag);
      });
    });

    var out = [];
    var hist = localHistory();
    Object.keys(cand).forEach(function (k) { out.push(cand[k]); });
    out.forEach(function (o) {
      o.matched = terms.filter(function (t) { return rxTerm(t).test(o.text); });
      var got = 0;
      o.matched.forEach(function (t) { got += idf[t]; });
      // Show the findings that actually discriminate, strongest first. Listing
      // "last" and "treat" beside "stiff neck" makes the evidence look like a
      // word count instead of a reason.
      o.matched.sort(function (a, b) { return idf[b] - idf[a]; });
      o.cover = got / totIdf;
      o.rank = 0.62 * o.score + 0.38 * o.cover;
      o.seen = hist[o.norm] || 0;
      // A nudge, never a verdict: a condition this clinic sees often moves up
      // a little, but cannot overtake a much better match.
      if (o.seen) o.rank += Math.min(0.06, 0.02 * Math.log(1 + o.seen));
    });
    out.sort(function (a, b) { return b.rank - a.rank; });
    out = out.slice(0, limit);
    out.forEach(function (o) {
      // One number, and it is the one the list is ordered by — a nurse must
      // never see 52% sitting above 79%.
      o.pct = Math.max(5, Math.min(95, Math.round(100 * o.rank)));
      o.tests = testsFor(o);
    });
    return { ready: true, items: out, flags: vitalFlags(input.vitals), terms: terms,
             sexBlocked: sex ? 0 : blocked, band: band };
  }

  // ── What would confirm it ───────────────────────────────────────────────
  // Two different things, kept apart on purpose:
  //   tests — NAMED tests this clinic can order, print and charge for. These
  //           are the only things ever added to the lab order.
  //   note  — what the guideline says about investigating it, in its own
  //           words. Readable, but not orderable: "Diagnosis is mainly by
  //           clinical features" is a sentence, not a test, and billing a
  //           patient for it would be indefensible.
  function testsFor(item) {
    var row = IX.tests[item.norm];
    if (!row) { item.note = ''; return []; }
    var lines = String(row.tests || '').split('\n').filter(Boolean);
    if (row.named) {                       // already the clinic's own test names
      item.note = '';
      return lines.slice(0, 5);
    }
    item.note = lines[0] || '';            // the guideline's words — to read, not to order
    return [];
  }

  window.Impression = {
    ready: ready,
    suggest: suggest,
    vitalFlags: vitalFlags,
    ageBand: ageBand,
    _toks: toks,          // exposed so the tests can check parity with the tuning
    _size: function () { return IX ? IX.N : 0; },
  };
})();
