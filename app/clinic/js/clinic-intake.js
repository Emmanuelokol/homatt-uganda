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

    var html = '';
    if (res.flags && res.flags.length) {
      html += '<div class="it-flags">' + res.flags.map(function (f) {
        return '<div class="it-flag ' + f.k + '"><b>' + esc(f.t) + '</b>' +
          (f.w ? '<i>' + esc(f.w) + '</i>' : '') + '</div>';
      }).join('') + '</div>';
    }

    if (!lastItems.length) {
      html += '<div class="it-imp-empty">Nothing in the books matches this yet. ' +
        'Add a little more detail, or just type the diagnosis below.</div>';
      host.innerHTML = html;
      return;
    }

    // Say plainly what is being held back and why — a blank sex field must
    // never quietly narrow the differential without the clinician knowing.
    if (res.sexBlocked) {
      html += '<div class="it-flags"><div class="it-flag warn">' +
        '<b>' + res.sexBlocked + ' conditions are being held back</b>' +
        '<i>Set the patient\'s sex above. Until then, conditions that only affect ' +
        'one sex — pregnancy, ectopic pregnancy, pelvic inflammatory disease, ' +
        'prostate problems — are left out of this list.</i></div></div>';
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
      _debtCache = rows.filter(function (x) {
        return (Number(x.total_charged_ugx) || 0) - (Number(x.amount_paid) || 0) > 0;
      });
    } catch (e) { _debtCache = []; }
    return _debtCache;
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
