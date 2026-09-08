/* Homatt Health — the floating "say it" widget
 *
 * A microphone that follows the clinician around the app. Tap it anywhere,
 * say who the patient is and what they came with, and it shows back what it
 * understood plus what the guideline books think it might be. Tap a condition
 * and it opens the treatment already filled in, at the one-tap package.
 *
 * WHY IT FLOATS
 * -------------
 * The dictate button on the intake screen is the right place when you are
 * already there. You are usually not: you are on the dashboard, or looking at
 * a patient's history, and a patient has walked in. Four taps to reach a
 * microphone is four taps during which you are not listening to them.
 *
 * WHAT IT IS ALLOWED TO DO
 * ------------------------
 * Exactly what the intake screen is allowed to do, and no more. It uses the
 * same parser, the same level meter, the same fault messages, and the same
 * suggestion engine reading the same two books. It NEVER decides anything:
 * the conditions it lists are suggestions with a match strength and a page
 * reference, and the clinician taps one. Nothing is saved until they do.
 *
 * WHY IT IS SEE-THROUGH
 * ---------------------
 * It sits on top of screens people are reading. At rest it is faint enough to
 * read a table through and solid enough to find; touching it or opening it
 * brings it fully back. The clinic can set how faint, or turn it off, in
 * Settings — a floating thing that cannot be moved out of the way is a
 * nuisance, not a feature.
 */
(function (global) {
  'use strict';

  var DOC = global.document;
  if (!DOC) return;

  var KEY_OPACITY = 'homatt_speak_opacity';   // 0.25 … 1
  var KEY_OFF     = 'homatt_speak_off';       // '1' hides it entirely
  var KEY_SIDE    = 'homatt_speak_side';      // 'right' | 'left'
  var HANDOFF     = 'homatt_speak_handoff';   // what the intake screen picks up

  function pref(k, dflt) {
    try { var v = localStorage.getItem(k); return v === null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── The parts on screen ──────────────────────────────────────────────────
  var el = {};      // filled by build()
  var session = null;   // the live recorder, while one is running
  var heard = '';       // the transcript, verbatim
  var facts = null;     // what the parser made of it

  function build() {
    if (el.root) return el.root;

    var root = DOC.createElement('div');
    root.className = 'sp-root';
    root.innerHTML =
      '<button type="button" class="sp-fab" id="spFab" aria-label="Say who the patient is">' +
        '<span class="material-icons-outlined">mic</span>' +
      '</button>' +
      '<div class="sp-sheet" id="spSheet" hidden role="dialog" aria-modal="true" ' +
           'aria-label="Say who the patient is">' +
        '<div class="sp-head">' +
          '<b id="spTitle">Say who it is and what they came with</b>' +
          '<button type="button" class="sp-x" id="spClose" aria-label="Close">' +
            '<span class="material-icons-outlined">close</span></button>' +
        '</div>' +
        '<div class="sp-body" id="spBody"></div>' +
      '</div>' +
      '<div class="sp-scrim" id="spScrim" hidden></div>';
    DOC.body.appendChild(root);

    el.root = root;
    el.fab = root.querySelector('#spFab');
    el.sheet = root.querySelector('#spSheet');
    el.body = root.querySelector('#spBody');
    el.title = root.querySelector('#spTitle');
    el.scrim = root.querySelector('#spScrim');

    el.fab.addEventListener('click', open);
    root.querySelector('#spClose').addEventListener('click', close);
    el.scrim.addEventListener('click', close);
    DOC.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !el.sheet.hidden) close();
    });

    applyLook();
    return root;
  }

  function applyLook() {
    if (!el.root) return;
    var o = parseFloat(pref(KEY_OPACITY, '0.55'));
    if (!isFinite(o) || o < 0.2 || o > 1) o = 0.55;
    el.root.style.setProperty('--sp-rest', String(o));
    el.root.setAttribute('data-side', pref(KEY_SIDE, 'right') === 'left' ? 'left' : 'right');
    el.root.hidden = pref(KEY_OFF, '') === '1';
  }

  // ── Opening, and asking for the microphone ───────────────────────────────
  function open() {
    build();
    el.sheet.hidden = false;
    el.scrim.hidden = false;
    el.root.classList.add('sp-open');
    startListening();
  }

  function close() {
    if (session) { try { session.stop(); } catch (e) {} session = null; }
    if (!el.sheet) return;
    el.sheet.hidden = true;
    el.scrim.hidden = true;
    el.root.classList.remove('sp-open');
  }

  function listeningHtml() {
    return '' +
      '<div class="sp-listen" id="spListen" data-idle="Tap Finished when you ' +
           'have said it" data-finish=" — tap Finished when you are done">' +
        '<span class="sp-dot" aria-hidden="true"></span>' +
        '<span class="sp-bars" id="spBars" aria-hidden="true">' +
          '<i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' +
        '<span class="sp-time" id="spTime">0:00</span>' +
        '<span class="it-live-hint sp-hint">Tap Finished when you have said it</span>' +
      '</div>' +
      '<p class="sp-eg">“Her name is <b>Grace Nakato</b>, <b>female</b>, ' +
        '<b>40 years</b>, complains of <b>cough</b> for a week, temp <b>37.9</b>.”</p>' +
      '<div class="sp-acts">' +
        '<button type="button" class="sp-go" id="spStop">' +
          '<span class="material-icons-outlined">check</span> Finished</button>' +
      '</div>';
  }

  function say(msg, kind) {
    el.body.innerHTML = '<div class="sp-say ' + (kind || '') + '">' + esc(msg) + '</div>' +
      '<div class="sp-acts"><button type="button" class="sp-go" id="spRetry">' +
      '<span class="material-icons-outlined">mic</span> Try again</button></div>';
    var r = el.body.querySelector('#spRetry');
    if (r) r.addEventListener('click', startListening);
  }

  async function startListening() {
    var D = global.HomattDictate;
    if (!D || !D.listen) { say('Dictation is not loaded on this screen.', 'warn'); return; }
    el.title.textContent = 'Listening…';
    el.body.innerHTML = listeningHtml();
    el.root.classList.add('sp-hot');

    var stopBtn = el.body.querySelector('#spStop');
    if (stopBtn) stopBtn.addEventListener('click', function () {
      if (session) session.stop();
    });

    try {
      session = await D.listen({
        mode: 'story',
        live: { box: 'spListen', bars: 'spBars', time: 'spTime' },
        onReading: function () {
          el.title.textContent = 'Reading it…';
          var h = el.body.querySelector('.sp-hint');
          if (h) { h.textContent = 'Reading what you said…'; h.className = 'it-live-hint sp-hint'; }
        },
      });
    } catch (e) {
      el.root.classList.remove('sp-hot');
      el.title.textContent = 'Could not listen';
      say((e && e.message) || 'The microphone would not start.', 'warn');
      session = null;
      return;
    }

    try {
      heard = await session.done;
      session = null;
      el.root.classList.remove('sp-hot');
      showSummary();
    } catch (e) {
      session = null;
      el.root.classList.remove('sp-hot');
      el.title.textContent = 'Nothing was written down';
      say((e && e.message) || 'That did not work.', 'warn');
    }
  }

  // ── What it understood ───────────────────────────────────────────────────
  function readFacts(text) {
    var D = global.HomattDictate;
    var who = D.parsePerson(text);
    var story = D.parseStory(text);
    var vit = D.parseVitals(text);
    return {
      heard: text,
      name: who.name || '',
      sex: who.sex || '',
      age: who.age || '',
      ageUnit: who.ageUnit || 'years',
      chief: story.complaint || '',
      subjective: D.dropPersonBits(story.history, who) || '',
      background: story.background || '',
      vitals: vit.vitals || {},
      negations: story.negations || [],
      ignored: vit.ignored || [],
    };
  }

  function tile(label, value) {
    var missing = !String(value || '').trim();
    return '<div class="sp-tile' + (missing ? ' missing' : '') + '">' +
      '<span class="sp-k">' + esc(label) + '</span>' +
      '<span class="sp-v">' + (missing ? 'not said' : esc(value)) + '</span></div>';
  }

  function showSummary() {
    facts = readFacts(heard);
    el.title.textContent = 'Check this, then pick';

    var v = facts.vitals, vs = [];
    if (v.sbp && v.dbp) vs.push(v.sbp + '/' + v.dbp + ' mmHg');
    if (v.temp) vs.push(v.temp + ' °C');
    if (v.pulse) vs.push(v.pulse + '/min');
    if (v.weight) vs.push(v.weight + ' kg');
    var age = facts.age ? facts.age + ' ' + facts.ageUnit : '';

    var html =
      '<div class="sp-grid">' +
        tile('Name', facts.name) + tile('Sex', facts.sex) +
        tile('Age', age) + tile('Vitals', vs.join(' · ')) +
        tile('Main complaint', facts.chief) +
      '</div>' +
      (facts.subjective
        ? '<div class="sp-story"><span class="sp-k">The story</span>' +
          esc(facts.subjective) + '</div>' : '') +
      (facts.negations.length
        ? '<div class="sp-neg">You said: <b>' + esc(facts.negations.join(', ')) +
          '</b> — check that is right</div>' : '') +
      facts.ignored.map(function (g) {
        return '<div class="sp-neg">Ignored ' + esc(g.key) + ' ' + esc(g.value) +
               ' — ' + esc(g.why) + '</div>';
      }).join('') +
      '<details class="sp-heard"><summary>What was heard, word for word</summary>' +
        '<textarea class="sp-heard-t" id="spHeardT" rows="3">' + esc(heard) + '</textarea>' +
        '<button type="button" class="sp-again" id="spFix">Use these words</button>' +
      '</details>' +
      '<div class="sp-dx" id="spDx"><div class="sp-dx-wait">' +
        'Reading the guideline books…</div></div>' +
      '<div class="sp-acts">' +
        '<button type="button" class="sp-go ghost" id="spRedo">' +
          '<span class="material-icons-outlined">mic</span> Say it again</button>' +
        '<button type="button" class="sp-go" id="spOpen">' +
          '<span class="material-icons-outlined">arrow_forward</span> ' +
          'Open the treatment</button>' +
      '</div>';
    el.body.innerHTML = html;

    el.body.querySelector('#spRedo').addEventListener('click', startListening);
    el.body.querySelector('#spOpen').addEventListener('click', function () { handOff(''); });
    el.body.querySelector('#spFix').addEventListener('click', function () {
      var t = el.body.querySelector('#spHeardT');
      var fixed = String((t && t.value) || '').trim();
      if (!fixed) return;
      heard = fixed;
      showSummary();
    });

    suggest();
  }

  // ── What the books think it might be ─────────────────────────────────────
  //
  // Loaded only now, and only once: the WHO differential index is 786 KB and
  // the service worker keeps it for good, so a clinic pays for it the first
  // time the widget is used and never again. It is NOT loaded on page open —
  // most screens never need it, and this app is used on bought megabytes.
  async function suggest() {
    var host = el.body.querySelector('#spDx');
    if (!host) return;
    if (!facts.chief && !facts.subjective) {
      host.innerHTML = '<div class="sp-dx-wait">Say what they came with and the ' +
        'books can suggest something.</div>';
      return;
    }
    if (!global.Impression) {
      host.innerHTML = '<div class="sp-dx-wait">The guideline books are not on ' +
        'this screen. Open the treatment and they will be there.</div>';
      return;
    }
    var ok = false;
    try { ok = await global.Impression.ready(); } catch (e) { ok = false; }
    if (!ok) {
      host.innerHTML = '<div class="sp-dx-wait">Could not open the guideline ' +
        'books. Open the treatment and pick there.</div>';
      return;
    }
    var res;
    try {
      res = global.Impression.suggest({
        sex: facts.sex, age: facts.age, ageUnit: facts.ageUnit,
        chief: facts.chief, subjective: facts.subjective,
        background: facts.background, vitals: facts.vitals,
      }, 3);
    } catch (e) {
      host.innerHTML = '<div class="sp-dx-wait">Could not read the guidelines.</div>';
      return;
    }
    var items = (res && res.items) || [];
    if (!items.length) {
      host.innerHTML = '<div class="sp-dx-wait">Nothing in the books matches this ' +
        'yet. Open the treatment and type the diagnosis there.</div>';
      return;
    }
    host.innerHTML =
      '<div class="sp-dx-note">Suggestions <b>from the books</b>, not a diagnosis. ' +
        'The figure is how strongly what you said matches how the guideline ' +
        'describes it — not a chance of having it. <b>You decide.</b></div>' +
      items.map(function (it) {
        return '<button type="button" class="sp-dx-b" data-dx="' + esc(it.title) + '">' +
          '<span class="sp-dx-name">' + esc(it.title) + '</span>' +
          '<span class="sp-dx-pct">' + esc(it.pct) + '%<i>match</i></span>' +
          ((it.matched && it.matched.length)
            ? '<span class="sp-dx-why">from what you said: <b>' +
              esc(it.matched.slice(0, 4).join(', ')) + '</b></span>' : '') +
          '<span class="sp-dx-src">' +
            esc((it.srcs || []).slice(0, 2).join(' · ')) + '</span>' +
        '</button>';
      }).join('');
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.sp-dx-b');
      if (b) handOff(b.dataset.dx || '');
    });
  }

  // ── Into the treatment, already filled in ────────────────────────────────
  //
  // Everything crosses in localStorage rather than a query string: a URL that
  // carries a patient's name and complaint ends up in history, in a shared
  // phone's address bar, and in any log in between.
  function handOff(dx) {
    if (!facts) return;
    var payload = {
      at: Date.now(),
      heard: heard,
      dx: dx || '',
      name: facts.name, sex: facts.sex, age: facts.age, ageUnit: facts.ageUnit,
      chief: facts.chief, subjective: facts.subjective,
      background: facts.background, vitals: facts.vitals,
    };
    try { localStorage.setItem(HANDOFF, JSON.stringify(payload)); } catch (e) {}
    var here = /\/new-order\.html/i.test(location.pathname);
    if (here && typeof global._speakHandoff === 'function') {
      close();
      global._speakHandoff();          // already on the screen: fill it in place
      return;
    }
    location.href = 'new-order.html?speak=1';
  }

  /** What the intake screen picks up, once. */
  function takeHandoff() {
    try {
      var raw = localStorage.getItem(HANDOFF);
      if (!raw) return null;
      localStorage.removeItem(HANDOFF);
      var p = JSON.parse(raw);
      // Anything older than a few minutes is a stale tab, not this patient.
      if (!p || !p.at || Date.now() - p.at > 10 * 60 * 1000) return null;
      return p;
    } catch (e) { return null; }
  }

  function mount() {
    if (pref(KEY_OFF, '') === '1') return;
    build();
  }

  if (DOC.readyState === 'loading') {
    DOC.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  global.HomattSpeak = {
    open: open, close: close, mount: mount,
    applyLook: applyLook, takeHandoff: takeHandoff,
    KEY_OPACITY: KEY_OPACITY, KEY_OFF: KEY_OFF, KEY_SIDE: KEY_SIDE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
