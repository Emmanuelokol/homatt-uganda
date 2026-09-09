/* Homatt Health — New Treatment intake
 *
 * The order a consultation actually happens in, on the screen, in that order:
 *
 *   Who is it?      name and phone, first, before anything else — and if this
 *                   person still owes the clinic money, that shows here, next
 *                   to the name, the moment it is typed.
 *   1  Complaint    what the patient says: the main complaint and its story.
 *   2  Vitals       what you measure: BP, temperature, weight, pulse.
 *   3  Background   what you already know: chronic illness, family, social.
 *   What might it be?   updated as you type, from the guideline books on the
 *                   phone. Up to three, each with what pointed to it, the book
 *                   and page it came from, and the tests that would confirm it.
 *   Confirm         the clinician picks. Only then does the one-tap package
 *                   open, exactly as before.
 *
 * Two things this deliberately does NOT do:
 *   • It never diagnoses. The figure next to a suggestion is a match strength,
 *     not a probability, and the screen says so.
 *   • It never blocks. Every field is optional; a nurse in a hurry can still
 *     type a diagnosis straight into the box below and carry on.
 *
 * Everything runs on the device against the bundled guideline databases, so it
 * is instant and costs no data — which is the only way it can be "real time"
 * on a Ugandan phone.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function state() { return window._wizState || {}; }

  var data = {
    sex: '', age: '', ageUnit: 'years',
    chief: '', subjective: '', background: '',
    vitals: { sbp: '', dbp: '', temp: '', weight: '', pulse: '' },
  };
  var lastItems = [];
  var engineReady = false;

  // ── The record that gets saved ──────────────────────────────────────────
  // Written into clinical_findings, which already exists — no database change,
  // so nothing can break for a clinic that has not run a migration.
  function summary() {
    var v = data.vitals, bits = [];
    var who = [];
    if (data.sex) who.push(data.sex.charAt(0).toUpperCase() + data.sex.slice(1));
    if (data.age) who.push(data.age + ' ' + (data.ageUnit === 'months' ? 'months' : 'years'));
    if (who.length) bits.push('Patient: ' + who.join(', '));
    if (data.chief.trim()) bits.push('Chief complaint: ' + data.chief.trim());
    if (data.subjective.trim()) bits.push('History: ' + data.subjective.trim());
    var vs = [];
    if (v.sbp && v.dbp) vs.push('BP ' + v.sbp + '/' + v.dbp + ' mmHg');
    if (v.temp) vs.push('Temp ' + v.temp + ' °C');
    if (v.weight) vs.push('Weight ' + v.weight + ' kg');
    if (v.pulse) vs.push('Pulse ' + v.pulse + '/min');
    if (vs.length) bits.push('Vitals: ' + vs.join(' · '));
    if (data.background.trim()) bits.push('Background: ' + data.background.trim());
    return bits.join('\n');
  }
  function publish() {
    var s = state();
    s.intake = { sex: data.sex, age: data.age, ageUnit: data.ageUnit,
                 chief: data.chief, subjective: data.subjective,
                 background: data.background, vitals: data.vitals,
                 summary: summary() };
    s.patientSex = data.sex || '';
    s.patientAgeYears = ageYears();
    s.ageBand = (window.Impression && window.Impression.ageBand)
      ? window.Impression.ageBand(data.age, data.ageUnit) : '';
    // The child's weight also answers the paediatric dosing question later.
    if (data.vitals.weight) s.patientWeightKg = data.vitals.weight;
  }
  window._intakeSummary = summary;

  // ── Tabs ────────────────────────────────────────────────────────────────
  function showTab(n) {
    ['1', '2', '3'].forEach(function (k) {
      var b = $('itTab' + k), p = $('itPane' + k);
      if (b) b.classList.toggle('on', k === String(n));
      if (p) p.style.display = (k === String(n)) ? 'block' : 'none';
    });
    try { localStorage.setItem('intake_tab', String(n)); } catch (e) {}
  }

  // How full each tab is, shown on the tab itself so nothing is silently
  // forgotten when the nurse is interrupted halfway through.
  function marks() {
    var v = data.vitals;
    var got = [
      !!data.chief.trim() || !!data.subjective.trim(),
      !!(v.sbp || v.dbp || v.temp || v.weight || v.pulse),
      !!data.background.trim(),
    ];
    ['1', '2', '3'].forEach(function (k, i) {
      var b = $('itTab' + k);
      if (b) b.classList.toggle('done', got[i]);
    });
  }

  // ── Live suggestions ────────────────────────────────────────────────────
  var _t = null;
  function schedule() {
    publish(); marks();
    clearTimeout(_t);
    _t = setTimeout(run, 260);
  }

  function chipRow(list, cls) {
    return list.map(function (x) {
      return '<span class="it-ev ' + (cls || '') + '">' + esc(x) + '</span>';
    }).join('');
  }

  function run() {
    var host = $('itImpression');
    if (!host) return;
    var filled = (data.chief + data.subjective + data.background).trim().length
      + (data.vitals.temp ? 3 : 0);
    if (filled < 4) {
      host.innerHTML = '<div class="it-imp-empty">Fill in the complaint above and ' +
        'suggestions will appear here — from the guideline books on this phone, ' +
        'with no internet.</div>';
      lastItems = [];
      return;
    }
    if (!engineReady || !window.Impression) {
      host.innerHTML = '<div class="it-imp-empty">Opening the guideline books…</div>';
      return;
    }
    var res;
    try {
      res = window.Impression.suggest({
        sex: data.sex, age: data.age, ageUnit: data.ageUnit,
        chief: data.chief, subjective: data.subjective,
        background: data.background, vitals: data.vitals,
      }, 3);
    } catch (e) {
      host.innerHTML = '<div class="it-imp-empty">Could not read the guidelines: ' +
        esc(e && e.message) + '</div>';
      return;
    }
    lastItems = res.items || [];

    // Danger signs and the held-back-conditions warning are raised to the
    // "Check this" panel at the top. Left here they sat BELOW three possible
    // diagnoses, which is after the clinician has already started reading them.
    _lastWarnings = warningsNow(res);
    renderCheck(_lastWarnings);

    var html = '';

    if (!lastItems.length) {
      html += '<div class="it-imp-empty">Nothing in the books matches this yet. ' +
        'Add a little more detail, or just type the diagnosis below.</div>';
      host.innerHTML = html;
      return;
    }

    html += '<div class="it-imp-note">These are <b>suggestions from the books</b>, ' +
      'not a diagnosis. The figure is how strongly what you wrote matches how the ' +
      'guideline describes that condition — it is not a chance of having it. ' +
      '<b>You decide.</b></div>';

    html += lastItems.map(function (it, i) {
      var bar = '<div class="it-bar"><span style="width:' + it.pct + '%"></span></div>';
      return '<div class="it-dx' + (i === 0 ? ' top' : '') + '">' +
        '<div class="it-dx-h"><div class="it-dx-name">' + esc(it.title) + '</div>' +
        '<div class="it-dx-pct">' + it.pct + '%<i>match</i></div></div>' + bar +
        (it.matched && it.matched.length
          ? '<div class="it-row"><span class="it-lbl">Because you wrote</span>' +
            chipRow(it.matched.slice(0, 6)) + '</div>' : '') +
        (it.seen ? '<div class="it-row"><span class="it-lbl">At this clinic</span>' +
            '<span class="it-ev seen">treated ' + it.seen + ' time' +
            (it.seen !== 1 ? 's' : '') + ' before</span></div>' : '') +
        '<div class="it-row"><span class="it-lbl">From</span>' +
          chipRow(it.srcs.slice(0, 3), 'src') + '</div>' +
        (it.tests && it.tests.length
          ? '<div class="it-row"><span class="it-lbl">To be sure, do</span>' +
            chipRow(it.tests, 'test') + '</div>'
          : '<div class="it-row"><span class="it-lbl">To be sure</span>' +
            '<span class="it-note">' + esc(it.note ||
              'the book names no specific test for this one') + '</span></div>') +
        '<button type="button" class="it-pick" data-i="' + i + '">' +
        'Confirm ' + esc(it.title) + ' &amp; open the package</button>' +
        '</div>';
    }).join('');
    host.innerHTML = html;
  }

  // ── Confirming one ──────────────────────────────────────────────────────
  function confirmDx(i) {
    var it = lastItems[i];
    if (!it) return;
    var box = $('confirmedDx');
    if (box) {
      box.value = it.title;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // The tests the book named are ordered with it — the nurse asked for the
    // condition, not for a second round of typing.
    try {
      var s = state();
      if (it.tests && it.tests.length && Array.isArray(s.labTests)) {
        it.tests.forEach(function (t) { if (s.labTests.indexOf(t) < 0) s.labTests.push(t); });
      }
    } catch (e) {}
    publish();
    var tap = $('ucgOneTap');
    if (tap) {
      tap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tap.classList.add('it-pulse');
      setTimeout(function () { tap.classList.remove('it-pulse'); }, 2200);
    }
    try { showToast('Diagnosis set to “' + it.title + '”. Tap the standard package.', 'success'); }
    catch (e) {}
  }

  function ageYears() {
    var a = parseFloat(data.age);
    if (!isFinite(a) || a < 0) return null;
    return data.ageUnit === 'months' ? a / 12 : a;
  }

  // Who the patient is, in words, right under the name — including the warning
  // that matters most: an adult dose is not a child's dose.
  function paintWho() {
    var el = $('itWhoNote');
    if (!el) return;
    var band = (window.Impression && window.Impression.ageBand)
      ? window.Impression.ageBand(data.age, data.ageUnit) : '';
    var msgs = [];
    if (band === 'paediatric' || band === 'child') {
      msgs.push('<b>This is a child (' + (band === 'paediatric' ? 'under 5' : '5–12') +
        ').</b> Doses go by body weight, not by the adult figure. Put the weight in ' +
        'Vitals, then use <b>Guidelines → Children → Child doses</b> for the ' +
        'weight band. Nothing here fills in an adult dose for a child.');
    }
    if (!data.sex) {
      msgs.push('Sex is not set, so conditions that only affect one sex are left out ' +
        'of the suggestions.');
    }
    el.className = 'it-whonote' + (band === 'paediatric' || band === 'child' ? ' child' : '');
    el.innerHTML = msgs.join('<br><br>');
    el.style.display = msgs.length ? 'block' : 'none';
  }

  // ── Does this patient still owe the clinic? ─────────────────────────────
  // The clinic's own word for it is "Demanded". If a name or number matches an
  // unpaid visit, that has to be visible right where the name is typed —
  // before the treatment, not after it, when the money conversation is over.
  var _debtT = null, _debtCache = null;
  function clinicId() {
    try { return JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId || null; }
    catch (e) { return null; }
  }
  async function loadOwing() {
    if (_debtCache) return _debtCache;
    var cid = clinicId();
    var supa = (typeof _getClinicSupabase === 'function') ? _getClinicSupabase() : null;
    if (!cid || !supa || !window.ClinicOffline) return (_debtCache = []);
    try {
      var r = await window.ClinicOffline.cachedQuery('owing_' + cid, function () {
        return supa.from('clinic_diagnoses')
          .select('patient_name,patient_phone,total_charged_ugx,amount_paid,created_at,case_code')
          .eq('clinic_id', cid)
          .order('created_at', { ascending: false })
          .limit(400);
      });
      var rows = (r && r.data) || [];
      // Every name this clinic has written down recently, kept from the same
      // fetch. It costs nothing extra and it is what lets a misheard Ugandan
      // name be matched to the person it belongs to.
      _seenNames = [];
      var already = {};
      rows.forEach(function (x) {
        var n = String(x.patient_name || '').trim();
        var k = n.toLowerCase();
        if (n.length >= 3 && !already[k]) { already[k] = 1; _seenNames.push(n); }
      });
      _debtCache = rows.filter(function (x) {
        return (Number(x.total_charged_ugx) || 0) - (Number(x.amount_paid) || 0) > 0;
      });
    } catch (e) { _debtCache = []; }
    return _debtCache;
  }

  /* ── Matching a heard name to a person this clinic already knows ──────────
   *
   * A recogniser trained on English hears "Emmanuel Opio" as "Emmanuel Opal".
   * Nothing in the audio can fix that — but the clinic has almost certainly
   * written the real spelling down before, and comparing against their own
   * records is both the most accurate check available and the most private:
   * it happens on the phone, against names the clinic already has.
   *
   * It NEVER renames anybody. A wrong auto-correct on a name is a record about
   * the wrong person, which is worse than a misspelling. It offers, and the
   * clinician taps.
   */
  var _seenNames = [];
  var _nameAlts = [];

  function fold(s) {
    return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // How many single-letter edits apart, capped — full Levenshtein on 400 names
  // on a cheap phone is wasted work when anything past 2 is not a match.
  function editsWithin(a, b, cap) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur.slice();
    }
    return prev[b.length];
  }

  /** Names this clinic has, close enough to what was heard to be worth asking. */
  function closeNames(heard) {
    var h = fold(heard);
    if (h.length < 4 || !_seenNames.length) return [];
    var hw = h.split(' ');
    var out = [];
    _seenNames.forEach(function (known) {
      var k = fold(known);
      if (k === h) return;                       // already exactly right
      var kw = k.split(' ');
      // A shared word plus one near-miss word is the shape of a misheard
      // surname: "Emmanuel Opal" against "Emmanuel Opio".
      var exact = 0, near = 0;
      hw.forEach(function (w) {
        if (w.length < 3) return;
        if (kw.indexOf(w) >= 0) { exact++; return; }
        for (var i = 0; i < kw.length; i++) {
          if (kw[i].length >= 4 && editsWithin(w, kw[i], 2) <= 2) { near++; return; }
        }
      });
      if (exact >= 1 && near >= 1) out.push({ name: known, score: exact * 2 + near });
      else if (!exact && near >= 2) out.push({ name: known, score: near });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3).map(function (x) { return x.name; });
  }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  async function checkDebt() {
    var box = $('itDebt');
    if (!box) return;
    var name = ($('quickPatientName') || {}).value || '';
    var phone = ($('quickPatientPhone') || {}).value || '';
    var nk = name.trim().toLowerCase(), pk = digits(phone);
    if (nk.length < 3 && pk.length < 7) { box.style.display = 'none'; return; }
    var rows = await loadOwing();
    var hits = rows.filter(function (r) {
      var rp = digits(r.patient_phone);
      if (pk.length >= 7 && rp.length >= 7) return rp.slice(-9) === pk.slice(-9);
      return nk.length >= 3 && String(r.patient_name || '').toLowerCase().indexOf(nk) >= 0;
    });
    if (!hits.length) { box.style.display = 'none'; return; }
    var owed = hits.reduce(function (a, r) {
      return a + Math.max(0, (Number(r.total_charged_ugx) || 0) - (Number(r.amount_paid) || 0));
    }, 0);
    var when = hits[0].created_at ? new Date(hits[0].created_at).toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' }) : '';
    box.innerHTML = '<span class="material-icons-outlined">account_balance_wallet</span>' +
      '<div><b>This patient still owes UGX ' + owed.toLocaleString('en-UG') + '</b>' +
      '<i>' + hits.length + ' unpaid visit' + (hits.length !== 1 ? 's' : '') +
      (when ? ', latest ' + esc(when) : '') +
      (hits[0].case_code ? ' · ' + esc(hits[0].case_code) : '') +
      '. Treat first — this is only so you know.</i></div>';
    box.style.display = 'flex';
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function bind() {
    if (!$('itTab1')) return;                    // markup not on this page

    ['1', '2', '3'].forEach(function (k) {
      var b = $('itTab' + k);
      if (b) b.addEventListener('click', function () { showTab(k); });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.it-sex-btn'), function (b) {
      b.addEventListener('click', function () {
        data.sex = (data.sex === b.dataset.sex) ? '' : b.dataset.sex;
        Array.prototype.forEach.call(document.querySelectorAll('.it-sex-btn'), function (x) {
          x.classList.toggle('on', x.dataset.sex === data.sex);
        });
        paintWho(); schedule();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.it-unit'), function (b) {
      b.addEventListener('click', function () {
        data.ageUnit = b.dataset.unit;
        Array.prototype.forEach.call(document.querySelectorAll('.it-unit'), function (x) {
          x.classList.toggle('on', x.dataset.unit === data.ageUnit);
        });
        paintWho(); schedule();
      });
    });
    var ageEl = $('itAge');
    if (ageEl) ageEl.addEventListener('input', function () {
      data.age = this.value; paintWho(); schedule();
    });

    var chief = $('itChief'), subj = $('itSubjective'), back = $('itBackground');
    if (chief) chief.addEventListener('input', function () { data.chief = this.value; schedule(); });
    if (subj) subj.addEventListener('input', function () { data.subjective = this.value; schedule(); });
    if (back) back.addEventListener('input', function () { data.background = this.value; schedule(); });

    // One tap per common complaint. Typing a full sentence on a phone is the
    // slowest part of a consultation, and these are the words the books use.
    var chips = document.querySelectorAll('.it-cc');
    Array.prototype.forEach.call(chips, function (c) {
      c.addEventListener('click', function () {
        var w = c.dataset.cc, box = $('itChief');
        if (!box) return;
        var has = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(box.value);
        if (has) {
          box.value = box.value.replace(new RegExp('\\s*,?\\s*\\b' + w + '\\b', 'ig'), '').replace(/^\s*,\s*/, '').trim();
        } else {
          box.value = (box.value.trim() ? box.value.trim() + ', ' : '') + w;
        }
        c.classList.toggle('on', !has);
        data.chief = box.value;
        schedule();
      });
    });

    [['itSbp', 'sbp'], ['itDbp', 'dbp'], ['itTemp', 'temp'],
     ['itWeight', 'weight'], ['itPulse', 'pulse']].forEach(function (p) {
      var el = $(p[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        data.vitals[p[1]] = this.value;
        paintVitals();
        schedule();
      });
    });

    var host = $('itImpression');
    if (host) host.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.it-pick');
      if (b) confirmDx(Number(b.dataset.i));
    });

    ['quickPatientName', 'quickPatientPhone'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        clearTimeout(_debtT);
        _debtT = setTimeout(checkDebt, 350);
      });
    });

    var t = '1';
    try { t = localStorage.getItem('intake_tab') || '1'; } catch (e) {}
    showTab(t === '2' || t === '3' ? t : '1');
    marks();
    paintWho();
    run();

    // Open the books in the background. Nothing waits on it: the nurse can
    // type the whole consultation while this loads.
    if (window.Impression) {
      window.Impression.ready().then(function () {
        engineReady = true;
        run();
      }).catch(function () { engineReady = false; });
    }
  }

  // A measurement that is out of range should look out of range.
  function paintVitals() {
    var f = window.Impression ? window.Impression.vitalFlags(data.vitals) : [];
    var danger = f.some(function (x) { return x.k === 'danger'; });
    var warn = f.some(function (x) { return x.k === 'warn'; });
    var b = $('itTab2');
    if (b) {
      b.classList.toggle('alert', danger);
      b.classList.toggle('warn', !danger && warn);
    }
    [['itTemp', 'temp'], ['itPulse', 'pulse'], ['itSbp', 'sbp']].forEach(function (p) {
      var el = $(p[0]);
      if (!el) return;
      var v = parseFloat(el.value);
      var bad = false;
      if (p[1] === 'temp') bad = isFinite(v) && (v >= 38 || (v < 35.5 && v > 25));
      if (p[1] === 'pulse') bad = isFinite(v) && (v >= 120 || (v > 0 && v < 50));
      if (p[1] === 'sbp') bad = isFinite(v) && v > 0 && (v >= 140 || v < 90);
      el.classList.toggle('out', bad);
    });
  }

  // ── Check this ──────────────────────────────────────────────────────────
  // One panel, above everything, listing what the app believes it has. The
  // clinician reads it and either fixes a box or goes on. Two things live here
  // that used to be elsewhere:
  //
  //   • the warning that conditions are being held back for want of a sex. It
  //     was rendered in the middle of the suggestion list, so the clinician met
  //     three possible diagnoses BEFORE learning the list was incomplete.
  //   • the danger signs the engine raises, for the same reason.
  //
  // It appears when a dictation has filled something in, or when there is a
  // warning worth reading. It is not a modal and never blocks: "Looks right"
  // puts it away, and any edit brings the current picture back.
  var _checkOpen = false, _heardText = '';
  // What the clinician has already read and waved through. The panel is held
  // open by a warning, so without this a warning that will not go away — a
  // rule that moved a condition down, a fever that is still 39.8 — makes
  // "Looks right" do nothing and the panel sits over the form for ever.
  // Dismissing puts away exactly what is on screen; anything NEW brings it
  // back, which is the only reason to force it open in the first place.
  var _checkSeen = '';
  function checkSig(warnings) {
    return (warnings || []).map(function (w) { return w.title; }).join('|');
  }

  function checkTile(key, label, value, tab, focusId) {
    var missing = !String(value || '').trim();
    return '<button type="button" class="it-chk' + (missing ? ' missing' : '') +
      (key === 'complaint' || key === 'history' || key === 'background' ? ' wide' : '') +
      '" data-tab="' + tab + '"' + (focusId ? ' data-focus="' + focusId + '"' : '') + '>' +
      '<div class="it-chk-k">' + esc(label) + '</div>' +
      '<div class="it-chk-v">' + esc(missing ? 'not set — tap to add' : value) + '</div>' +
      '</button>';
  }

  function renderCheck(warnings) {
    var host = $('itCheck');
    if (!host) return;
    var v = data.vitals;
    var vitals = [];
    if (v.sbp && v.dbp) vitals.push(v.sbp + '/' + v.dbp + ' mmHg');
    if (v.temp) vitals.push(v.temp + ' °C');
    if (v.pulse) vitals.push(v.pulse + '/min');
    if (v.weight) vitals.push(v.weight + ' kg');

    var name = ($('quickPatientName') || {}).value || '';
    var age = data.age ? data.age + ' ' + (data.ageUnit === 'months' ? 'months' : 'years') : '';

    var warn = (warnings || []).map(function (w) {
      return '<div class="it-check-warn' + (w.danger ? ' danger' : '') + '">' +
        '<b>' + esc(w.title) + '</b>' + esc(w.detail || '') + '</div>';
    }).join('');

    // "Did you mean …?" — offered, never applied. The clinic's own spelling of
    // a name beats a recogniser's guess at it every time, but only a person
    // can say which patient this is.
    var alt = (name && _nameAlts.length)
      ? '<div class="it-check-alt"><span>Heard <b>' + esc(name) +
        '</b> — this clinic has:</span>' +
        _nameAlts.map(function (n) {
          return '<button type="button" class="it-alt" data-name="' + esc(n) + '">' +
                 esc(n) + '</button>';
        }).join('') + '</div>'
      : '';

    $('itCheckWarn').innerHTML = warn + alt;
    $('itCheckGrid').innerHTML =
        checkTile('name', 'Name', name, 1, 'quickPatientName')
      + checkTile('sex', 'Sex', data.sex, 1, '')
      + checkTile('age', 'Age', age, 1, 'itAge')
      + checkTile('vitals', 'Vitals', vitals.join(' · '), 2, 'itTemp')
      + checkTile('complaint', 'Main complaint', data.chief, 1, 'itChief')
      + checkTile('history', 'The story', data.subjective, 1, 'itSubjective')
      + checkTile('background', 'Background', data.background, 3, 'itBackground');

    var heard = $('itCheckHeard');
    if (_heardText) {
      heard.style.display = '';
      $('itCheckHeardText').textContent = _heardText;
    } else { heard.style.display = 'none'; }

    host.style.display =
      (_checkOpen || (warn && checkSig(warnings) !== _checkSeen)) ? 'block' : 'none';
  }

  // The engine's warnings, raised to the top where they are read in time.
  var _lastWarnings = [];
  function warningsNow(res) {
    var out = [];
    if (res && res.sexBlocked) {
      out.push({ title: res.sexBlocked + ' conditions are being held back',
                 detail: 'The patient\'s sex is not set. Until it is, conditions ' +
                         'that only affect one sex — pregnancy, ectopic pregnancy, ' +
                         'prostate problems — are left out of the list below.' });
    }
    (res && res.flags || []).forEach(function (f) {
      out.push({ title: f.t, detail: f.w || '', danger: f.k === 'danger' });
    });
    return out;
  }
  window._intakeCheck = function (heardText) {
    if (heardText !== undefined) _heardText = heardText;
    _checkOpen = true;
    renderCheck(_lastWarnings);
    // Then ask, without blocking the panel, whether this clinic already has a
    // closer spelling of the name. The roster is already in memory for the
    // unpaid-visit check, so this costs nothing.
    (async function () {
      try {
        var typed = ($('quickPatientName') || {}).value || '';
        if (!typed) { _nameAlts = []; return; }
        await loadOwing();
        var alts = closeNames(typed);
        if (alts.join('|') !== _nameAlts.join('|')) {
          _nameAlts = alts;
          renderCheck(_lastWarnings);
        }
      } catch (e) { _nameAlts = []; }
    })();
    var el = $('itCheck');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Dictating the vitals, when the module is present and the clinic is online.
  // It fills the same boxes the clinician types into and fires the same input
  // events, so the abnormal-reading colouring and the suggestions below react
  // exactly as they do to typing.
  function bindCheck() {
    var host0 = $('itCheck');
    if (host0 && !host0._altWired) {
      host0._altWired = 1;
      host0.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('.it-alt');
        if (!b) return;
        var el = $('quickPatientName');
        if (!el) return;
        el.value = b.dataset.name || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        _nameAlts = [];
        renderCheck(_lastWarnings);
      });
    }
    var host = $('itCheck');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var ok = e.target.closest && e.target.closest('#itCheckOk');
      if (ok) {
        _checkOpen = false;
        _checkSeen = checkSig(_lastWarnings);
        renderCheck(_lastWarnings);
        return;
      }
      var tile = e.target.closest && e.target.closest('.it-chk');
      if (!tile) return;
      // Tapping a line takes you to the box it came from, on the right tab.
      var tab = tile.dataset.tab;
      if (tab) showTab(tab);
      var f = tile.dataset.focus;
      var el = f && $(f);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(function () { try { el.focus(); } catch (e2) {} }, 250);
      } else if (tab === '1') {
        var sx = document.querySelector('.it-sex-btn');
        if (sx) sx.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  function bindDictation() {
    if (window.HomattDictate && window.HomattDictate.attach) {
      window.HomattDictate.attach('itDictate', 'itDictateSay', 'vitals');
      // The whole consultation from one dictation: who it is, what they came
      // with, and any readings said out loud.
      window.HomattDictate.attach('itDictateStory', 'itDictateStorySay', 'consult');
    }
  }

  /* ── Arriving from the floating widget ────────────────────────────────────
   *
   * The clinician spoke somewhere else in the app, checked the summary, and
   * tapped a condition. Everything they said is put into the boxes here and
   * the one-tap package is opened on the condition they chose — so the tap
   * that picked the condition is the same tap that opens the treatment.
   *
   * It fills EMPTY boxes only. If this screen already has a patient half
   * entered, that is a different patient and their words are not ours to
   * overwrite.
   */
  function setIfEmpty(id, value) {
    var e = $(id);
    if (!e || !value) return 0;
    if (String(e.value || '').trim()) return 0;
    e.value = value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  }

  function applyHandoff() {
    if (!window.HomattSpeak || !window.HomattSpeak.takeHandoff) return;
    var p = window.HomattSpeak.takeHandoff();
    if (!p) return;

    setIfEmpty('quickPatientName', p.name);
    setIfEmpty('itChief', p.chief);
    setIfEmpty('itSubjective', p.subjective);
    setIfEmpty('itBackground', p.background);
    setIfEmpty('itAge', p.age);
    if (p.age) {
      var u = document.querySelector('[data-unit="' + (p.ageUnit === 'months' ? 'months' : 'years') + '"]');
      if (u && !u.classList.contains('on')) u.click();
    }
    if (p.sex) {
      var b = document.querySelector('.it-sex-btn[data-sex="' + p.sex + '"]');
      if (b && !b.classList.contains('on')) b.click();
    }
    var V = { sbp: 'itSbp', dbp: 'itDbp', temp: 'itTemp', weight: 'itWeight', pulse: 'itPulse' };
    Object.keys(V).forEach(function (k) {
      if (p.vitals && p.vitals[k]) setIfEmpty(V[k], p.vitals[k]);
    });

    // The summary panel, with the words that were actually said, so the check
    // happens here too and not only in the widget that has now closed.
    if (typeof window._intakeCheck === 'function') {
      setTimeout(function () { window._intakeCheck(p.heard || ''); }, 250);
    }

    // Then the condition they picked — written into the confirmed-diagnosis
    // box and handed to the one-tap package, which is the whole point of the
    // journey. Delayed until the guideline database on this screen is open;
    // tapping the button before it is ready does nothing at all.
    if (!p.dx) return;
    setIfEmpty('confirmedDx', p.dx);
    var tries = 0;
    (function openPackage() {
      var btn = $('ucgOneTap');
      var dx = $('confirmedDx');
      if (btn && dx && String(dx.value || '').trim() === p.dx && !btn.disabled) {
        btn.click();
        return;
      }
      if (++tries < 40) setTimeout(openPackage, 250);   // up to 10s, then leave it
    })();
  }

  function start() {
    bind(); bindDictation(); bindCheck();
    // After the screen is wired, so the boxes it fills are the live ones.
    try { applyHandoff(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
  // The widget can also hand off while already on this screen.
  window._speakHandoff = function () { try { applyHandoff(); } catch (e) {} };
})();
