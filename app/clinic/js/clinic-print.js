/* Homatt Health — printing a record, and printing a period.
 *
 * Two things a clinic actually asks a printer for:
 *
 *   ONE PATIENT, in full — the sheet that goes in a paper file, travels with a
 *   referral, or is handed to somebody to take to a bigger hospital. It has to
 *   carry everything, because whoever reads it next cannot tap anything.
 *
 *   A PERIOD — today, this week, this month, this year — as a list with the
 *   money on it. That is the register a clinic reconciles against, and the
 *   thing an owner takes to a meeting.
 *
 * HOW IT PRINTS, and why not the obvious way.
 *
 * Not `window.open()` with a fresh document: pop-ups are blocked by default in
 * several desktop browsers and behave badly inside the Android WebView, which
 * is exactly the split of devices this clinic uses. A feature that works on
 * the developer's laptop and silently does nothing on the clinic's is not a
 * feature.
 *
 * So the sheet is built into a div in THIS page, and a `@media print` rule
 * hides everything else. No pop-up, no second document, no network — it works
 * offline, which matters because the power and the internet in a Ugandan
 * clinic do not fail at the same times.
 *
 * It shows the sheet on screen first. Paper costs money; nobody should
 * discover the date range was wrong after printing forty pages.
 */
(function (root) {
  'use strict';

  var ROOT_ID = 'hmPrintRoot';
  var STYLE_ID = 'hmPrintStyle';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ugx(n) {
    var v = Math.round(Number(n) || 0);
    return 'UGX ' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function dmy(d) {
    try {
      return new Date(d).toLocaleDateString('en-UG',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return String(d || ''); }
  }
  function dmyt(d) {
    try {
      var x = new Date(d);
      return x.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' ' + x.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(d || ''); }
  }

  /* The paper is BLACK ON WHITE, always, whatever the app's theme is.
   *
   * Not a token in sight, and that is deliberate — this is the one surface in
   * the app where the colour tokens are wrong. A clinic on the dark skin would
   * otherwise print white text on a white page and get blank paper, or burn a
   * cartridge laying down a dark background. Print has one correct palette and
   * the screen's preferences are not it. */
  var CSS =
    '#' + ROOT_ID + '{display:none}' +
    '.hm-sheet{background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45}' +
    '.hm-sheet h1{font-size:17px;margin:0 0 2px;letter-spacing:.2px}' +
    '.hm-sheet h2{font-size:12.5px;margin:14px 0 5px;padding-bottom:3px;border-bottom:1px solid #000;' +
      'text-transform:uppercase;letter-spacing:.7px}' +
    '.hm-sheet .hm-sub{font-size:11px;color:#333}' +
    '.hm-sheet .hm-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;' +
      'border-bottom:2px solid #000;padding-bottom:8px}' +
    '.hm-sheet .hm-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 18px}' +
    '.hm-sheet .hm-kv div{padding:1px 0}' +
    '.hm-sheet .hm-kv b{display:inline-block;min-width:118px;font-weight:700}' +
    '.hm-sheet table{width:100%;border-collapse:collapse;font-size:11px;margin-top:3px}' +
    '.hm-sheet th,.hm-sheet td{border:1px solid #777;padding:4px 6px;text-align:left;vertical-align:top}' +
    '.hm-sheet th{background:#EEE;font-weight:700}' +
    '.hm-sheet td.num,.hm-sheet th.num{text-align:right;white-space:nowrap}' +
    '.hm-sheet tfoot td{font-weight:700;background:#F4F4F4}' +
    '.hm-sheet .hm-prose{white-space:pre-wrap;margin:0}' +
    '.hm-sheet .hm-foot{margin-top:16px;padding-top:6px;border-top:1px solid #000;font-size:10px;color:#333;' +
      'display:flex;justify-content:space-between;gap:10px}' +
    '.hm-sheet .hm-none{color:#555;font-style:italic}' +
    /* The screen preview: the paper, on a grey desk. */
    '#hmPrintWrap{position:fixed;inset:0;left:0;top:0;right:0;bottom:0;z-index:2000;background:rgba(0,0,0,.6);' +
      'display:none;flex-direction:column}' +
    '#hmPrintWrap.on{display:flex}' +
    '#hmPrintBar{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:10px 14px;background:var(--surface,#fff);' +
      'color:var(--text,#1A1A1A);border-bottom:1px solid var(--border,#E0E0E0);flex-wrap:wrap}' +
    '#hmPrintBar .t{flex:1 1 160px;min-width:0;font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hm-pbtn{flex:0 0 auto;padding:9px 14px;border-radius:9px;border:none;font-family:inherit;font-size:13.5px;' +
      'font-weight:700;cursor:pointer;background:var(--deep,#1B5E20);color:var(--on-deep,#fff)}' +
    '.hm-pbtn.ghost{background:transparent;color:var(--text,#1A1A1A);border:1px solid var(--border,#E0E0E0)}' +
    '#hmPrintScroll{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#5A5A5A}' +
    '#hmPrintPaper{background:#fff;max-width:820px;margin:0 auto;padding:22px 24px;box-shadow:0 6px 28px rgba(0,0,0,.4)}' +
    '@media print{' +
      'html,body{background:#fff !important;margin:0 !important;padding:0 !important}' +
      /* Hide the app, show the sheet. Every direct child of body goes, which
         covers fixed overlays as well as the page itself. */
      'body.hm-printing > *{display:none !important}' +
      'body.hm-printing > #' + ROOT_ID + '{display:block !important}' +
      '#' + ROOT_ID + '{display:block;position:static}' +
      '.hm-noprint{display:none !important}' +
      '.hm-sheet{font-size:11px}' +
      '.hm-sheet tr,.hm-sheet .hm-block{page-break-inside:avoid}' +
      '.hm-sheet thead{display:table-header-group}' +   /* repeat headings per page */
      '@page{margin:12mm}' +
    '}';

  function ensureDom() {
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    var wrap = document.getElementById('hmPrintWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'hmPrintWrap';
      wrap.className = 'hm-noprint';
      wrap.innerHTML =
        '<div id="hmPrintBar">' +
          '<div class="t" id="hmPrintTitle">Print</div>' +
          '<button class="hm-pbtn" id="hmPrintGo">Print</button>' +
          '<button class="hm-pbtn ghost" id="hmPrintClose">Close</button>' +
        '</div>' +
        '<div id="hmPrintScroll"><div id="hmPrintPaper"></div></div>';
      document.body.appendChild(wrap);
      document.getElementById('hmPrintClose').onclick = close;
      document.getElementById('hmPrintGo').onclick = doPrint;
    }
    return root;
  }

  function clinicHead() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem('clinic_session') || '{}') || {}; } catch (e) {}
    var extra = {};
    try { extra = JSON.parse(localStorage.getItem('clinic_profile_cache') || '{}') || {}; } catch (e) {}
    var name = s.clinicName || extra.name || 'Clinic';
    var bits = [];
    if (s.level) bits.push(s.level);
    if (extra.district) bits.push(extra.district);
    if (extra.phone) bits.push(extra.phone);
    return '<div class="hm-top">' +
      '<div><h1>' + esc(name) + '</h1>' +
        (bits.length ? '<div class="hm-sub">' + esc(bits.join(' · ')) + '</div>' : '') +
      '</div>' +
      '<div class="hm-sub" style="text-align:right;flex:0 0 auto">Printed ' + esc(dmyt(new Date())) +
        (s.staffName ? '<br>by ' + esc(s.staffName) : '') + '</div>' +
    '</div>';
  }

  function sect(title, body) {
    if (!body) return '';
    return '<div class="hm-block"><h2>' + esc(title) + '</h2>' + body + '</div>';
  }
  function prose(t) {
    t = String(t == null ? '' : t).trim();
    return t ? '<p class="hm-prose">' + esc(t) + '</p>' : '';
  }
  function listOrNone(txt) {
    txt = String(txt == null ? '' : txt).trim();
    if (!txt) return '<p class="hm-none">None recorded.</p>';
    return '<p class="hm-prose">' + esc(txt) + '</p>';
  }

  function medsTable(items) {
    items = (Array.isArray(items) ? items : []).filter(function (m) {
      var n = String((m && (m.drug_name || m.name)) || '').trim();
      // The same placeholder the record screen filters: a medicine called
      // "N/A" is not a prescription and must not print like one.
      return n && !/^(n\/?a|none|nil|-{1,2})$/i.test(n);
    });
    if (!items.length) return '<p class="hm-none">No medicines recorded.</p>';
    var rows = items.map(function (m) {
      var dur = m.duration ? (m.duration + ' day' + (Number(m.duration) === 1 ? '' : 's')) : '';
      return '<tr><td>' + esc(m.drug_name || m.name || '') + '</td>' +
        '<td>' + esc(m.strength || m.dosage || '') + '</td>' +
        '<td>' + esc(String(m.frequency || '').replace(/_daily/g, '/day').replace(/_/g, ' ')) + '</td>' +
        '<td>' + esc(dur) + '</td>' +
        '<td>' + esc((m.intakeTimes || m.intake_times || []).join(', ')) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Medicine</th><th>Strength</th><th>How often</th>' +
      '<th>For</th><th>Times</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function moneyTable(v) {
    var total = Number(v.total_charged_ugx) || 0;
    var paid = Number(v.amount_paid) || 0;
    var bal = Math.max(0, total - paid);
    return '<table><tbody>' +
      '<tr><td>Treatment fee</td><td class="num">' + ugx(v.consultation_fee_ugx) + '</td></tr>' +
      '<tr><td>Laboratory</td><td class="num">' + ugx(v.lab_fee_ugx) + '</td></tr>' +
      '<tr><td>Medicines</td><td class="num">' + ugx(v.meds_fee_ugx) + '</td></tr>' +
      '</tbody><tfoot>' +
      '<tr><td>Total charged</td><td class="num">' + ugx(total) + '</td></tr>' +
      '<tr><td>Paid</td><td class="num">' + ugx(paid) + '</td></tr>' +
      '<tr><td>Balance</td><td class="num">' + ugx(bal) + '</td></tr>' +
      '<tr><td>Status</td><td class="num">' + esc(String(v.payment_status || 'pending').toUpperCase()) + '</td></tr>' +
      '</tfoot></table>';
  }

  // ── ONE PATIENT ───────────────────────────────────────────────────────
  function patientSheet(v, history) {
    history = Array.isArray(history) ? history : [];
    var age = v.patient_age != null && v.patient_age !== '' ? v.patient_age + '' : '';
    var head =
      '<div class="hm-kv">' +
        '<div><b>Patient</b>' + esc(v.patient_name || '—') + '</div>' +
        '<div><b>Phone</b>' + esc(v.patient_phone || '—') + '</div>' +
        '<div><b>Age</b>' + esc(age || '—') + '</div>' +
        '<div><b>Sex</b>' + esc(v.patient_sex || v.sex || '—') + '</div>' +
        '<div><b>Patient ID</b>' + esc(v.patient_code || v.case_code || v.id || '—') + '</div>' +
        '<div><b>Seen</b>' + esc(dmyt(v.created_at)) + '</div>' +
        '<div><b>Seen by</b>' + esc(v.clinician_name || '—') + '</div>' +
        '<div><b>Type</b>' + esc(v.patient_type || '—') + (v.ward ? ' · ' + esc(v.ward) : '') + '</div>' +
      '</div>';

    var dx =
      '<div class="hm-kv">' +
        '<div><b>Diagnosis</b>' + esc(v.confirmed_diagnosis || 'Not recorded') + '</div>' +
        '<div><b>Severity</b>' + esc(String(v.severity || '—')) + '</div>' +
      '</div>';

    var hist = '';
    if (history.length) {
      hist = '<table><thead><tr><th>Date</th><th>Diagnosis</th><th>Seen by</th>' +
        '<th class="num">Charged</th><th class="num">Paid</th></tr></thead><tbody>' +
        history.map(function (h) {
          return '<tr><td>' + esc(dmy(h.created_at)) + '</td>' +
            '<td>' + esc(h.confirmed_diagnosis || '—') + '</td>' +
            '<td>' + esc(h.clinician_name || '—') + '</td>' +
            '<td class="num">' + ugx(h.total_charged_ugx) + '</td>' +
            '<td class="num">' + ugx(h.amount_paid) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    var fup = '';
    if (v.follow_up_days || v.follow_up_reason || v.expected_recovery) {
      fup = '<div class="hm-kv">' +
        (v.follow_up_days ? '<div><b>Come back in</b>' + esc(v.follow_up_days) + ' day(s)</div>' : '') +
        (v.expected_recovery ? '<div><b>Expected better by</b>' + esc(dmy(v.expected_recovery)) + '</div>' : '') +
        (v.follow_up_reason ? '<div style="grid-column:1/-1"><b>Why</b>' + esc(v.follow_up_reason) + '</div>' : '') +
        '</div>';
    }

    return '<div class="hm-sheet">' + clinicHead() +
      sect('Patient', head) +
      sect('Diagnosis', dx) +
      sect('Findings', listOrNone(v.clinical_findings)) +
      sect('Laboratory tests ordered', listOrNone(v.lab_tests_ordered)) +
      (v.lab_results && v.lab_results !== v.clinical_findings
        ? sect('Laboratory results', listOrNone(v.lab_results)) : '') +
      sect('Medicines given', medsTable(v.prescription_items)) +
      (prose(v.treatment_plan) ? sect('Treatment plan', prose(v.treatment_plan)) : '') +
      (prose(v.patient_instructions) ? sect('Instructions for the patient', prose(v.patient_instructions)) : '') +
      (fup ? sect('Follow-up', fup) : '') +
      sect('Charges', moneyTable(v)) +
      (hist ? sect('Previous visits', hist) : '') +
      '<div class="hm-foot"><span>' + esc(v.patient_name || '') + ' · ' + esc(dmy(v.created_at)) + '</span>' +
      '<span>Homatt Health</span></div>' +
    '</div>';
  }

  // ── A PERIOD ──────────────────────────────────────────────────────────
  var PERIODS = [
    { key: 'day',   label: 'Today' },
    { key: 'week',  label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year',  label: 'This year' },
  ];

  // The start of the period, in LOCAL time, not UTC. A clinic in Kampala
  // printing "today" at 9am means since midnight where they are standing; a
  // UTC midnight would silently include or drop the early morning.
  function since(period) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    if (period === 'week') d.setDate(d.getDate() - 6);
    else if (period === 'month') d.setDate(1);
    else if (period === 'year') { d.setMonth(0); d.setDate(1); }
    return d;
  }

  function periodSheet(rows, period) {
    rows = (Array.isArray(rows) ? rows : []).slice();
    rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
    var label = (PERIODS.filter(function (p) { return p.key === period; })[0] || {}).label || period;
    var from = since(period);

    var tCharged = 0, tPaid = 0;
    var body = rows.map(function (v) {
      var total = Number(v.total_charged_ugx) || 0, paid = Number(v.amount_paid) || 0;
      tCharged += total; tPaid += paid;
      var meds = (Array.isArray(v.prescription_items) ? v.prescription_items : []).filter(function (m) {
        var n = String((m && (m.drug_name || m.name)) || '').trim();
        return n && !/^(n\/?a|none|nil|-{1,2})$/i.test(n);
      }).length;
      return '<tr>' +
        '<td>' + esc(dmy(v.created_at)) + '</td>' +
        '<td>' + esc(v.patient_name || '—') + '</td>' +
        '<td>' + esc(v.patient_phone || '') + '</td>' +
        '<td>' + esc(v.confirmed_diagnosis || '—') + '</td>' +
        '<td>' + esc(v.severity || '') + '</td>' +
        '<td>' + esc(v.clinician_name || '') + '</td>' +
        '<td class="num">' + meds + '</td>' +
        '<td class="num">' + ugx(total) + '</td>' +
        '<td class="num">' + ugx(paid) + '</td>' +
        '<td class="num">' + ugx(Math.max(0, total - paid)) + '</td>' +
      '</tr>';
    }).join('');

    var table = rows.length
      ? '<table><thead><tr><th>Date</th><th>Patient</th><th>Phone</th><th>Diagnosis</th>' +
        '<th>Severity</th><th>Seen by</th><th class="num">Meds</th><th class="num">Charged</th>' +
        '<th class="num">Paid</th><th class="num">Owing</th></tr></thead>' +
        '<tbody>' + body + '</tbody><tfoot><tr>' +
        '<td colspan="6">' + rows.length + ' patient' + (rows.length === 1 ? '' : 's') + '</td>' +
        '<td class="num"></td>' +
        '<td class="num">' + ugx(tCharged) + '</td>' +
        '<td class="num">' + ugx(tPaid) + '</td>' +
        '<td class="num">' + ugx(Math.max(0, tCharged - tPaid)) + '</td>' +
        '</tr></tfoot></table>'
      : '<p class="hm-none">No patients were recorded in this period.</p>';

    return '<div class="hm-sheet">' + clinicHead() +
      '<h2>Patients — ' + esc(label) + '</h2>' +
      '<div class="hm-sub" style="margin-bottom:4px">' + esc(dmy(from)) + ' to ' + esc(dmy(new Date())) + '</div>' +
      table +
      '<div class="hm-foot"><span>Patients ' + esc(label.toLowerCase()) + '</span><span>Homatt Health</span></div>' +
    '</div>';
  }

  // ── showing and printing ──────────────────────────────────────────────
  function show(title, html) {
    var root = ensureDom();
    root.innerHTML = html;
    document.getElementById('hmPrintPaper').innerHTML = html;
    document.getElementById('hmPrintTitle').textContent = title;
    document.getElementById('hmPrintWrap').className = 'hm-noprint on';
  }

  function doPrint() {
    document.body.classList.add('hm-printing');
    try { window.print(); }
    catch (e) { /* a browser with no print: nothing to do but leave the sheet up */ }
    // Some browsers return from print() synchronously and some do not; the
    // class has to come off either way or the app stays hidden on the NEXT
    // print. afterprint where it exists, a timer where it does not.
    var off = function () { document.body.classList.remove('hm-printing'); };
    if (window.onafterprint !== undefined) window.addEventListener('afterprint', off, { once: true });
    setTimeout(off, 1500);
  }

  function close() {
    var w = document.getElementById('hmPrintWrap');
    if (w) w.className = 'hm-noprint';
    document.body.classList.remove('hm-printing');
    var r = document.getElementById(ROOT_ID);
    if (r) r.innerHTML = '';
  }

  function patient(v, history) {
    if (!v) return;
    show((v.patient_name || 'Patient') + ' — full record', patientSheet(v, history));
  }

  // The period picker. Asking first, because the commonest mistake with a
  // print button is printing the wrong range and only finding out on paper.
  function askPeriod(load) {
    var root = ensureDom();
    var chips = PERIODS.map(function (p) {
      return '<button class="hm-pbtn ghost" data-period="' + p.key + '" style="margin:0 6px 6px 0">' +
        esc(p.label) + '</button>';
    }).join('');
    show('Print patients', '<div class="hm-sheet"><h2>Which period?</h2>' +
      '<p class="hm-sub">Choose what to print. Nothing is sent anywhere — the list is built ' +
      'from this clinic’s own records.</p><div id="hmPeriodChips">' + chips + '</div></div>');
    var wrap = document.getElementById('hmPrintPaper');
    // A plain loop, not NodeList.forEach: older engines have the NodeList but
    // not the method, and this file exists partly because of that class of
    // fault.
    var btns = wrap.querySelectorAll('[data-period]');
    for (var bi = 0; bi < btns.length; bi++) (function (b) {
      b.onclick = async function () {
        var key = b.getAttribute('data-period');
        show('Print patients', '<div class="hm-sheet"><h2>Collecting…</h2></div>');
        var rows = [];
        try { rows = await load(since(key).toISOString(), key); } catch (e) { rows = null; }
        if (rows == null) {
          show('Print patients', '<div class="hm-sheet"><h2>Could not read the records</h2>' +
            '<p>This needs a connection. Try again when you are back online.</p></div>');
          return;
        }
        var label = (PERIODS.filter(function (p) { return p.key === key; })[0] || {}).label || key;
        show('Patients — ' + label, periodSheet(rows, key));
      };
    })(btns[bi]);
  }

  root.HomattPrint = {
    patient: patient,
    askPeriod: askPeriod,
    close: close,
    // for the measurements
    _periodSheet: periodSheet, _patientSheet: patientSheet, _since: since,
  };
})(window);
