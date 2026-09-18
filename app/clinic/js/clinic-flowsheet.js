/* Homatt Health — the vital flowsheet
 *
 * "Monitor her BP every fifteen minutes" and "bring her back next month and we
 * will check it again" are the same question over two timescales: is this
 * person getting worse, holding, or responding? One reading cannot answer it.
 * Two can.
 *
 * ── ONE SHEET, NOT TWO ────────────────────────────────────────────────────
 *
 * The obvious build is a ward chart and a separate long-term tracker. This is
 * one screen that reads its own readings and changes how it presents them:
 * several inside six hours is a ward observation chart, one a day is somebody
 * whose pressure is being followed. The clinician can override the choice,
 * because a rule about time cannot know what is happening in the room.
 *
 * Two screens would be two things to keep correct, and the second one would be
 * the one nobody measured — which is written in this repo already, about the
 * microphone and about the follow-up dose table, and is true a third time.
 *
 * ── THE CHART IS DRAWN HERE, NOT FETCHED ──────────────────────────────────
 *
 * Plain SVG, about a hundred lines. A charting library from a CDN works
 * perfectly on the laptop it was chosen on and is an empty box in Gulu — the
 * same reasoning that had the QR encoder written out rather than imported. The
 * flowsheet has to work with no connection at all, because a ward round with
 * no signal is the normal case and the readings still have to be taken.
 *
 * ── NOTHING IS EVER OVERWRITTEN ───────────────────────────────────────────
 *
 * A reading cannot be edited or deleted, by anybody, and that is enforced in
 * the database (20260916_vital_flowsheet.sql) rather than here. A wrong one is
 * struck through with a reason against it and stays visible and out of the
 * arithmetic. This screen shows it that way.
 *
 * ── COLOURS ───────────────────────────────────────────────────────────────
 *
 * Tokens, never literals. There are four skins and two themes — eight
 * combinations — and a colour written as a hex is readable in the one the
 * author was looking at and invisible in the other seven. That has been
 * measured in this project four separate times. Every word here takes its
 * colour from a token whose fill is defined beside it in clinic.css.
 *
 * The module never learns what a Supabase is: it is handed an `io` with
 * load/save/note/void/watch, exactly as the print module is handed a loader.
 * That is what lets the tests drive the real screen without a network.
 */
(function (root) {
  'use strict';

  var SHEET_ID = 'fsSheet';
  var STYLE_ID = 'fsStyle';

  var _io = null;         // { load, save, addNote, voidLog, watchGet, watchStart, watchStop }
  var _ctx = null;        // { clinicId, patientId, diagnosisId, name, meta, ageYears }
  var _rows = [];         // newest first
  var _watch = null;      // the running monitoring order, or null
  var _mode = null;       // 'acute' | 'chronic' — null means "let the readings decide"
  var _span = null;       // the chart's window, in ms
  var _built = false;
  var _timer = null;
  var _entryField = 'sys';
  var _busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function HV() { return root.HomattVitals; }

  /* ── How old is this patient? ────────────────────────────────────────────
   *
   * It decides whether a reading is read against the adult table or the book's
   * paediatric one, and the two disagree about 44% of children's readings. So
   * it is worth some trouble to find.
   *
   * `clinic_diagnoses` has no age column. The age IS recorded, though — the
   * intake screen writes "Patient: Female, 8 months" as the first line of
   * clinical_findings, and that is parsed here. Where there is genuinely no
   * age, the sheet says so and offers a box, rather than quietly reading a
   * toddler as a thirty-year-old.
   */
  function ageFrom(rec) {
    if (!rec) return null;
    var direct = Number(rec.patient_age || rec.age || rec.ageYears);
    if (isFinite(direct) && direct > 0) return direct;
    var txt = String(rec.clinical_findings || '');
    // "Patient: Female, 34 years" / "Patient: Male, 8 months"
    var m = txt.match(/Patient:[^\n]*?(\d+(?:\.\d+)?)\s*(year|month)/i);
    if (m) {
      var n = parseFloat(m[1]);
      if (!isFinite(n) || n <= 0) return null;
      return /month/i.test(m[2]) ? Math.round((n / 12) * 100) / 100 : n;
    }
    return null;
  }

  function ageOverride(patientKey) {
    try {
      var v = localStorage.getItem('homatt_fs_age_' + patientKey);
      var n = v === null ? NaN : parseFloat(v);
      return isFinite(n) && n > 0 ? n : null;
    } catch (e) { return null; }
  }
  function setAgeOverride(patientKey, years) {
    try {
      if (years === null || years === '') localStorage.removeItem('homatt_fs_age_' + patientKey);
      else localStorage.setItem('homatt_fs_age_' + patientKey, String(years));
    } catch (e) {}
  }

  function age() {
    var o = ageOverride(_ctx && (_ctx.patientId || _ctx.diagnosisId) || 'x');
    if (o !== null) return o;
    return (_ctx && _ctx.ageYears !== undefined && _ctx.ageYears !== null) ? _ctx.ageYears : null;
  }

  // ── Who is allowed one ───────────────────────────────────────────────────
  // Taking observations is clinical work. A receptionist and a drug-shop
  // salesperson are not offered it, the same rule as the camera.
  function may() {
    try {
      if (typeof root.clinicCan === 'function' && !root.clinicCan('treatments')) return false;
      var r = (typeof root.clinicRole === 'function') ? root.clinicRole() : '';
      if (r === 'receptionist' || r === 'salesperson' || r === 'drugshop') return false;
    } catch (e) {}
    return true;
  }

  // ── The stylesheet ───────────────────────────────────────────────────────
  //
  // The tone classes are the only colour decisions in the file, and each one
  // is a token pair: an ink token that the theme flips, over a wash that is
  // the same percentage of whatever surface is behind it. A 12% tint over a
  // dark card stays dark and over a light card stays light, so the pair holds
  // in all eight skin/theme combinations without being restated eight times.
  var CSS = [
    '#fsSheet{position:fixed;inset:0;z-index:940;background:var(--bg);color:var(--text);',
      'display:none;flex-direction:column;font-family:inherit}',
    '#fsSheet.on{display:flex}',
    '.fs-head{display:flex;align-items:center;gap:10px;padding:12px 14px;',
      'border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}',
    '.fs-who{min-width:0;flex:1}',
    '.fs-who b{display:block;font-size:15px;font-weight:800;color:var(--text);',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fs-who span{display:block;font-size:11.5px;color:var(--text-lt);margin-top:1px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fs-x{background:var(--tint-2);color:var(--text);border:1px solid var(--border);',
      'border-radius:50%;width:34px;height:34px;flex:0 0 auto;display:flex;align-items:center;',
      'justify-content:center;cursor:pointer;padding:0}',
    '.fs-tabs{display:flex;gap:6px;padding:9px 14px;background:var(--surface);',
      'border-bottom:1px solid var(--border);flex-shrink:0;align-items:center}',
    '.fs-seg{display:flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;flex:1;min-width:0}',
    '.fs-seg button{flex:1;min-width:0;padding:8px 6px;background:transparent;color:var(--text-lt);',
      'border:0;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;min-height:36px}',
    '.fs-seg button.on{background:var(--brand-tint);color:var(--brand-ink)}',
    '.fs-age{flex:0 0 auto;font-size:11px;color:var(--text-lt);border:1px dashed var(--border);',
      'border-radius:8px;padding:5px 8px;background:transparent;cursor:pointer;font-family:inherit;min-height:32px}',
    '.fs-age.warn{color:var(--warning-ink);border-color:var(--warning-ink)}',
    '.fs-watch{padding:8px 14px;background:var(--brand-tint);color:var(--brand-ink);',
      'font-size:12.5px;font-weight:700;display:none;align-items:center;gap:8px;flex-shrink:0}',
    '.fs-watch.on{display:flex}',
    '.fs-watch.late{background:rgba(211,47,47,.14);color:var(--danger-ink)}',
    '.fs-watch button{margin-left:auto;background:transparent;border:1px solid currentColor;',
      'color:inherit;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;',
      'cursor:pointer;font-family:inherit;min-height:28px}',
    '.fs-body{flex:1;overflow-y:auto;padding:12px 14px 20px;-webkit-overflow-scrolling:touch}',
    '.fs-empty{text-align:center;color:var(--text-lt);font-size:13px;padding:34px 10px;line-height:1.6}',

    // one reading
    '.fs-card{background:var(--surface);border:1px solid var(--border);border-radius:13px;',
      'padding:11px 12px;margin-bottom:9px;position:relative}',
    '.fs-card.void{opacity:.62}',
    '.fs-t{font-size:11.5px;color:var(--text-lt);font-weight:700;letter-spacing:.2px}',
    '.fs-bp{font-size:23px;font-weight:800;color:var(--text);line-height:1.15;margin-top:2px}',
    '.fs-card.void .fs-bp{text-decoration:line-through}',
    '.fs-unit{font-size:12px;font-weight:700;color:var(--text-lt);margin-left:3px}',
    '.fs-sub{font-size:11.5px;color:var(--text-lt);margin-top:3px}',
    '.fs-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}',
    '.fs-chip{font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;',
      'border:1px solid transparent;white-space:nowrap}',
    '.fs-ok  {color:var(--success-ink);background:rgba(46,125,50,.12); border-color:rgba(46,125,50,.30)}',
    '.fs-warn{color:var(--warning-ink);background:rgba(230,81,0,.12);  border-color:rgba(230,81,0,.30)}',
    '.fs-bad {color:var(--danger-ink); background:rgba(211,47,47,.12); border-color:rgba(211,47,47,.30)}',
    '.fs-grey{color:var(--text-lt);    background:transparent;         border-color:var(--border)}',
    '.fs-note{margin-top:8px;border-left:3px solid var(--brand-ink);background:var(--brand-tint);',
      'color:var(--brand-ink);border-radius:0 8px 8px 0;padding:7px 10px;font-size:12px;line-height:1.5}',
    '.fs-note b{font-weight:800}',
    '.fs-why{margin-top:7px;font-size:11.5px;color:var(--danger-ink);line-height:1.5}',
    '.fs-acts{position:absolute;top:9px;right:9px;display:flex;gap:6px}',
    '.fs-mini{background:transparent;border:1px solid var(--border);color:var(--text-lt);',
      'border-radius:7px;width:28px;height:28px;min-height:28px;display:flex;align-items:center;',
      'justify-content:center;cursor:pointer;padding:0;font-family:inherit}',
    '.fs-src{font-size:10.5px;color:var(--text-lt);margin-top:6px;line-height:1.5}',

    // the chart
    '.fs-chart{background:var(--surface);border:1px solid var(--border);border-radius:13px;',
      'padding:10px 8px 6px;margin-bottom:10px;overflow:hidden}',
    '.fs-chart svg{display:block;width:100%;height:auto}',
    '.fs-legend{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;',
      'font-size:11px;color:var(--text-lt);padding:6px 4px 2px}',
    '.fs-legend i{display:inline-block;width:13px;height:2.5px;vertical-align:middle;margin-right:4px}',
    '.fs-stats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}',
    '.fs-stat{flex:1 1 30%;min-width:0;background:var(--surface);border:1px solid var(--border);',
      'border-radius:11px;padding:8px 9px}',
    '.fs-stat b{display:block;font-size:16px;font-weight:800;color:var(--text)}',
    '.fs-stat span{display:block;font-size:10.5px;color:var(--text-lt);margin-top:1px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

    '.fs-foot{flex-shrink:0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));',
      'border-top:1px solid var(--border);background:var(--surface);display:flex;gap:8px}',
    '.fs-add{flex:1;min-width:0;padding:13px;background:var(--deep);color:var(--on-deep);border:0;',
      'border-radius:11px;font-size:14.5px;font-weight:800;cursor:pointer;font-family:inherit;',
      'display:flex;align-items:center;justify-content:center;gap:7px}',
    '.fs-alt{flex:0 0 auto;padding:13px 14px;background:transparent;color:var(--primary-ink);',
      'border:1.5px solid var(--border);border-radius:11px;font-size:13px;font-weight:700;',
      'cursor:pointer;font-family:inherit}',

    // the entry sheet
    '#fsEntry{position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.45);display:none;',
      'align-items:flex-end;justify-content:center}',
    '#fsEntry.on{display:flex}',
    '.fs-pad{background:var(--surface);color:var(--text);width:100%;max-width:520px;',
      'border-radius:18px 18px 0 0;padding:12px 14px calc(12px + env(safe-area-inset-bottom));',
      'max-height:94vh;max-height:94dvh;overflow-y:auto;box-sizing:border-box}',
    '.fs-pad h4{margin:0 0 9px;font-size:14px;font-weight:800;color:var(--text);',
      'display:flex;align-items:center;gap:8px}',
    '.fs-pad h4 button{margin-left:auto}',
    '.fs-two{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px}',
    '.fs-num{min-width:0;box-sizing:border-box;border:2px solid var(--border);border-radius:12px;',
      'padding:9px 6px;text-align:center;background:transparent;cursor:pointer}',
    '.fs-num.on{border-color:var(--deep);background:var(--brand-tint)}',
    '.fs-num b{display:block;font-size:26px;font-weight:800;color:var(--text);line-height:1.2;min-height:31px}',
    '.fs-num.on b{color:var(--brand-ink)}',
    '.fs-num span{display:block;font-size:10.5px;color:var(--text-lt);font-weight:700;letter-spacing:.3px}',
    '.fs-slash{font-size:24px;font-weight:800;color:var(--text-lt)}',
    '.fs-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:9px}',
    '.fs-key{min-width:0;box-sizing:border-box;padding:12px 0;background:var(--tint-2);',
      'color:var(--text);border:1px solid var(--border);border-radius:11px;font-size:19px;',
      'font-weight:800;cursor:pointer;font-family:inherit;min-height:46px}',
    '.fs-key.wide{grid-column:span 1}',
    '.fs-more{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:9px}',
    '.fs-f{min-width:0;box-sizing:border-box}',
    '.fs-f label{display:block;font-size:10.5px;color:var(--text-lt);font-weight:700;margin-bottom:2px}',
    '.fs-f input,.fs-f select,.fs-ta{width:100%;min-width:0;box-sizing:border-box;',
      'border:1px solid var(--border);border-radius:9px;padding:9px 10px;background:transparent;',
      'color:var(--text);font-family:inherit;font-size:16px}',
    '.fs-ta{min-height:58px;font-size:14px;resize:vertical}',
    '.fs-when{font-size:11.5px;color:var(--text-lt);margin-bottom:8px;display:flex;',
      'align-items:center;gap:7px;flex-wrap:wrap}',
    '.fs-when button{background:transparent;border:1px solid var(--border);color:var(--primary-ink);',
      'border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;',
      'font-family:inherit;min-height:28px}',
    '.fs-live{font-size:12px;font-weight:700;padding:7px 10px;border-radius:9px;margin-bottom:8px;',
      'line-height:1.5;display:none}',
    '.fs-live.on{display:block}',
    '.fs-save{width:100%;padding:13px;background:var(--deep);color:var(--on-deep);border:0;',
      'border-radius:11px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit}',
    '.fs-save[disabled]{opacity:.5}',
    '.fs-msg{font-size:12px;color:var(--danger-ink);margin-top:7px;line-height:1.5;min-height:0}',
    '.fs-hint{font-size:11px;color:var(--text-lt);line-height:1.55;margin-top:8px}'
  ].join('');

  // ── Building it once ─────────────────────────────────────────────────────
  function build() {
    if (_built) return;
    var st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = CSS;
    document.head.appendChild(st);

    var el = document.createElement('div');
    el.id = SHEET_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Vitals flowsheet');
    el.innerHTML =
      '<div class="fs-head">'
        + '<div class="fs-who"><b id="fsWho">Patient</b><span id="fsMeta"></span></div>'
        + '<button class="fs-x" id="fsClose" aria-label="Close">'
          + '<span class="material-icons-outlined" style="font-size:19px">close</span></button>'
      + '</div>'
      + '<div class="fs-tabs">'
        + '<div class="fs-seg" role="tablist">'
          + '<button id="fsTabAcute" role="tab">Timeline</button>'
          + '<button id="fsTabChronic" role="tab">Trend</button>'
        + '</div>'
        + '<button class="fs-age" id="fsAge">Age</button>'
      + '</div>'
      + '<div class="fs-watch" id="fsWatchBar">'
        + '<span class="material-icons-outlined" style="font-size:16px">schedule</span>'
        + '<span id="fsWatchTxt"></span>'
        + '<button id="fsWatchStop">Stop</button>'
      + '</div>'
      + '<div class="fs-body" id="fsBody"></div>'
      + '<div class="fs-foot">'
        + '<button class="fs-add" id="fsAdd">'
          + '<span class="material-icons-outlined" style="font-size:19px">add</span>'
          + 'Add a reading</button>'
        + '<button class="fs-alt" id="fsSetWatch">Every…</button>'
      + '</div>';
    document.body.appendChild(el);

    var ent = document.createElement('div');
    ent.id = 'fsEntry';
    ent.innerHTML =
      '<div class="fs-pad" role="dialog" aria-label="Add a reading">'
        + '<h4><span class="material-icons-outlined" style="font-size:18px">monitor_heart</span>'
          + '<span id="fsEntryTitle">Add a reading</span>'
          + '<button class="fs-x" id="fsEntryX" aria-label="Close">'
            + '<span class="material-icons-outlined" style="font-size:19px">close</span></button></h4>'
        + '<div class="fs-two">'
          + '<div class="fs-num on" id="fsSysBox" data-f="sys" role="button" tabindex="0">'
            + '<b id="fsSys"></b><span>SYSTOLIC</span></div>'
          + '<div class="fs-slash">/</div>'
          + '<div class="fs-num" id="fsDiaBox" data-f="dia" role="button" tabindex="0">'
            + '<b id="fsDia"></b><span>DIASTOLIC</span></div>'
        + '</div>'
        + '<div class="fs-keys" id="fsKeys"></div>'
        + '<div class="fs-live" id="fsLive"></div>'
        + '<div class="fs-more">'
          + '<div class="fs-f"><label for="fsPulse">Pulse /min</label>'
            + '<input id="fsPulse" type="number" inputmode="numeric" autocomplete="off"></div>'
          + '<div class="fs-f"><label for="fsTemp">Temp °C</label>'
            + '<input id="fsTemp" type="number" step="0.1" inputmode="decimal" autocomplete="off"></div>'
          + '<div class="fs-f"><label for="fsSpo2">SpO₂ %</label>'
            + '<input id="fsSpo2" type="number" inputmode="numeric" autocomplete="off"></div>'
          + '<div class="fs-f"><label for="fsResp">Breaths /min</label>'
            + '<input id="fsResp" type="number" inputmode="numeric" autocomplete="off"></div>'
        + '</div>'
        + '<div class="fs-when"><span id="fsWhen"></span>'
          + '<button id="fsWhenEdit">It was taken earlier</button></div>'
        + '<div class="fs-f" style="margin-bottom:9px;display:none" id="fsBackWrap">'
          + '<label for="fsBackAt">When it was actually taken</label>'
          + '<input id="fsBackAt" type="datetime-local"></div>'
        + '<div class="fs-f" style="margin-bottom:9px">'
          + '<label for="fsNote">What was done at this moment (optional)</label>'
          + '<textarea id="fsNote" class="fs-ta" placeholder="Gave hydralazine 10mg IV"></textarea></div>'
        + '<button class="fs-save" id="fsSave">Save this reading</button>'
        + '<div class="fs-msg" id="fsMsg"></div>'
        + '<div class="fs-hint">A reading cannot be edited or deleted once it is saved. '
          + 'A wrong one is struck out, with the reason kept beside it, and the right one '
          + 'entered as its own reading — the way a paper chart works, and for the same reason: '
          + 'every arrow on this sheet is worked out from the reading before it.</div>'
      + '</div>';
    document.body.appendChild(ent);

    var keys = $('fsKeys');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'next'].forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'fs-key' + (k === 'del' || k === 'next' ? ' wide' : '');
      b.type = 'button';
      if (k === 'del') {
        b.innerHTML = '<span class="material-icons-outlined" style="font-size:19px">backspace</span>';
        b.setAttribute('aria-label', 'Delete a digit');
      } else if (k === 'next') {
        b.innerHTML = '<span class="material-icons-outlined" style="font-size:19px">arrow_forward</span>';
        b.setAttribute('aria-label', 'Next box');
      } else { b.textContent = k; }
      b.onclick = function () { key(k); };
      keys.appendChild(b);
    });

    $('fsClose').onclick = close;
    $('fsTabAcute').onclick = function () { _mode = 'acute'; _span = null; paint(); };
    $('fsTabChronic').onclick = function () { _mode = 'chronic'; _span = null; paint(); };
    $('fsAge').onclick = askAge;
    $('fsAdd').onclick = function () { openEntry(); };
    $('fsSetWatch').onclick = askWatch;
    $('fsWatchStop').onclick = stopWatch;
    $('fsEntryX').onclick = closeEntry;
    $('fsSave').onclick = saveEntry;
    $('fsSysBox').onclick = function () { _entryField = 'sys'; paintEntry(); };
    $('fsDiaBox').onclick = function () { _entryField = 'dia'; paintEntry(); };
    $('fsWhenEdit').onclick = function () {
      var w = $('fsBackWrap');
      w.style.display = w.style.display === 'none' ? 'block' : 'none';
      if (w.style.display === 'block' && !$('fsBackAt').value) $('fsBackAt').value = localNow();
    };
    ent.addEventListener('click', function (e) { if (e.target === ent) closeEntry(); });

    // A real keyboard, for the desktop half of the clinics.
    document.addEventListener('keydown', function (e) {
      var sheet = $(SHEET_ID);
      if (!sheet || !sheet.classList.contains('on')) return;
      if (!$('fsEntry').classList.contains('on')) {
        if (e.key === 'Escape') close();
        return;
      }
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { closeEntry(); return; }
      if (/^[0-9]$/.test(e.key)) { key(e.key); e.preventDefault(); return; }
      if (e.key === 'Backspace') { key('del'); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { key('next'); e.preventDefault(); }
    });

    _built = true;
  }

  /* ── The split numpad ─────────────────────────────────────────────────────
   * Systolic, then diastolic, with nothing to tap in between. It advances on
   * its own once three digits are in, because a systolic is three digits far
   * more often than not, and the arrow key is there for the two-digit case
   * rather than instead of it. Anything that makes the nurse choose a box
   * between the two numbers is what makes the fourth observation of the
   * morning the one that does not get written down. */
  var _sys = '', _dia = '';
  function key(k) {
    if (k === 'del') {
      if (_entryField === 'sys') _sys = _sys.slice(0, -1);
      else if (_dia) _dia = _dia.slice(0, -1);
      else _entryField = 'sys';
    } else if (k === 'next') {
      _entryField = _entryField === 'sys' ? 'dia' : 'sys';
    } else {
      if (_entryField === 'sys') {
        if (_sys.length < 3) _sys += k;
        if (_sys.length === 3) _entryField = 'dia';
      } else if (_dia.length < 3) {
        _dia += k;
      }
    }
    paintEntry();
  }

  function paintEntry() {
    $('fsSys').textContent = _sys || '—';
    $('fsDia').textContent = _dia || '—';
    $('fsSysBox').className = 'fs-num' + (_entryField === 'sys' ? ' on' : '');
    $('fsDiaBox').className = 'fs-num' + (_entryField === 'dia' ? ' on' : '');

    /* Say what it means WHILE it is being typed. The whole reason a flowsheet
     * exists is the comparison, and showing it before the reading is committed
     * is what turns it from a record into something that can change what
     * happens next — while the patient is still in front of them. */
    var live = $('fsLive');
    var s = parseInt(_sys, 10), d = parseInt(_dia, 10);
    if (!isFinite(s) || !isFinite(d) || !_dia) { live.className = 'fs-live'; live.textContent = ''; return; }
    var hv = HV(); if (!hv) { live.className = 'fs-live'; return; }
    var cls = hv.classify(s, d, { ageYears: age() });
    var prev = liveRows()[0];
    var dl = prev ? hv.delta({ sbp: s, dbp: d },
      { sbp: prev.systolic, dbp: prev.diastolic }, { ageYears: age() }) : null;
    var mp = hv.map(s, d);
    var bits = [cls.label];
    if (mp !== null) bits.push('MAP ' + mp);
    if (dl && !dl.first) bits.push(dl.text + ' on the last — ' + word(dl.status));
    live.className = 'fs-live on fs-' + tone(cls.tone);
    live.textContent = bits.join(' · ');
  }

  function tone(t) { return t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : 'grey'; }
  function word(status) {
    return status === 'IMPROVING' ? 'moving the right way'
      : status === 'WORSENING' ? 'moving the wrong way'
      : status === 'CRITICAL' ? 'this is an emergency'
      : status === 'STABLE' ? 'holding' : '';
  }

  // Readings that count toward the arithmetic: struck-out ones never do.
  function liveRows() {
    return _rows.filter(function (r) { return !r.voided_at; });
  }

  // ── Opening ──────────────────────────────────────────────────────────────
  function open(ctx, io) {
    if (!may()) return;
    build();
    _ctx = ctx || {};
    _io = io || _io || {};
    _rows = []; _watch = null; _mode = null; _span = null;
    if (_ctx.ageYears === undefined || _ctx.ageYears === null) _ctx.ageYears = ageFrom(_ctx.record);
    $('fsWho').textContent = _ctx.name || 'Patient';
    $('fsMeta').textContent = _ctx.meta || '';
    $(SHEET_ID).classList.add('on');
    $('fsBody').innerHTML = '<div class="fs-empty">Loading…</div>';
    refresh();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(tick, 1000);
  }

  function close() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    var s = $(SHEET_ID); if (s) s.classList.remove('on');
    closeEntry();
  }

  async function refresh() {
    try {
      var rows = (_io && _io.load) ? await _io.load() : [];
      _rows = (rows || []).slice().sort(function (a, b) {
        return new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime();
      });
    } catch (e) { _rows = _rows || []; }
    try {
      _watch = (_io && _io.watchGet) ? await _io.watchGet() : null;
    } catch (e) { _watch = null; }
    paint();
  }

  // ── The countdown, which is the only thing that ticks ────────────────────
  function tick() {
    var bar = $('fsWatchBar');
    if (!bar) return;
    if (!_watch || _watch.stopped_at) { bar.className = 'fs-watch'; return; }
    var hv = HV(); if (!hv) return;
    var last = liveRows()[0];
    var lastMs = last ? new Date(last.logged_at).getTime() : new Date(_watch.started_at).getTime();
    var d = hv.due(lastMs, _watch.interval_minutes);
    if (!d) { bar.className = 'fs-watch'; return; }
    bar.className = 'fs-watch on' + (d.overdue ? ' late' : '');
    $('fsWatchTxt').textContent = 'Every ' + _watch.interval_minutes + ' min — ' + d.text;
  }

  // ── Painting ─────────────────────────────────────────────────────────────
  function mode() {
    if (_mode) return _mode;
    var hv = HV(); if (!hv) return 'acute';
    return hv.suggestMode(liveRows().map(function (r) {
      return new Date(r.logged_at).getTime();
    }));
  }

  function paint() {
    if (!$(SHEET_ID)) return;
    var m = mode();
    $('fsTabAcute').className = m === 'acute' ? 'on' : '';
    $('fsTabChronic').className = m === 'chronic' ? 'on' : '';
    paintAge();
    tick();
    $('fsBody').innerHTML = m === 'chronic' ? chartHTML() + timelineHTML(true) : timelineHTML(false);
    wireBody();
  }

  function paintAge() {
    var b = $('fsAge'); if (!b) return;
    var a = age();
    if (a === null) {
      b.className = 'fs-age warn';
      b.textContent = 'Age?';
      b.title = 'No age recorded — every reading here is being read against the adult table. '
              + 'Tap to set it.';
    } else {
      b.className = 'fs-age';
      b.textContent = a < 1 ? (Math.round(a * 12) + ' mo') : (a + ' yr');
      b.title = 'Readings are read against the guideline range for this age. Tap to change it.';
    }
    b.setAttribute('aria-label', b.title);
  }

  function askAge() {
    var cur = age();
    var v = root.prompt('How old is this patient, in years? (0.5 for six months)\n\n'
      + 'It decides whether a reading is read against the adult table or the '
      + 'guideline’s range for a child — they disagree about most children’s '
      + 'readings. Leave it empty to clear it.', cur === null ? '' : String(cur));
    if (v === null) return;
    var n = parseFloat(v);
    var key_ = (_ctx && (_ctx.patientId || _ctx.diagnosisId)) || 'x';
    if (v === '' || !isFinite(n) || n <= 0 || n > 130) setAgeOverride(key_, null);
    else setAgeOverride(key_, n);
    paint();
  }

  function fmtTime(iso, m) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var hh = (d.getHours() < 10 ? '0' : '') + d.getHours();
    var mm = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var date = d.getDate() + ' ' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    if (m === 'chronic') return date + (sameDay ? ' (today)' : '') + ' · ' + hh + ':' + mm;
    return (sameDay ? '' : date + ' · ') + hh + ':' + mm;
  }

  function timelineHTML(compact) {
    var hv = HV();
    if (!_rows.length) {
      return '<div class="fs-empty">No readings yet.<br>'
        + 'Tap <b>Add a reading</b> and the first one starts the chart.</div>';
    }
    var m = mode();
    var live = liveRows();
    var out = compact ? '<div class="fs-t" style="margin:4px 0 8px">Every reading</div>' : '';
    for (var i = 0; i < _rows.length; i++) {
      var r = _rows[i];
      // The one BEFORE it, among the readings that count — a struck-out row is
      // not a previous reading, it is a mistake.
      var prev = null;
      if (!r.voided_at) {
        var at = live.indexOf(r);
        prev = (at >= 0 && at + 1 < live.length) ? live[at + 1] : null;
      }
      out += cardHTML(r, prev, m, hv);
    }
    return out;
  }

  function cardHTML(r, prev, m, hv) {
    var s = r.systolic, d = r.diastolic;
    var hasBP = s !== null && s !== undefined && d !== null && d !== undefined;
    var cls = hv && hasBP ? hv.classify(s, d, { ageYears: age() }) : null;
    var mp = (r.map_mmhg !== null && r.map_mmhg !== undefined)
      ? r.map_mmhg : (hv && hasBP ? hv.map(s, d) : null);
    var dl = (hv && hasBP && prev) ? hv.delta({ sbp: s, dbp: d },
      { sbp: prev.systolic, dbp: prev.diastolic }, { ageYears: age() }) : null;

    var chips = [];
    if (cls) chips.push('<span class="fs-chip fs-' + tone(cls.tone) + '">' + esc(cls.label) + '</span>');
    if (dl && !dl.first) {
      var dt = dl.status === 'IMPROVING' ? 'ok' : dl.status === 'STABLE' ? 'grey' :
               dl.status === 'CRITICAL' ? 'bad' : 'warn';
      chips.push('<span class="fs-chip fs-' + dt + '">' + esc(dl.text) + ' · ' + esc(word(dl.status)) + '</span>');
    }
    if (r.pulse) {
      var p = hv ? hv.pulse(r.pulse, age()) : null;
      chips.push('<span class="fs-chip fs-' + tone(p ? p.tone : 'grey') + '">'
        + esc(r.pulse) + '/min pulse</span>');
    }
    if (r.temp_c) {
      var t = hv ? hv.temp(r.temp_c) : null;
      chips.push('<span class="fs-chip fs-' + tone(t ? t.tone : 'grey') + '">'
        + esc(r.temp_c) + ' °C</span>');
    }
    if (r.spo2) {
      var o = hv ? hv.spo2(r.spo2) : null;
      chips.push('<span class="fs-chip fs-' + tone(o ? o.tone : 'grey') + '">SpO₂ '
        + esc(r.spo2) + '%</span>');
    }
    if (r.resp_rate) {
      var rr = hv ? hv.resp(r.resp_rate, age()) : null;
      chips.push('<span class="fs-chip fs-' + tone(rr ? rr.tone : 'grey') + '">'
        + esc(r.resp_rate) + ' breaths/min</span>');
    }
    var si = hv && r.pulse && s ? hv.shockIndex(r.pulse, s) : null;
    if (si !== null && si >= 0.9) {
      chips.push('<span class="fs-chip fs-bad">Shock index ' + si + '</span>');
    }

    var notes = (r._notes || []).filter(function (n) { return !n.voided_at; });
    var noteHTML = notes.map(function (n) {
      return '<div class="fs-note"><b>' + esc(niceAction(n.action_type)) + '</b> — '
        + esc(n.note_text)
        + (n.author_name ? ' <span style="opacity:.75">(' + esc(n.author_name) + ')</span>' : '')
        + '</div>';
    }).join('');

    var src = [];
    if (cls && cls.assumedAdult) {
      src.push('No age recorded — read against the adult table.');
    }
    if (cls && cls.note) src.push(cls.note);
    if (cls && cls.source) src.push(cls.source);

    return '<div class="fs-card' + (r.voided_at ? ' void' : '') + '" data-id="' + esc(r.id) + '">'
      + '<div class="fs-t">' + esc(fmtTime(r.logged_at, m))
        + (r.back_entered ? ' · written up later' : '')
        + (r.recorded_by_name ? ' · ' + esc(r.recorded_by_name) : '') + '</div>'
      + (hasBP
          ? '<div class="fs-bp">' + esc(s) + '/' + esc(d)
            + '<span class="fs-unit">mmHg</span></div>'
          : '<div class="fs-bp" style="font-size:16px">No blood pressure</div>')
      + (mp !== null && mp !== undefined && !r.voided_at
          ? '<div class="fs-sub">MAP ' + esc(mp) + ' mmHg</div>' : '')
      + '<div class="fs-chips">' + chips.join('') + '</div>'
      + noteHTML
      + (r.voided_at
          ? '<div class="fs-why">Struck out — ' + esc(r.void_reason || 'no reason given') + '</div>'
          : '')
      + (src.length && !r.voided_at ? '<div class="fs-src">' + esc(src.join(' ')) + '</div>' : '')
      + (r.voided_at ? '' :
          '<div class="fs-acts">'
          + '<button class="fs-mini" data-note="' + esc(r.id) + '" title="Add a note to this reading"'
            + ' aria-label="Add a note to this reading">'
            + '<span class="material-icons-outlined" style="font-size:15px">chat</span></button>'
          + '<button class="fs-mini" data-void="' + esc(r.id) + '" title="Strike this reading out"'
            + ' aria-label="Strike this reading out">'
            + '<span class="material-icons-outlined" style="font-size:15px">block</span></button>'
          + '</div>')
      + '</div>';
  }

  function niceAction(a) {
    return a === 'MEDICATION_GIVEN' ? 'Given'
      : a === 'DOCTOR_ORDER' ? 'Order'
      : a === 'EVENT' ? 'Happened' : 'Noted';
  }

  function wireBody() {
    var body = $('fsBody'); if (!body) return;
    var ns = body.querySelectorAll('[data-note]');
    for (var i = 0; i < ns.length; i++) {
      (function (btn) { btn.onclick = function () { addNote(btn.getAttribute('data-note')); }; })(ns[i]);
    }
    var vs = body.querySelectorAll('[data-void]');
    for (var j = 0; j < vs.length; j++) {
      (function (btn) { btn.onclick = function () { voidRow(btn.getAttribute('data-void')); }; })(vs[j]);
    }
    var rs = body.querySelectorAll('[data-span]');
    for (var k = 0; k < rs.length; k++) {
      (function (btn) {
        btn.onclick = function () { _span = parseInt(btn.getAttribute('data-span'), 10); paint(); };
      })(rs[k]);
    }
  }

  /* ── The chart ────────────────────────────────────────────────────────────
   *
   * Systolic and diastolic over the chosen window, with the target band shaded
   * behind them and a pin wherever a note was written. The pins are the point:
   * a fall of 30 mmHg means one thing on its own and another when there is a
   * dose of hydralazine sitting under it, and nobody reading the chart later
   * can tell the two apart unless the chart says so.
   *
   * Drawn as SVG at a fixed viewBox and scaled by CSS, so it is the same
   * drawing on a 360px phone and a laptop and needs no resize handler.
   */
  var W = 320, H = 150, PADL = 26, PADR = 6, PADT = 8, PADB = 18;

  function chartHTML() {
    var hv = HV();
    var m = mode();
    var HOUR = 3600000, DAY = 24 * HOUR;
    var spans = m === 'acute'
      ? [[HOUR, '1 h'], [6 * HOUR, '6 h'], [DAY, '24 h']]
      : [[7 * DAY, '7 d'], [30 * DAY, '30 d'], [90 * DAY, '90 d']];
    var span = _span || spans[1][0];
    var now = new Date().getTime();
    var from = now - span;

    var pts = liveRows().filter(function (r) {
      var t = new Date(r.logged_at).getTime();
      return t >= from && r.systolic && r.diastolic;
    }).map(function (r) {
      return { t: new Date(r.logged_at).getTime(), s: r.systolic, d: r.diastolic, row: r };
    }).sort(function (a, b) { return a.t - b.t; });

    var tabs = '<div class="fs-legend">' + spans.map(function (sp) {
      return '<button class="fs-mini" data-span="' + sp[0] + '" style="width:auto;padding:0 9px;'
        + (span === sp[0] ? 'border-color:var(--brand-ink);color:var(--brand-ink);font-weight:800' : '')
        + '">' + sp[1] + '</button>';
    }).join('') + '</div>';

    if (pts.length < 2) {
      return '<div class="fs-chart"><div class="fs-empty" style="padding:22px 8px">'
        + (pts.length ? 'One reading in this window.' : 'No readings in this window.')
        + '<br>A line needs two.</div>' + tabs + '</div>';
    }

    // Scale: the readings, the target band, and a little air.
    var win = hv ? hv.window(age()) : { sbp: [90, 139], dbp: [60, 89] };
    var lo = Math.min.apply(null, pts.map(function (p) { return p.d; }).concat([win.sbp[0]])) - 10;
    var hi = Math.max.apply(null, pts.map(function (p) { return p.s; }).concat([win.sbp[1]])) + 10;
    if (hi - lo < 40) hi = lo + 40;

    function x(t) { return PADL + (t - from) / span * (W - PADL - PADR); }
    function y(v) { return PADT + (hi - v) / (hi - lo) * (H - PADT - PADB); }

    function line(key) {
      return pts.map(function (p, i) {
        return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p[key]).toFixed(1);
      }).join(' ');
    }

    // The target band. For a child the book gives systolic only, so only that
    // is shaded — inventing a paediatric diastolic band to make the picture
    // symmetrical is exactly what the engine refuses to do.
    var bandTop = y(win.sbp[1]), bandBot = y(win.sbp[0]);
    var band = '<rect x="' + PADL + '" y="' + bandTop.toFixed(1) + '" width="' + (W - PADL - PADR)
      + '" height="' + Math.max(0, bandBot - bandTop).toFixed(1)
      + '" fill="var(--success-ink)" opacity="0.10"></rect>';

    var grid = '', ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var v = Math.round(lo + (hi - lo) * g / ticks);
      var yy = y(v);
      grid += '<line x1="' + PADL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PADR)
        + '" y2="' + yy.toFixed(1) + '" stroke="var(--border)" stroke-width="0.7"></line>'
        + '<text x="' + (PADL - 4) + '" y="' + (yy + 3).toFixed(1)
        + '" text-anchor="end" font-size="8" fill="var(--text-lt)">' + v + '</text>';
    }

    var pins = '';
    pts.forEach(function (p) {
      var has = (p.row._notes || []).filter(function (n) { return !n.voided_at; }).length;
      if (!has) return;
      pins += '<line x1="' + x(p.t).toFixed(1) + '" y1="' + PADT + '" x2="' + x(p.t).toFixed(1)
        + '" y2="' + (H - PADB) + '" stroke="var(--brand-ink)" stroke-width="0.8"'
        + ' stroke-dasharray="2 2" opacity="0.65"></line>'
        + '<circle cx="' + x(p.t).toFixed(1) + '" cy="' + (PADT + 3)
        + '" r="2.6" fill="var(--brand-ink)"></circle>';
    });

    var dots = pts.map(function (p) {
      return '<circle cx="' + x(p.t).toFixed(1) + '" cy="' + y(p.s).toFixed(1)
        + '" r="2" fill="var(--danger-ink)"></circle>'
        + '<circle cx="' + x(p.t).toFixed(1) + '" cy="' + y(p.d).toFixed(1)
        + '" r="2" fill="var(--info-ink)"></circle>';
    }).join('');

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Blood pressure over time">'
      + band + grid + pins
      + '<path d="' + line('s') + '" fill="none" stroke="var(--danger-ink)" stroke-width="1.6"'
        + ' stroke-linejoin="round" stroke-linecap="round"></path>'
      + '<path d="' + line('d') + '" fill="none" stroke="var(--info-ink)" stroke-width="1.6"'
        + ' stroke-linejoin="round" stroke-linecap="round"></path>'
      + dots
      + '</svg>';

    var legend = '<div class="fs-legend">'
      + '<span><i style="background:var(--danger-ink)"></i>Systolic</span>'
      + '<span><i style="background:var(--info-ink)"></i>Diastolic</span>'
      + '<span><i style="background:var(--success-ink);opacity:.5"></i>Target '
        + win.sbp[0] + '–' + win.sbp[1] + '</span>'
      + (pins ? '<span><i style="background:var(--brand-ink)"></i>A note was written</span>' : '')
      + '</div>';

    return '<div class="fs-chart">' + svg + legend + tabs + '</div>' + statsHTML(pts);
  }

  function statsHTML(pts) {
    if (!pts.length) return '';
    var ss = pts.map(function (p) { return p.s; });
    var ds = pts.map(function (p) { return p.d; });
    function avg(a) { return Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length); }
    var hv = HV();
    var cls = hv ? hv.classify(avg(ss), avg(ds), { ageYears: age() }) : null;
    var hiI = ss.indexOf(Math.max.apply(null, ss));
    var loI = ss.indexOf(Math.min.apply(null, ss));
    return '<div class="fs-stats">'
      + '<div class="fs-stat"><b class="' + (cls ? 'fs-' + tone(cls.tone) : '')
        + '" style="background:none;border:0;padding:0">' + avg(ss) + '/' + avg(ds) + '</b>'
        + '<span>Average of ' + pts.length + '</span></div>'
      + '<div class="fs-stat"><b>' + ss[hiI] + '/' + ds[hiI] + '</b><span>Highest</span></div>'
      + '<div class="fs-stat"><b>' + ss[loI] + '/' + ds[loI] + '</b><span>Lowest</span></div>'
      + '</div>';
  }

  // ── Adding one ───────────────────────────────────────────────────────────
  function localNow() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openEntry() {
    build();
    _sys = ''; _dia = ''; _entryField = 'sys';
    ['fsPulse', 'fsTemp', 'fsSpo2', 'fsResp', 'fsNote', 'fsBackAt'].forEach(function (id) {
      var el = $(id); if (el) el.value = '';
    });
    $('fsBackWrap').style.display = 'none';
    $('fsMsg').textContent = '';
    $('fsWhen').textContent = 'Recorded for now — ' + fmtTime(new Date().toISOString(), 'acute');
    $('fsSave').disabled = false;
    $('fsEntry').classList.add('on');
    paintEntry();
  }
  function closeEntry() {
    var e = $('fsEntry'); if (e) e.classList.remove('on');
  }

  async function saveEntry() {
    if (_busy) return;
    var msg = $('fsMsg');
    var s = parseInt(_sys, 10), d = parseInt(_dia, 10);
    var pulse = intOf($('fsPulse').value), temp = floatOf($('fsTemp').value);
    var spo = intOf($('fsSpo2').value), rr = intOf($('fsResp').value);
    var any = isFinite(s) || isFinite(d) || pulse !== null || temp !== null ||
              spo !== null || rr !== null;
    if (!any) { msg.textContent = 'Nothing has been entered.'; return; }
    if ((isFinite(s) && !isFinite(d)) || (!isFinite(s) && isFinite(d))) {
      msg.textContent = 'A blood pressure needs both numbers.'; return;
    }
    if (isFinite(s) && isFinite(d) && d > s) {
      msg.textContent = 'The diastolic is higher than the systolic — check which box each went in.';
      return;
    }
    /* Range-checked before it is sent, with the same rule the dictation
     * parser follows: a reading outside what a human body can do is reported
     * rather than stored, because "38.5" typed as "385" looks like a
     * temperature until it is on a chart. */
    var bad = outOfRange({ s: s, d: d, pulse: pulse, temp: temp, spo: spo, rr: rr });
    if (bad) { msg.textContent = bad; return; }

    var when = $('fsBackAt').value;
    var loggedAt = when ? new Date(when) : new Date();
    if (isNaN(loggedAt.getTime())) loggedAt = new Date();
    if (loggedAt.getTime() > new Date().getTime() + 60000) {
      msg.textContent = 'That time is in the future.'; return;
    }

    var row = {
      systolic: isFinite(s) ? s : null,
      diastolic: isFinite(d) ? d : null,
      pulse: pulse, temp_c: temp, spo2: spo, resp_rate: rr,
      logged_at: loggedAt.toISOString(),
      back_entered: !!when,
      source: 'manual'
    };
    var note = ($('fsNote').value || '').trim();

    _busy = true; $('fsSave').disabled = true; msg.textContent = '';
    try {
      /* The KIND of note travels with it. Without this the note went to the
       * server as a plain observation and came back labelled "Noted", so
       * "Gave hydralazine 10mg IV" read as an observation on every device
       * except the one that typed it — and on a chart where the question is
       * whether the drug or the disease moved the pressure, that is the label
       * that matters. */
      var saved = await _io.save(row, note, note ? guessAction(note) : null);
      closeEntry();
      // Show it straight away rather than waiting for a round trip — the
      // reading is the clinician's, not the server's, and a ward round with no
      // signal must not look like nothing happened.
      if (saved && saved.id) {
        if (note) saved._notes = [{ note_text: note, action_type: guessAction(note), author_name: '' }];
        _rows.unshift(saved);
        _rows.sort(function (a, b) {
          return new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime();
        });
        paint();
      }
      refresh();
    } catch (e) {
      msg.textContent = (e && e.message) || 'It could not be saved. Try again.';
      $('fsSave').disabled = false;
    }
    _busy = false;
  }

  function intOf(v) { var n = parseInt(v, 10); return isFinite(n) ? n : null; }
  function floatOf(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  /* The same loose bounds the database enforces: what cannot be a living
   * human, not what is unlikely. A constraint tight enough to catch a typo is
   * tight enough to reject a real reading from a patient in extremis. */
  function outOfRange(v) {
    if (isFinite(v.s) && (v.s < 30 || v.s > 300)) return 'A systolic of ' + v.s + ' is not a blood pressure.';
    if (isFinite(v.d) && (v.d < 10 || v.d > 250)) return 'A diastolic of ' + v.d + ' is not a blood pressure.';
    if (v.pulse !== null && (v.pulse < 15 || v.pulse > 320)) return 'A pulse of ' + v.pulse + ' is not a pulse.';
    if (v.temp !== null && (v.temp < 20 || v.temp > 46)) return 'A temperature of ' + v.temp + ' is outside 20–46 °C — check the decimal point.';
    if (v.spo !== null && (v.spo < 30 || v.spo > 100)) return 'An oxygen saturation of ' + v.spo + '% is not a reading.';
    if (v.rr !== null && (v.rr < 2 || v.rr > 99)) return 'A breathing rate of ' + v.rr + ' is not a rate.';
    return '';
  }

  function guessAction(t) {
    if (/\b(gave|given|iv|im|mg|ml|dose|stat)\b/i.test(t)) return 'MEDICATION_GIVEN';
    if (/\b(order|monitor|repeat|review|admit|refer)\b/i.test(t)) return 'DOCTOR_ORDER';
    return 'OBSERVATION';
  }

  async function addNote(id) {
    var t = root.prompt('What was done at this reading?\n\ne.g. "Gave hydralazine 10mg IV"');
    if (t === null) return;
    t = String(t).trim();
    if (!t) return;
    try {
      await _io.addNote(id, t, guessAction(t));
      var r = _rows.filter(function (x) { return x.id === id; })[0];
      if (r) { r._notes = (r._notes || []).concat([{ note_text: t, action_type: guessAction(t) }]); }
      paint();
      refresh();
    } catch (e) { root.alert((e && e.message) || 'The note could not be saved.'); }
  }

  async function voidRow(id) {
    var why = root.prompt('Why is this reading being struck out?\n\n'
      + 'It is not deleted — it stays on the sheet with this reason beside it, and stops '
      + 'counting toward the arrows. Enter the right reading afterwards as its own reading.');
    if (why === null) return;
    why = String(why).trim();
    if (!why) { root.alert('A reading is only struck out with a reason.'); return; }
    try {
      var r = await _io.voidLog(id, why);
      if (r && r.ok === false) { root.alert(r.error || 'It could not be struck out.'); return; }
      refresh();
    } catch (e) { root.alert((e && e.message) || 'It could not be struck out.'); }
  }

  async function askWatch() {
    var v = root.prompt('Check this patient how often, in minutes?\n\n'
      + 'The sheet then counts down to the next one, for whoever is on the ward. '
      + 'Leave it empty to stop.', _watch ? String(_watch.interval_minutes) : '15');
    if (v === null) return;
    if (String(v).trim() === '') { stopWatch(); return; }
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 1 || n > 1440) {
      root.alert('Choose between 1 minute and a day.'); return;
    }
    try {
      var r = await _io.watchStart(n);
      if (r && r.ok === false) { root.alert(r.error || 'It could not be set.'); return; }
      refresh();
    } catch (e) { root.alert((e && e.message) || 'It could not be set.'); }
  }

  async function stopWatch() {
    if (!_watch) return;
    try { await _io.watchStop(_watch.id); } catch (e) {}
    _watch = null;
    tick(); refresh();
  }

  root.HomattFlowsheet = {
    may: may,
    open: open,
    close: close,
    refresh: refresh,
    ageFrom: ageFrom,
    _rows: function () { return _rows; },
    _mode: mode,
    _key: key,
    _entry: function () { return { sys: _sys, dia: _dia, field: _entryField }; }
  };
})(window);
