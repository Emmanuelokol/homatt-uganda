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
      url: 'data/uganda_clinical_guidelines_2023.db?v=145',
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
      buildBrowse();          // the contents page, once the book is open
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

  /* ── Searching a book whose index this engine cannot read ────────────────
   *
   * Every index in every book here is `CREATE VIRTUAL TABLE … USING fts5`,
   * and the SQLite compiled into the WASM we ship has FTS3 and FTS4 but NOT
   * FTS5 (`grep fts5 js/vendor/sql-wasm.wasm` — nothing). So `MATCH` has
   * always thrown "no such module: fts5", the catch has always swallowed it,
   * and every search in this app has quietly been `title LIKE '%term%'`.
   *
   * That is a far bigger fault than it sounds. It means a section could only
   * ever be found if the typed word was in its own heading — nothing in the
   * body of the book was reachable, and neither was the chapter it sits in.
   * Typing "Family" returned "Nothing in this book matches" while chapter 15
   * IS "FAMILY PLANNING (FP)", because not one of its twenty-two sections is
   * titled "family". The book was not missing it; the search could not see it.
   *
   * The fix is not a bigger binary. This is 551 rows that are already in
   * memory — scoring them in one pass needs no module at all, is a few
   * milliseconds, and can weigh a heading against a chapter against a passing
   * mention, which `rank` cannot. So there is now ONE search path, used by
   * every book, and it is the one the tests measure.
   */

  // The columns that hold the words of the book, per book. full_text alone is
  // not enough: 148 of the named field values are not inside it (the parser
  // rewrote whitespace, and inherited text carries a note), so a word can be
  // in Management and nowhere else.
  var BODY_COLS = {
    ucg: ['causes', 'clinical_features', 'differential', 'investigations',
          'management', 'prevention', 'complications', 'notes', 'full_text'],
    who: ['definition', 'causes', 'history', 'examination', 'clinical_features',
          'differential', 'investigations', 'diagnosis', 'management', 'treatment',
          'referral', 'follow_up', 'prevention', 'counselling', 'complications',
          'monitoring', 'red_flags', 'cautions', 'notes', 'full_text', 'tables_text'],
  };

  /* What a match is worth.
   *   heading      — the clinician typed the name of the thing. Nothing beats it.
   *   chapter      — they typed the topic ("family planning", "immunisation").
   *                  This is the one that was missing entirely.
   *   number       — "19.2" should go straight there.
   *   body         — a mention. Worth having, never worth beating a heading. */
  var W_TITLE = 120, W_TITLE_START = 70, W_WORD = 60, W_CHAPTER = 45,
      W_NUMBER = 90, W_BODY = 8;

  /* Words a clinician says that the book does not use.
   *
   * This changes what can be FOUND and nothing else — no alias is ever shown
   * as the book's wording, and the card that opens is the book's own section,
   * unaltered. It is only consulted when the book's own words return nothing,
   * and the screen says plainly that it substituted a word.
   *
   * Brand names are in here because that is what is written on the box in a
   * Ugandan pharmacy; the guideline only ever prints the generic. */
  var SAY_ALSO = [
    ['coartem', 'lumefantrine'], ['panadol', 'paracetamol'],
    ['septrin', 'cotrimoxazole'], ['septrine', 'cotrimoxazole'],
    ['flagyl', 'metronidazole'], ['amoxil', 'amoxicillin'],
    ['piriton', 'chlorphenamine'], ['brufen', 'ibuprofen'],
    ['bp', 'blood pressure'], ['sugars', 'diabetes'], ['sugar disease', 'diabetes'],
    ['tb', 'tuberculosis'], ['fp', 'contracept'], ['anc', 'antenatal'],
    ['jiggers', 'tungiasis'], ['ringworm', 'tinea'], ['piles', 'haemorrhoid'],
    ['sickle cells', 'sickle cell'], ['high blood', 'hypertension'],
  ];
  function alsoTry(term) {
    var t = String(term).toLowerCase().trim();
    for (var i = 0; i < SAY_ALSO.length; i++) {
      if (SAY_ALSO[i][0] === t) return SAY_ALSO[i][1];
    }
    return '';
  }
  var _alias = '';   // what was substituted for the last search, if anything

  // SQLite's LIKE is case-insensitive for ASCII, so nothing is lowered here —
  // lower()ing a 21,000-character full_text once per row per token is the one
  // thing that would make this slow enough to feel.
  function scanConditions(toks) {
    var cols = BODY_COLS[book] || BODY_COLS.ucg;
    var bodyOr = cols.map(function (c) { return "ifnull(" + c + ",'') LIKE ?"; }).join(' OR ');
    var score = [], where = [], sp = [], wp = [];
    toks.forEach(function (t) {
      var any = '%' + t + '%', start = t + '%';
      score.push(
        '(CASE WHEN title LIKE ? THEN ' + W_TITLE + ' ELSE 0 END)' +
        '+(CASE WHEN title LIKE ? THEN ' + W_TITLE_START + ' ELSE 0 END)' +
        // At the start of a WORD in the heading, not buried inside one. Without
        // this, "ORS" put "Refractive Err-ors" above oral rehydration salts,
        // and every short name a clinician types has the same problem.
        '+(CASE WHEN title LIKE ? OR title LIKE ? THEN ' + W_WORD + ' ELSE 0 END)' +
        "+(CASE WHEN ifnull(chapter_title,'') LIKE ? THEN " + W_CHAPTER + ' ELSE 0 END)' +
        "+(CASE WHEN ifnull(number,'') LIKE ? THEN " + W_NUMBER + ' ELSE 0 END)' +
        '+(CASE WHEN ' + bodyOr + ' THEN ' + W_BODY + ' ELSE 0 END)');
      sp.push(any, start, '% ' + t + '%', '%(' + t + '%', any, start);
      cols.forEach(function () { sp.push(any); });
      // Every word has to appear SOMEWHERE — "malaria child" must not return
      // every section that mentions a child.
      where.push("(title LIKE ? OR ifnull(chapter_title,'') LIKE ? OR " +
                 "ifnull(number,'') LIKE ? OR " + bodyOr + ')');
      wp.push(any, any, start);
      cols.forEach(function () { wp.push(any); });
    });
    try {
      return rows(
        'SELECT id, number, title, chapter_title, page, ' + score.join('+') + ' AS _s ' +
        'FROM conditions WHERE ' + where.join(' AND ') +
        ' ORDER BY _s DESC, length(title) ASC LIMIT 12', sp.concat(wp));
    } catch (e) { return []; }
  }

  function searchConditions(term) {
    _alias = '';
    var toks = ftsTokens(term);
    if (!toks.length) return [];

    // The book's own addressing. "19.2" must open 19.2 Malnutrition — it used
    // to be split into the tokens "19" and "2", and "19" matched the title
    // "COVID-19 Disease" as a heading word, which outranked everything.
    var raw = String(term).trim();
    if (/^\d{1,2}(?:\.\d{1,3})*\.?$/.test(raw)) {
      var byNum = rows('SELECT id, number, title, chapter_title, page FROM conditions ' +
                       'WHERE number = ? OR number LIKE ? ORDER BY length(number), id LIMIT 12',
                       [raw.replace(/\.$/, ''), raw.replace(/\.$/, '') + '.%']);
      if (byNum.length) return byNum;
    }

    var out = scanConditions(toks);
    // A word the book does not use. Only ever consulted when the book's own
    // words found nothing, and the screen says what was substituted.
    if (!out.length) {
      var also = alsoTry(raw);
      if (also) {
        var second = scanConditions(ftsTokens(also));
        if (second.length) { _alias = also; out = second; }
      }
    }
    // A section the import buried inside its neighbour has no row of its own,
    // so it can only be found by looking at the list we built.
    var lower = String(term).toLowerCase();
    var hidden = (book === 'ucg' ? findBuried() : []).filter(function (b) {
      return b.title.toLowerCase().indexOf(lower) >= 0;
    }).map(function (b) {
      return { id: b.key, number: b.number, title: b.title,
               chapter_title: 'in ' + b.hostTitle, page: b.page };
    });
    // And the chapter itself, when that is what was typed. "Family planning"
    // is a chapter, not a condition; offering the way in to all of it is a
    // better answer than the first twelve of its sections.
    // Only for the Uganda book: tapping one opens the contents page, and the
    // contents page is built from that book. Offering it on the children's
    // book would hand the clinician a chapter list of a different book.
    var chs = [];
    try {
      chs = (book !== 'ucg' ? [] :
        rows('SELECT number, title FROM chapters WHERE title LIKE ? ORDER BY number',
             ['%' + toks[0] + '%'])).map(function (ch) {
        return { id: 'ch:' + ch.number, number: String(ch.number),
                 title: ch.title, chapter_title: 'whole chapter · tap to open',
                 chapter: true };
      });
    } catch (e) { chs = []; }
    return chs.concat(hidden, out).slice(0, 12);
  }

  // Drug search groups the annex rows by name: one drug, one result, however
  // many formulations the book lists under it. Same reason as above — the
  // FTS5 index is unreadable here, so what the book says a drug is FOR was
  // never searchable either.
  function searchDrugs(term) {
    var toks = ftsTokens(term);
    if (!toks.length) return [];
    var score = [], where = [], sp = [], wp = [];
    toks.forEach(function (t) {
      var any = '%' + t + '%', start = t + '%';
      score.push('(CASE WHEN name LIKE ? THEN ' + W_TITLE + ' ELSE 0 END)' +
                 '+(CASE WHEN name LIKE ? THEN ' + W_TITLE_START + ' ELSE 0 END)' +
                 "+(CASE WHEN ifnull(indication,'') LIKE ? THEN " + W_BODY + ' ELSE 0 END)');
      sp.push(any, start, any);
      where.push("(name LIKE ? OR ifnull(indication,'') LIKE ?)");
      wp.push(any, any);
    });
    var out = [];
    try {
      out = rows(
        'SELECT name_normalized AS key, MIN(name) AS title, ' +
        "GROUP_CONCAT(DISTINCT indication) AS chapter_title, MAX(" + score.join('+') + ') AS _s ' +
        'FROM drugs WHERE ' + where.join(' AND ') + ' GROUP BY name_normalized ' +
        'ORDER BY _s DESC, length(MIN(name)) ASC LIMIT 12', sp.concat(wp));
    } catch (e) { out = []; }
    return out.map(function (r) {
      return { id: r.key, number: '', title: r.title, chapter_title: r.chapter_title || '', drug: true };
    });
  }

  function renderAutocomplete(items, term) {
    var box = $('gResults');
    _acItems = items; _acIndex = -1;
    if (!items.length) {
      box.innerHTML = '<div class="g-ac-empty">Nothing in this book matches “' +
        esc(term) + '”. Every word of the guideline is searched, not just the ' +
        'headings, so try another word for it — or use the contents page below, ' +
        'which lists the whole book.' + (book === 'ucg'
          ? ' The children’s book above has the paediatric doses by weight.' : '') + '</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = (_alias
      ? '<div class="g-ac-alias">The guideline does not use the word “' + esc(term) +
        '”. Showing what it calls “' + esc(_alias) + '”.</div>'
      : '') + items.map(function (r, i) {
      return '<div class="g-ac-item' + (r.chapter ? ' g-ac-chapter' : '') + '" data-i="' + i + '">' +
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
  /* ── The book, laid out as the book ──────────────────────────────────────
   *
   * The guideline text comes out of the PDF with its shape flattened. Every
   * line has zero indentation, bullets are a literal tilde, and a single
   * bullet is broken across as many lines as the column was wide:
   *
   *     ~ Keep emergency drugs at hand at health facilities and in
   *     situatiuons where risk of anaphlaxis is high, e.g. visiting
   *     bee hives or places that usually harbour snakes
   *
   * Shown raw, that reads as three separate lines and a stray "~". There are
   * 8,014 of those tildes across the book, so almost every clinical list in it
   * was being shown broken.
   *
   * NOTHING IS DROPPED. The markers become real bullets and the wrapped lines
   * are rejoined into the sentence they were always part of; every word
   * survives. tests/measure-guidelines.js proves that across all 551 sections
   * and every text column — word for word, not by inspection — because a
   * renderer that quietly loses a line of a treatment is far worse than one
   * that shows a tilde.
   */
  var MARK_RE = /^\s*([~•\-–—*>]|\d{1,2}[.)]|[a-z][.)])\s+/;

  // A heading inside a section: the book sets these in capitals, e.g.
  // "INSTRUCTIONS LOC", "DIAGNOSIS". Short, no lower case, not a sentence.
  function isHeading(line) {
    var s = line.trim();
    if (s.length < 2 || s.length > 60) return false;
    if (MARK_RE.test(s)) return false;
    if (!/[A-Z]/.test(s)) return false;
    if (/[a-z]/.test(s)) return false;
    return /^[A-Z0-9 ()/&,.'’\-:%]+$/.test(s);
  }

  /* Was this line WRAPPED, or did it end on purpose?
   *
   * This is the whole question, and the text carries the answer physically.
   * The PDF set the book to a fixed column, so a line that ran to the margin
   * was broken by the typesetter and continues below; a line that stopped
   * short ended because the sentence or the item ended. Measured across the
   * whole book: lines pile up to about 60 characters and fall off a shelf
   * after that — only 3.2% exceed 72.
   *
   * The width is not the same everywhere (tables and two-column pages are
   * narrower), so it is measured per block rather than assumed. The 85th
   * percentile, not the maximum: one freak 127-character line in the
   * malnutrition notes would otherwise raise the bar above every real line
   * and nothing would join at all.
   *
   * This is what tells "…mild illness (uncomplicated malaria) or" + "severe
   * illness (severe malaria)" — one sentence, wrapped — from the next line
   * "Intermittent fever is the most characteristic symptom", which is a new
   * one. Joining blindly welds those two together; never joining leaves the
   * book unreadable. The margin knows.
   */
  function wrapWidth(lines) {
    var lens = [];
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].replace(/\s+$/, '');
      if (s.trim()) lens.push(s.length);
    }
    if (!lens.length) return 0;
    lens.sort(function (a, b) { return a - b; });
    var p85 = lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.85))];
    return p85;
  }

  function outline(t) {
    var raw = String(t == null ? '' : t);
    if (!raw.trim()) return '';
    var lines = raw.split('\n');
    var W = wrapWidth(lines);
    // 12 characters of slack: the typesetter broke at a word boundary, so a
    // wrapped line stops a little short of the margin.
    var FULL = Math.max(24, W - 12);
    var ranToMargin = function (s) { return s.replace(/\s+$/, '').length >= FULL; };
    var blocks = [];      // {kind:'h'|'li'|'p', text, ord:bool}
    var cur = null;

    function close() { if (cur) { blocks.push(cur); cur = null; } }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { close(); continue; }

      if (isHeading(line)) { close(); blocks.push({ kind: 'h', text: line.trim() }); continue; }

      var m = line.match(MARK_RE);
      if (m) {
        close();
        var lead = m[1];
        var num = lead.match(/^(\d{1,2})[.)]$/);
        var letter = /^[a-z][.)]$/.test(lead);
        cur = {
          kind: 'li',
          /* A NUMBER IS NOT A BULLET. "2." in the book means the second step,
           * and a list that renumbers from 1 because the section happened to
           * start at 2 is a different instruction. The source number is kept
           * and forced onto the item, never regenerated.
           *
           * A lettered marker (a. b. c.) keeps its letter inline for the same
           * reason — CSS counters would not reproduce the book's sequence. */
          ord: !!num,
          value: num ? num[1] : '',
          text: (letter ? lead + ' ' : '') + line.slice(m[0].length).trim(),
          lastRaw: line,
        };
        continue;
      }

      /* No marker. Two very different cases, and treating them the same was
       * wrong in a way that mattered.
       *
       * INSIDE A BULLET, this is the rest of that bullet, wrapped by the PDF
       * column. Joining it back is the whole point.
       *
       * OUTSIDE ONE, it is a line of the book's own prose — and joining those
       * produced a wall of run-on text, because the extraction dropped the
       * full stops with the layout: Malaria's clinical features came out as
       * "…or severe illness (severe malaria) Intermittent fever is the most
       * characteristic symptom…", two sentences welded together with nothing
       * between them. There is no punctuation left to tell where one ends, so
       * the book's line breaks are the only structure remaining and they are
       * kept exactly as they are.
       */
      /* Join it to what is above only if that line ran to the margin. A short
       * line ended on purpose — the sentence finished, or it is the next item
       * in a list the book set without bullets — and welding those together is
       * what made the malaria features read as one run-on wall. */
      if (cur && cur.kind === 'li') {
        if (ranToMargin(cur.lastRaw)) { cur.text += ' ' + line.trim(); }
        else { close(); cur = { kind: 'p', lines: [line.trim()] }; }
      } else if (cur && cur.kind === 'p') {
        if (ranToMargin(cur.lastRaw)) {
          cur.lines[cur.lines.length - 1] += ' ' + line.trim();
        } else {
          cur.lines.push(line.trim());
        }
      } else {
        cur = { kind: 'p', lines: [line.trim()] };
      }
      if (cur) cur.lastRaw = line;
    }
    close();

    var out = '', open = null;
    function shut() { if (open) { out += '</' + open + '>'; open = null; } }
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.kind === 'h') { shut(); out += '<h4 class="g-oh">' + markSeverity(blk.text) + '</h4>'; continue; }
      if (blk.kind === 'p') {
        shut();
        // One paragraph block, the book's line breaks kept inside it.
        out += '<p class="g-op">' + blk.lines.map(markSeverity).join('<br>') + '</p>';
        continue;
      }
      var want = blk.ord ? 'ol' : 'ul';
      if (open !== want) { shut(); out += '<' + want + ' class="g-ol">'; open = want; }
      out += '<li' + (blk.ord && blk.value ? ' value="' + esc(blk.value) + '"' : '') + '>' +
        markSeverity(blk.text) + '</li>';
    }
    shut();
    return out;
  }

  function asText(t) {
    var src = book === 'who' ? deMark(t) : t;
    var laid = outline(src);
    // outline() returning nothing for text that HAS content would silently
    // blank a clinical section, so the raw form is the fallback rather than
    // an empty box.
    if (!laid) return '<div class="g-text">' + markSeverity(src) + '</div>';
    return '<div class="g-text g-outline">' + laid + '</div>';
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
  // Every title the book gives a section of its own, keyed for comparison.
  // Built once — it is asked per heading, per card.
  var _titles = null;
  function knownTitles() {
    if (_titles) return _titles;
    _titles = {};
    rows('SELECT title FROM conditions', []).forEach(function (r) {
      _titles[String(r.title || '').toLowerCase().replace(/[^a-z]/g, '')] = 1;
    });
    return _titles;
  }

  // The sections the book prints under a heading. The numbering is the book's
  // own — 19.2.1 and 19.2.2 sit under 19.2 — so nothing is guessed. Direct
  // children only: tapping one that is itself a heading shows ITS children,
  // which is exactly how the printed contents page reads.
  function childrenOf(c) {
    var num = String(c.number || '').trim();
    if (!num) return [];
    var kids = rows('SELECT id, number, title, page FROM conditions ' +
                    'WHERE number LIKE ? ORDER BY id', [num + '.%']);
    var direct = kids.filter(function (k) {
      return String(k.number || '').slice(num.length + 1).indexOf('.') < 0;
    });
    return direct.length ? direct : kids;
  }

  /* Where a section stops being itself — the two-kinds lookup, shared by the
   * medicines table below and by the fields. Kept in one place so a heading
   * this screen calls a boundary in one paragraph cannot be ignored in the
   * next. */
  function sectionLookup(c) {
    return function (num, headingText) {
      var t = String(headingText || '').trim();
      var tt = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
      var row = one('SELECT id, title FROM conditions WHERE number = ? LIMIT 1', [num]);
      // The number alone is not enough: the extraction mis-numbered part of
      // the book, so the row numbered 6.5.4.2 is titled "Spontaneous Bacterial
      // Peritonitis" while the heading printed there reads "Oesophageal
      // Varices". A row whose title is not the words on the page is not this
      // heading — ask the second question instead.
      if (row && tt(t).indexOf(tt(row.title).slice(0, 12)) === 0) return row;
      // One of the seven headings the import buried inside a neighbour, which
      // have no row at all — and which this screen already lists on its
      // contents page. Same test as findBuried(), so the two can never
      // disagree about what a section is.
      if (t.length < 4 || /^(MU|IU|mg|ml|g|kg|mcg|units?)\b/i.test(t)) return null;
      if (String(num).split('.')[0] !== String(c.chapter_number)) return null;
      var k = tt(t);
      if (!k || knownTitles()[k]) return null;
      return { title: t, buried: true };
    };
  }

  function renderUcg(id) {
    var c = one(
      'SELECT id, number, title, chapter_number, chapter_title, icd10, page, causes, ' +
      'clinical_features, differential, investigations, management, prevention, ' +
      'complications, notes, full_text FROM conditions WHERE id = ? LIMIT 1', [id]);
    if (!c) return '';

    /* ── Where this section ends ─────────────────────────────────────────
     *
     * Three rows of 551 run past their own end and carry the next sections'
     * text — the worst is "Postnatal Psychosis", 21,058 characters holding
     * Anxiety, Depression, Bipolar Disorder and Psychosis. Their management
     * was being shown, under this heading, as this condition's management.
     *
     * The fields cannot be cut by heading: `management` for that row is 7,709
     * characters with NOT ONE heading in it, because the extraction took them
     * out when it split the fields. full_text is the only field that still
     * carries the book's structure, so it is the arbiter — a line of any other
     * field is kept only if it is inside this section's own stretch of it.
     *
     * Nothing is lost: the source panel at the bottom of every card still
     * shows the section exactly as the book sets it, run-on and all, and the
     * card says plainly that it was cut. */
    var ranOn = false, ownText = null;
    try {
      if (window.HomattUcgSections && c.full_text) {
        var bs = window.HomattUcgSections.boundaries(c, sectionLookup(c));
        if (bs.length) {
          ownText = String(c.full_text).slice(0, bs[0].at).replace(/\s+/g, ' ').toLowerCase();
          ['causes', 'clinical_features', 'differential', 'investigations',
           'management', 'prevention', 'complications', 'notes'].forEach(function (k) {
            if (!c[k]) return;
            var lines = String(c[k]).split('\n'), out = [], dropped = false;
            lines.forEach(function (ln) {
              var f = ln.replace(/\s+/g, ' ').trim().toLowerCase();
              // A blank or a scrap too short to locate follows the line above
              // it rather than being judged on its own.
              if (f.length < 4) { if (out.length) out.push(ln); return; }
              if (ownText.indexOf(f) >= 0) out.push(ln); else dropped = true;
            });
            if (dropped) { c[k] = out.join('\n'); ranOn = true; }
          });
          // The note goes on whenever a boundary exists, not only when a line
          // was dropped: the treatment steps are filtered further down, after
          // the card's header has already been built, and a cut nobody was
          // told about is the thing this note exists to prevent.
          c._ranOn = bs.map(function (b) { return b.title; });
        }
      }
    } catch (e) {}

    var tr = rows(
      'SELECT level_of_care, treatment, step_order FROM treatments ' +
      'WHERE condition_id = ? ORDER BY CASE level_of_care WHEN \'HC2\' THEN 1 ' +
      "WHEN 'HC3' THEN 2 WHEN 'HC4' THEN 3 WHEN 'H' THEN 4 WHEN 'GH' THEN 5 " +
      "WHEN 'RR' THEN 6 WHEN 'NR' THEN 7 ELSE 8 END, step_order", [id]);
    var meds = rows(
      'SELECT name, dose, unit, route, frequency, duration, source_line FROM medicines ' +
      'WHERE condition_id = ? ORDER BY id', [id]);

    /* Some of those rows are printed under a DIFFERENT heading. One section
     * in 551 ("9.2.4.1 Postnatal Psychosis") ran past its own end and
     * swallowed six more, so 26 medicines — lithium, clozapine, alprazolam,
     * bupropion among them — are filed against a woman who has just given
     * birth. Every one of them is a real line of the real book, which is why
     * nothing short of reading the section boundaries can see it.
     *
     * This is the reference screen, not the prescribing one, so nothing is
     * hidden: the row is kept and labelled with the section that really
     * prints it. The package screen takes them out of what it offers.
     * (tests/measure-doses.js) */
    try {
      if (window.HomattUcgSections) {
        meds = window.HomattUcgSections.attribute(c, meds, sectionLookup(c));
      }
    } catch (e) {}

    var LOC_LABEL = {
      HC2: 'HC2 — Health Centre II', HC3: 'HC3 — Health Centre III',
      HC4: 'HC4 — Health Centre IV', H: 'H — Hospital', GH: 'GH — General Hospital',
      RR: 'RR — Regional Referral', NR: 'NR — National Referral',
    };

    var head = '<div class="g-head">' +
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
    var html = head;

    if (c._ranOn && c._ranOn.length) {
      html += '<div class="g-sec g-ranon-note">' +
        '<b>This section runs on into the next one in the printed book.</b> ' +
        'The extraction did not stop where the book does, so what was filed ' +
        'here also held ' +
        c._ranOn.map(function (t) { return '“' + esc(t) + '”'; }).join(', ') +
        '. The parts below have been cut back to what the guideline prints ' +
        'under <i>' + esc(c.title) + '</i>. Nothing is lost — the whole ' +
        'stretch, run-on and all, is at the bottom of this card exactly as ' +
        'the book sets it.</div>';
    }

    /* Did the extraction find the SUBSTANCE of this section?
     *
     * "Did it find anything at all" is the wrong question, and asking it was
     * a real fault. Twelve sections parsed only the secondary fields — a
     * differential, a note — and nothing else. They rendered as a title with
     * two or three grey folded panels under it and not one readable word:
     * indistinguishable, to a clinician, from a section the app does not
     * have. "Clinical Features of HIV" was one of them, and the parse had
     * captured 8 of its 203 distinct words.
     *
     * Measured for all twelve: full_text contains everything the parsed
     * fields contain and between 2 and 195 words more. So where the substance
     * was not found, the book's own text IS the section — complete, laid out
     * like everything else, and labelled as the book's own wording. Nothing
     * is lost and nothing is invented, which is the only trade worth making
     * in a book people treat from.
     */
    var hasPrimary = !!(String(c.clinical_features || '').trim() ||
                        String(c.investigations || '').trim() ||
                        String(c.management || '').trim() ||
                        tr.length || meds.length);

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

    /* The treatment STEPS carry it too, and they were the last place it hid.
     * "Treatment steps by level of care" for this row was 7,682 characters of
     * four other sections' protocols, printed as the steps for this one. A
     * step is a line of the same page, so the same arbiter answers it. */
    if (ownText) {
      var before = tr.length;
      tr = tr.filter(function (t) {
        var f = String(t.treatment || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return f.length < 4 || ownText.indexOf(f) >= 0;
      });
      if (tr.length !== before) ranOn = true;
    }

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
          return '<tr' + (m.printedUnder ? ' class="g-md-else"' : '') + '>' +
            '<td class="g-md-name">' + esc(m.name) +
            (m.printedUnder
              ? '<span class="g-md-under">printed under “' + esc(m.printedUnder.title) +
                '”, not this heading</span>' : '') + '</td>' +
            '<td class="g-md-dose">' + esc([m.dose, m.unit].filter(Boolean).join(' ')) + '</td>' +
            '<td>' + esc(m.route || '—') + '</td>' +
            '<td>' + esc(m.frequency || '—') + '</td>' +
            '<td>' + esc(m.duration || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (meds.some(function (m) { return m.printedUnder; })
          ? '<div class="g-verify g-verify-warn">The rows marked above are lines the ' +
            'guideline prints further down the page, under a different heading — this ' +
            'section\'s text runs on past its own end in the printed book. They are not ' +
            'this condition\'s treatment. The treatment package does not offer them.</div>'
          : '') +
        '<div class="g-verify">Verify every dose against the source text below before prescribing.</div>');
    }

    if (hasPrimary) {
      html += section('Causes', c.causes ? asText(c.causes) : '', { collapsible: true });
      html += section('Differential diagnosis', c.differential ? asText(c.differential) : '', { collapsible: true });
      html += section('Complications', c.complications ? asText(c.complications) : '', { collapsible: true });
      html += section('Prevention', c.prevention ? asText(c.prevention) : '', { collapsible: true });
      html += section('Notes', c.notes ? asText(c.notes) : '', { collapsible: true });
    }

    /* ── When the automatic split found nothing ──────────────────────────
     *
     * 148 of the book's 551 sections carry no named field at all — no
     * clinical features, no management, no steps — because the extraction
     * could not find the headings it looks for. 95 of those DO have the
     * book's text; some of it substantial (HIV-exposed infant care is nearly
     * 11,000 characters).
     *
     * Until now every one of them opened as an empty card with a collapsed
     * "view source" panel underneath: a quarter of the book looked missing
     * and read as raw text when anybody went looking for it.
     *
     * So where nothing was parsed, the book's own text IS the section —
     * laid out like everything else, and labelled honestly so nobody thinks
     * it has been through the same tidying as a parsed card.
     */
    if (!hasPrimary) {
      if (c.full_text && c.full_text.trim()) {
        html += '<div class="g-sec g-asprinted-note">' +
          'The automatic split found no named parts in this section, so it is ' +
          'shown here as the book sets it, in full.' +
          '</div>' +
          section('As printed in the guideline', asText(c.full_text));
      } else {
        /* ── A heading with nothing under it but its own children ───────
         *
         * 53 of the 551 sections hold no text at ALL — not a named field,
         * not even full_text. They are the numbered headings the book uses
         * to group things: "19.2 Malnutrition", "19.1 Nutrition Guidelines
         * in Special Populations", "15.2 Overview of Key Contraceptive
         * Methods". In the printed book the heading is followed straight
         * away by its sub-sections, and all of the text is in those.
         *
         * Opening one used to give a title, a sentence saying the content
         * "is in the sections listed under it" — and then no list. Nothing
         * was listed anywhere on the card. A clinician who searched
         * "Malnutrition" got a card with no malnutrition in it.
         *
         * So the heading now shows what is actually under it, tappable, in
         * the book's own order. That IS the content of a heading.
         */
        var kids = childrenOf(c);
        html += '<div class="g-sec g-asprinted-note">' +
          'This is a heading in the book. The guideline prints no text under it ' +
          'directly — everything it covers is in the ' + kids.length + ' section' +
          (kids.length === 1 ? '' : 's') + ' below.' +
          '</div>';
        if (kids.length) {
          html += section('What this heading covers',
            '<div class="g-kidlist">' + kids.map(function (k) {
              return '<button type="button" class="g-kid" data-open="' + esc(String(k.id)) + '">' +
                '<span class="g-kid-n">' + esc(k.number || '') + '</span>' +
                '<span class="g-kid-t">' + esc(k.title) + '</span>' +
                (k.page ? '<span class="g-kid-p">p.' + esc(String(k.page)) + '</span>' : '') +
                '</button>';
            }).join('') + '</div>');
        }
      }
    }

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

  /* ── The contents page ───────────────────────────────────────────────────
   *
   * Search alone hides everything a clinician cannot already name. Nobody
   * types "Condom (Male)", "Vitamin A Deficiency" or "Kangaroo Mother Care"
   * unless they already know the section is in there — so 551 sections across
   * 24 chapters were reachable only by guessing the right word, and four whole
   * chapters that are not diseases at all (family planning, immunisation,
   * nutrition, palliative care) looked as though they were missing.
   *
   * Every chapter, every section, nothing filtered and nothing capped. It is
   * built once and kept, because it is the same 551 rows every time.
   */
  /* ── Sections the import buried inside their neighbour ───────────────────
   *
   * Seven headings in this book were swallowed by the section printed before
   * them, so they exist in the text and in no index: searching "adenoid",
   * "varices" or "alcohol" finds nothing, and the only way to reach roughly
   * 30,000 characters of clinical text is to open the wrong condition and
   * scroll past the end of it.
   *
   *   Oesophageal Varices            inside Hepatic Encephalopathy   p.437
   *   Hepatorenal Syndrome           inside Hepatic Encephalopathy   p.437
   *   Alcohol Use Disorders          inside Postnatal Psychosis      p.541
   *   Substance Abuse                inside Postnatal Psychosis      p.541
   *   Childhood Behavioural Disorders    "         "                 p.541
   *   Childhood Developmental Disorders  "         "                 p.541
   *   Adenoid Disease                inside Atrophic Rhinitis        p.962
   *
   * Adenoid Disease shows why: the book itself numbers it 21.2.6, the SAME
   * number as the Atrophic Rhinitis printed above it. The importer keyed on
   * the number, so the second one had nowhere to go.
   *
   * Nothing is moved or removed — the host keeps its text exactly as it is.
   * These are ADDED as sections in their own right, findable by name and
   * listed in their chapter, each showing its own slice and saying where in
   * the book it is printed. Found by scanning the real text rather than by a
   * hand-written list, so a rebuilt book with these fixed simply yields none.
   */
  var _buried = null;
  var BURIED_HEAD = /(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,3})[ \t]+([A-Z][^\n]{2,80})/g;
  var BURIED_UNIT = /^(MU|IU|mg|ml|g|kg|mcg|units?)\b/i;

  function findBuried() {
    if (_buried) return _buried;
    _buried = [];
    if (book !== 'ucg' || !cur().db) return _buried;
    var all = rows('SELECT id, number, title, chapter_number, page, full_text FROM conditions');
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
    var known = {};
    all.forEach(function (r) { known[norm(r.title)] = true; });

    all.forEach(function (r) {
      var txt = r.full_text;
      if (!txt) return;
      var hostNorm = norm(r.title), m;
      BURIED_HEAD.lastIndex = 0;
      while ((m = BURIED_HEAD.exec(txt)) !== null) {
        var num = m[1];
        var t = m[2].replace(/\s*ICD[- ]?10.*$/i, '').replace(/\s*CODE:.*$/i, '').trim();
        if (t.length < 4 || BURIED_UNIT.test(t)) continue;
        var tn = norm(t);
        if (!tn || tn === hostNorm || known[tn]) continue;
        // A real subsection carries its host's own chapter number; "2.4 MU IM"
        // in a chapter-3 page is a dose, not a heading.
        if (parseInt(num.split('.')[0], 10) !== Number(r.chapter_number)) continue;
        _buried.push({
          key: 'b' + r.id + '_' + _buried.length,
          hostId: r.id, hostTitle: r.title, number: num, title: t,
          chapter_number: r.chapter_number, page: r.page,
          start: m.index + (m[0][0] === '\n' ? 1 : 0),
        });
      }
    });
    // Each slice runs to the next buried heading in the same host, or the end.
    _buried.forEach(function (b) {
      var host = all.filter(function (r) { return r.id === b.hostId; })[0];
      var later = _buried.filter(function (o) {
        return o.hostId === b.hostId && o.start > b.start;
      }).map(function (o) { return o.start; });
      b.end = later.length ? Math.min.apply(null, later) : host.full_text.length;
      b.text = host.full_text.slice(b.start, b.end);
    });
    return _buried;
  }

  function buriedByKey(key) {
    var list = findBuried();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  // One of these, rendered as its own section.
  function renderBuried(key) {
    var b = buriedByKey(key);
    if (!b) return '';
    // Drop the heading line itself; it becomes the title above.
    var body = b.text.replace(/^[^\n]*\n?/, '');
    return '<div class="g-head">' +
      '<div class="g-head-num">' + esc(b.number) + '</div>' +
      '<h2>' + esc(b.title) + '</h2>' +
      '<div class="g-chips">' +
        '<span class="g-chip">Ch ' + esc(String(b.chapter_number)) + '</span>' +
        (b.page ? '<span class="g-chip">UCG 2023 p.' + esc(String(b.page)) + '</span>' : '') +
      '</div></div>' +
      '<div class="g-sec g-buried-note">' +
        'In the printed book this section runs on from <b>' + esc(b.hostTitle) +
        '</b> without a break of its own, so it had no entry to be found by. ' +
        'The text below is exactly as printed. ' +
        '<button type="button" class="g-buried-open" data-openhost="' + esc(String(b.hostId)) +
        '">Open ' + esc(b.hostTitle) + '</button>' +
      '</div>' +
      section('The guideline text', asText(body)) +
      sourcePanel(b.text, 'UCG 2023' + (b.page ? ', p.' + b.page : ''));
  }

  var _browseBuilt = false;
  function buildBrowse() {
    var host = $('gBrowse');
    if (!host || _browseBuilt || !cur().db) return;
    if (book !== 'ucg') { host.innerHTML = ''; return; }

    var chs = rows('SELECT number, title FROM chapters ORDER BY number');
    if (!chs.length) return;
    var secs = rows('SELECT id, number, title, chapter_number, page FROM conditions ' +
                    'ORDER BY chapter_number, id');
    var by = {};
    secs.forEach(function (s) {
      var k = String(s.chapter_number);
      (by[k] = by[k] || []).push(s);
      // A section the import buried inside this one is listed right after it,
      // where the book prints it — so the contents page matches the book.
      findBuried().filter(function (b) { return b.hostId === s.id; })
        .forEach(function (b) {
          by[k].push({ id: null, buried: b.key, number: b.number,
                       title: b.title, chapter_number: b.chapter_number, page: b.page });
        });
    });

    // Count what is actually listed, which is the book's sections PLUS the
    // ones recovered from inside their neighbour. A number that does not match
    // the list under it is worse than no number.
    var listed = 0;
    Object.keys(by).forEach(function (k) { listed += by[k].length; });
    var extra = listed - secs.length;
    var html = '<div class="g-browse-h">' +
      '<span class="material-icons-outlined">list_alt</span>' +
      'Everything in the guideline' +
      '<span class="g-browse-n">' + listed + ' sections · ' + chs.length + ' chapters</span>' +
      '</div>' +
      (extra > 0
        ? '<div class="g-browse-note">' + extra + ' of these run on from the section before ' +
          'them in the printed book and had no entry of their own. They are listed here, ' +
          'in their place, so they can be found.</div>'
        : '');

    chs.forEach(function (ch) {
      var list = by[String(ch.number)] || [];
      html += '<details class="g-ch" data-ch="' + esc(String(ch.number)) + '"><summary>' +
        '<span class="g-ch-n">' + esc(String(ch.number)) + '</span>' +
        '<span class="g-ch-t">' + esc(ch.title) + '</span>' +
        '<span class="g-ch-c">' + list.length + '</span>' +
        '</summary><div class="g-ch-list">' +
        (list.length ? list.map(function (s) {
          return '<button type="button" class="g-ch-item"' +
            (s.buried ? ' data-buried="' + esc(s.buried) + '"' : ' data-open="' + esc(String(s.id)) + '"') + '>' +
            '<span class="g-ci-t">' + esc(s.title) + '</span>' +
            (s.page ? '<span class="g-ci-p">p.' + esc(String(s.page)) + '</span>' : '') +
            '</button>';
        }).join('') : '<div class="g-ch-empty">No sections listed for this chapter.</div>') +
        '</div></details>';
    });

    host.innerHTML = html;
    _browseBuilt = true;
    host.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-open],[data-buried]');
      if (!t) return;
      if (t.hasAttribute('data-buried')) open(t.getAttribute('data-buried'));
      else open(Number(t.getAttribute('data-open')));
    });
  }

  // ── Opening a result ────────────────────────────────────────────────────
  function open(id) {
    $('gResults').style.display = 'none';
    if (!cur().db) return;
    // A whole chapter — "family planning", "immunisation". Not a card: the
    // contents page already lists exactly what is in it, so open it there.
    if (typeof id === 'string' && id.indexOf('ch:') === 0) {
      openChapter(id.slice(3));
      return;
    }
    var card = $('gCard');
    card.setAttribute('data-cid', id);
    card.setAttribute('data-book', book);
    card.setAttribute('data-mode', mode);
    var html;
    if (typeof id === 'string' && /^b\d+_/.test(id)) html = renderBuried(id);
    else if (book === 'who' && mode === 'doses') html = renderDrug(id);
    else if (book === 'who') html = renderWho(id);
    else html = renderUcg(id);
    if (!html) return;
    card.innerHTML = html;
    card.style.display = 'block';
    $('gEmpty').style.display = 'none';
    if ($('gBrowse')) $('gBrowse').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function reopen() {
    var id = $('gCard').getAttribute('data-cid');
    if (id) open(book === 'who' && mode === 'doses' ? id : Number(id));
  }

  // Show the contents page with one chapter open and in view. This is the
  // answer to "where is family planning" — the chapter is the thing, and its
  // twenty-two sections are already listed here in the book's own order.
  function openChapter(num) {
    var host = $('gBrowse');
    if (!host) return;
    buildBrowse();
    $('gCard').style.display = 'none';
    $('gEmpty').style.display = 'none';
    host.style.display = 'block';
    var want = host.querySelector('details[data-ch="' + String(num).replace(/"/g, '') + '"]');
    Array.prototype.forEach.call(host.querySelectorAll('details'), function (d) {
      d.open = (d === want);
    });
    if (want && want.scrollIntoView) want.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        // NOT "a disease or condition": a quarter of this book is neither —
        // family planning, immunisation, nutrition, palliative care — and a box
        // asking for a disease tells a clinician those chapters are not here.
        : 'Search anything in the guideline — malaria, implants, immunisation…';
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
    if ($('gBrowse')) { $('gBrowse').style.display = book === 'ucg' ? 'block' : 'none'; }
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
      // The rows, not box.children — there may be a note above them saying a
      // word was substituted, and counting that as a row put the highlight on
      // the wrong one.
      Array.prototype.forEach.call(box.querySelectorAll('.g-ac-item'), function (el, i) {
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
  // "Open <host>" inside a buried section, and the sections listed under a
  // heading that has no text of its own.
  $('gCard').addEventListener('click', function (e) {
    var oh = e.target.closest && e.target.closest('[data-openhost]');
    if (oh) { open(Number(oh.getAttribute('data-openhost'))); return; }
    var kid = e.target.closest && e.target.closest('.g-kid');
    if (kid) { open(Number(kid.getAttribute('data-open'))); return; }
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
      if ($('gBrowse')) { $('gBrowse').style.display = book === 'ucg' ? 'block' : 'none'; }
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
