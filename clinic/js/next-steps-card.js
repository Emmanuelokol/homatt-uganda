/* next-steps-card.js
 * A small "Next steps" card under the diagnosis + severity fields on the
 * treatment screen. It never decides anything on its own — it only
 * surfaces judgements two things already make elsewhere in this app:
 *   - HomattVitals (clinic-vitals.js) for temperature and pulse
 *   - the Uganda Clinical Guidelines book, via the same lookup
 *     ucg-autofill.js already uses for the one-tap package
 * If either is missing, or finds nothing worth flagging, the card stays
 * hidden. It never blocks Save and never touches anything the wizard
 * itself reads or writes.
 */
(function () {
  var card, raf;
  var guideline = null;      // { title, page, lineHtml } | null
  var guidelineFor = '';     // text last resolved, so retyping the same
                             // thing twice doesn't requery the database
  var guidelineToken = 0;    // bumped on every lookup so a slow, stale
                             // answer can never overwrite a newer one

  function el(id) { return document.getElementById(id); }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function ageYearsFromForm() {
    var raw = el('itAge') && el('itAge').value;
    var n = parseFloat(raw);
    if (!(n > 0)) return undefined;
    var mos = el('ageUnitMos');
    return (mos && mos.classList.contains('active')) ? n / 12 : n;
  }

  function activeSeverity() {
    var b = document.querySelector('#sevChips .sev-chip.active');
    return b ? b.getAttribute('data-sev') : 'moderate';
  }

  // One line of guideline text worth a clinician's attention, or null.
  // Deliberately narrow: this only ever surfaces the guideline's own
  // words, never a rewritten or summarised version of them.
  function pickWarningLine(info) {
    if (!info) return null;
    var blob = [info.complications, info.management, info.notes, info.full_text]
      .filter(Boolean).join('\n');
    if (!blob) return null;
    var lines = blob.split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l.length > 8; });
    var re = /\brefer|danger sign|\bemergency\b|\burgent(ly)?\b|\badmit\b/i;
    for (var i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        var t = lines[i];
        if (t.length > 160) t = t.slice(0, 157).replace(/\s+\S*$/, '') + '…';
        return t;
      }
    }
    return null;
  }

  function row(tone, text) {
    var color = tone === 'bad' ? '#E0454B' : tone === 'warn' ? '#E2960A' : 'var(--primary-ink,#0E7C5A)';
    return '<div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:' + color +
        ';margin-top:6px;flex:none"></span>' +
      '<span style="font-size:13px;line-height:1.45;color:var(--text)">' + text + '</span></div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render() {
    if (!card) return;
    var rows = [];

    try {
      if (window.HomattVitals) {
        var ay = ageYearsFromForm();
        var t = el('itTemp') && el('itTemp').value;
        var p = el('itPulse') && el('itPulse').value;
        if (t) {
          var tr = window.HomattVitals.temp(t);
          if (tr && (tr.tone === 'warn' || tr.tone === 'bad')) rows.push(row(tr.tone, 'Temp: ' + esc(tr.label)));
        }
        if (p) {
          var pr = window.HomattVitals.pulse(p, ay);
          if (pr && (pr.tone === 'warn' || pr.tone === 'bad')) rows.push(row(pr.tone, 'Pulse: ' + esc(pr.label)));
        }
      }
    } catch (e) {}

    var sev = activeSeverity();
    if (sev === 'severe' || sev === 'critical') {
      rows.push(row(sev === 'critical' ? 'bad' : 'warn',
        'Marked ' + sev + ' — confirm this doesn\'t need same-day referral or admission.'));
    }

    if (guideline && guideline.line) {
      rows.push(row('warn',
        'From the guideline (' + esc(guideline.title) + '): “' + esc(guideline.line) + '”' +
        (guideline.condId != null
          ? ' <button type="button" class="nsc-open" data-cid="' + guideline.condId +
            '" data-title="' + esc(guideline.title) + '" data-page="' + (guideline.page || '') +
            '" style="margin-left:6px;border:none;background:none;color:var(--primary-ink,#0E7C5A);' +
            'font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;padding:0">Open guideline</button>'
          : '')));
    }

    if (!rows.length) { card.style.display = 'none'; card.innerHTML = ''; return; }

    card.innerHTML =
      '<div class="wiz-card" style="margin-top:10px;padding:12px 14px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;' +
        'color:var(--text-lt,#5F6368);margin-bottom:2px">Next steps</div>' +
      rows.join('') + '</div>';
    card.style.display = 'block';

    var openBtn = card.querySelector('.nsc-open');
    if (openBtn) openBtn.onclick = function () {
      try {
        window.UCGPackage.open(Number(openBtn.getAttribute('data-cid')), openBtn.getAttribute('data-title'),
          activeSeverity(), openBtn.getAttribute('data-page') || null);
      } catch (e) {}
    };
  }

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; render(); });
  }

  var guidelineTimer = null;
  function scheduleGuidelineLookup() {
    clearTimeout(guidelineTimer);
    guidelineTimer = setTimeout(runGuidelineLookup, 450);
  }

  async function runGuidelineLookup() {
    var box = el('confirmedDx');
    var text = (box && box.value || '').trim();
    if (text === guidelineFor) return;   // nothing actually changed
    guidelineFor = text;
    var myToken = ++guidelineToken;

    if (text.length < 3 || !window.UCGPackage) {
      guideline = null;
      scheduleRender();
      return;
    }
    try {
      await window.UCGPackage.openDb();
      var hit = window.UCGPackage.resolveDx(text);
      if (myToken !== guidelineToken) return;      // superseded by a newer keystroke
      if (!hit) { guideline = null; scheduleRender(); return; }
      var info = window.UCGPackage.getConditionText(hit.id);
      if (myToken !== guidelineToken) return;
      var line = pickWarningLine(info);
      guideline = line ? { title: hit.title, page: hit.page, condId: hit.id, line: line } : null;
    } catch (e) {
      if (myToken === guidelineToken) guideline = null;
    }
    if (myToken === guidelineToken) scheduleRender();
  }

  ready(function () {
    card = el('nextStepsCard');
    if (!card) return;

    ['itTemp', 'itPulse', 'itAge'].forEach(function (id) {
      var n = el(id);
      if (n) n.addEventListener('input', scheduleRender);
    });
    var ageMos = el('ageUnitMos'), ageYrs = el('ageUnitYrs');
    if (ageMos) ageMos.addEventListener('click', scheduleRender);
    if (ageYrs) ageYrs.addEventListener('click', scheduleRender);

    var sevBox = el('sevChips');
    if (sevBox) sevBox.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.sev-chip')) scheduleRender();
    });

    var dxBox = el('confirmedDx');
    if (dxBox) dxBox.addEventListener('input', function () { scheduleGuidelineLookup(); scheduleRender(); });

    scheduleRender();
  });
})();
