/* Homatt Health — dictating the vitals
 *
 * A clinician holding a phone in one hand and a cuff in the other should be
 * able to say "temp 38.5, BP 120 over 80, pulse 96, weight 62" and have the
 * four boxes fill in.
 *
 * Only the vitals. Speech never sets a diagnosis and never adds a medicine:
 * a misheard drug name becomes a prescription, and no recogniser is good
 * enough at "artemether/lumefantrine" to be trusted with that. Numbers are the
 * one thing every recogniser does well, and a wrong number is visible on the
 * screen before it reaches the record.
 *
 * PARSING RULES, and why they are strict
 * --------------------------------------
 * A value is taken ONLY when the clinician said what it was — a label
 * ("temp", "pulse") or an unambiguous unit ("kg", "mmHg"). A bare number is
 * left alone. Guessing which box "38.5" belongs to is how a temperature ends
 * up in the weight field, and the clinician would have to notice to undo it.
 *
 * Every reading is then range-checked against what a human body can do. A
 * value outside the range is REPORTED, not stored: "I heard 385 for the
 * temperature, which cannot be right" is useful; silently writing it is not.
 */
(function (global) {
  'use strict';

  // Recognisers write digits most of the time, but not always, and Ugandan
  // clinicians dictating a decimal often say "thirty eight point five".
  var WORD = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
    fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100,
  };

  // Longest first, or the alternation matches "eight" inside "eighty" and
  // leaves a stray "y" behind — which is how "one hundred twenty over eighty"
  // became "120 over 8y" and the blood pressure vanished.
  var WORD_ALT = Object.keys(WORD)
    .sort(function (a, b) { return b.length - a.length; }).join('|');

  // "thirty eight point five" -> "38.5", left alone if it is already digits.
  function digitsFromWords(text) {
    // "38 point 5" — the recogniser wrote the digits but spelled the point.
    var out = String(text || '')
      .replace(/(\d+)\s+point\s+(\d)/gi, '$1.$2');
    var seq = new RegExp(
      '\\b((?:' + WORD_ALT + ')(?:[\\s-]+(?:' + WORD_ALT + '))*)' +
      '(?:\\s+point\\s+((?:' + WORD_ALT + ')(?:\\s+(?:' + WORD_ALT +
      '))*))?', 'gi');
    return out.replace(seq, function (whole, intPart, decPart) {
      var n = valueOf(intPart);
      if (n === null) return whole;
      if (decPart == null) return String(n);
      var digits = decPart.trim().split(/\s+/)
        .map(function (w) { return WORD[w.toLowerCase()]; });
      if (digits.some(function (d) { return d === undefined || d > 9; })) return whole;
      return n + '.' + digits.join('');
    });
  }

  function valueOf(phrase) {
    var words = String(phrase || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
    var total = 0, seen = false, i = 0;
    // Blood pressure is read aloud in hundreds without the word: "one twenty
    // over eighty" is 120/80, not 21/80. Only a single digit followed by a
    // tens word — "one hundred twenty" still takes the ordinary path below.
    if (words.length >= 2) {
      var lead = WORD[words[0]], tens = WORD[words[1]];
      if (lead >= 1 && lead <= 9 && tens >= 10 && tens <= 90 && tens % 10 === 0) {
        total = lead * 100 + tens;
        seen = true;
        i = 2;
      }
    }
    for (; i < words.length; i++) {
      var v = WORD[words[i]];
      if (v === undefined) return null;
      seen = true;
      if (v === 100) total = (total || 1) * 100;
      else if (total && total % 10 === 0 && v < 10) total += v;      // thirty eight
      else if (total && total % 100 === 0 && v < 100) total += v;    // a hundred and twenty
      else total += v;
    }
    return seen ? total : null;
  }

  // What a human body can actually do. A reading outside these is reported
  // back rather than written into the box.
  var RANGE = {
    temp:   [30, 45,  '°C'],
    pulse:  [20, 250, '/min'],
    weight: [0.5, 300, 'kg'],
    sbp:    [50, 300, 'mmHg'],
    dbp:    [20, 200, 'mmHg'],
  };

  // The label has to be spoken. Order does not matter; the clinician may say
  // them in any order, or only some of them.
  var LABEL = [
    ['temp',   /\b(?:temp(?:erature)?|fever)\b[^0-9]{0,14}(\d{1,3}(?:\.\d{1,2})?)/i],
    ['pulse',  /\b(?:pulse|heart\s*rate|h\.?r\.?|beats?)\b[^0-9]{0,14}(\d{1,3})/i],
    ['weight', /\b(?:weigh(?:s|t|ing)?|mass)\b[^0-9]{0,14}(\d{1,3}(?:\.\d{1,2})?)/i],
  ];

  // Blood pressure, however it is said: "120 over 80", "120 on 80", "120/80",
  // "BP 120 80". Both numbers together or not at all — half a blood pressure
  // is not a blood pressure.
  var BP = [
    /\b(?:b\.?p\.?|blood\s*pressure)\b[^0-9]{0,14}(\d{2,3})\s*(?:\/|over|on|by)\s*(\d{2,3})/i,
    /\b(\d{2,3})\s*(?:\/|\s+over\s+|\s+on\s+)\s*(\d{2,3})\s*(?:mm\s?hg)?\b/i,
  ];

  // A unit says what the number is even when the label was not spoken:
  // "62 kilos", "38.5 degrees", "96 beats per minute".
  var UNIT = [
    ['weight', /(\d{1,3}(?:\.\d{1,2})?)\s*(?:kg|kgs|kilo(?:gram)?s?)\b/i],
    ['temp',   /(\d{2,3}(?:\.\d{1,2})?)\s*(?:°\s*c|degrees?(?:\s+c(?:elsius)?)?|celsius)\b/i],
    ['pulse',  /(\d{1,3})\s*(?:bpm|beats?(?:\s+per\s+minute)?)\b/i],
  ];

  function inRange(k, v) {
    var r = RANGE[k];
    return !!r && v >= r[0] && v <= r[1];
  }

  /**
   * Read the vitals out of a sentence.
   *
   * Returns { vitals, heard, ignored }:
   *   vitals  — only the readings that were both labelled and plausible
   *   heard   — a plain-English line per reading taken, to show the clinician
   *   ignored — labelled readings that failed the range check, and why
   */
  function parseVitals(spoken) {
    var text = digitsFromWords(String(spoken || ''));
    var vitals = {}, heard = [], ignored = [];

    function take(key, raw) {
      if (vitals[key] !== undefined) return;             // first mention wins
      var v = parseFloat(raw);
      if (!isFinite(v)) return;
      if (!inRange(key, v)) {
        if (!ignored.some(function (g) { return g.key === key && g.value === v; })) {
          ignored.push({ key: key, value: v,
                         why: 'outside ' + RANGE[key][0] + '–' + RANGE[key][1] +
                              ' ' + RANGE[key][2] });
        }
        return;
      }
      vitals[key] = String(v);
      heard.push(LABELS[key] + ' ' + v + ' ' + RANGE[key][2]);
    }

    for (var i = 0; i < BP.length; i++) {
      var b = BP[i].exec(text);
      if (b) {
        var s = parseFloat(b[1]), d = parseFloat(b[2]);
        // Systolic is the higher of the two; said the other way round it is
        // still a blood pressure, but a systolic under the diastolic is not.
        if (inRange('sbp', s) && inRange('dbp', d) && s > d) {
          vitals.sbp = String(s); vitals.dbp = String(d);
          heard.push('Blood pressure ' + s + '/' + d + ' mmHg');
        } else {
          ignored.push({ key: 'bp', value: b[1] + '/' + b[2],
                         why: 'not a possible blood pressure' });
        }
        break;
      }
    }

    LABEL.forEach(function (p) {
      var m = p[1].exec(text);
      if (m) take(p[0], m[1]);
    });
    UNIT.forEach(function (p) {
      var m = p[1].exec(text);
      if (m) take(p[0], m[1]);
    });

    return { vitals: vitals, heard: heard, ignored: ignored };
  }

  var LABELS = {
    temp: 'Temperature', pulse: 'Pulse', weight: 'Weight',
    sbp: 'Systolic', dbp: 'Diastolic',
  };

  // ── The microphone ───────────────────────────────────────────────────────
  // Recording is only half of it. Transcription happens on the server, so it
  // needs a connection — and this app is built for clinics that often do not
  // have one. The button says so rather than failing silently, because a
  // clinician tapping a dead button twice is worse than a clinician who was
  // told to type.
  var FIELD = { sbp: 'itSbp', dbp: 'itDbp', temp: 'itTemp',
                weight: 'itWeight', pulse: 'itPulse' };
  var MAX_MS = 30000;                    // a vitals reading is one sentence
  var _rec = null, _chunks = [], _stopT = null;

  function say(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'it-dict-say' + (kind ? ' ' + kind : '');
  }

  function offline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  // Put the numbers in the boxes and tell the fields they changed, so the
  // existing abnormal-reading colouring and the suggestion engine both run
  // exactly as they do when the clinician types.
  function fill(vitals) {
    var n = 0;
    Object.keys(vitals).forEach(function (k) {
      var el = document.getElementById(FIELD[k]);
      if (!el) return;
      el.value = vitals[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      n++;
    });
    return n;
  }

  async function transcribe(blob) {
    var form = new FormData();
    form.append('audio', blob, 'vitals.webm');
    // _getClinicSupabase() is the app's one shared client — the page-level
    // `supabase` global is not safe to read here, because a page that assigns
    // to it replaces the library with the client.
    var sb = (typeof global._getClinicSupabase === 'function')
      ? global._getClinicSupabase() : null;
    if (!sb || !sb.functions) throw new Error('not-configured');
    var r = await sb.functions.invoke('transcribe', { body: form });
    if (r.error) throw r.error;
    return (r.data && r.data.text) || '';
  }

  function stop() {
    clearTimeout(_stopT);
    if (_rec && _rec.state !== 'inactive') { try { _rec.stop(); } catch (e) {} }
    _rec = null;
  }

  /**
   * Wire a "say the readings" button to the vitals boxes.
   *   btnId  — the button
   *   sayId  — a line under it where what was heard is written back
   */
  function attach(btnId, sayId) {
    var btn = document.getElementById(btnId);
    var out = document.getElementById(sayId);
    if (!btn) return;

    btn.addEventListener('click', async function () {
      if (_rec) { stop(); btn.classList.remove('on'); say(out, 'Listening finished — reading it…'); return; }

      if (offline()) {
        say(out, 'Dictation needs a connection. Type the readings for now.', 'warn');
        return;
      }
      if (!navigator.mediaDevices || !global.MediaRecorder) {
        say(out, 'This phone cannot record audio. Type the readings.', 'warn');
        return;
      }

      var stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        say(out, 'The microphone is blocked. Allow it in the phone settings.', 'warn');
        return;
      }

      _chunks = [];
      _rec = new MediaRecorder(stream);
      _rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) _chunks.push(ev.data); };
      _rec.onstop = async function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        btn.classList.remove('on');
        var blob = new Blob(_chunks, { type: 'audio/webm' });
        if (!blob.size) { say(out, 'Nothing was recorded.', 'warn'); return; }
        say(out, 'Reading it…');
        var text;
        try {
          text = await transcribe(blob);
        } catch (e) {
          say(out, 'Could not reach the transcription service. Type the ' +
                   'readings for now.', 'warn');
          return;
        }
        var got = parseVitals(text);
        var n = fill(got.vitals);
        var lines = [];
        if (n) lines.push('Heard: ' + got.heard.join(' · '));
        got.ignored.forEach(function (g) {
          lines.push('Ignored ' + g.key + ' ' + g.value + ' — ' + g.why);
        });
        if (!n && !got.ignored.length) {
          lines.push('Heard “' + (text || '').slice(0, 60) + '” — no reading in ' +
                     'that. Say it like: temp 38.5, BP 120 over 80, pulse 96.');
        }
        say(out, lines.join('  ·  '), n ? 'ok' : 'warn');
      };
      _rec.start();
      btn.classList.add('on');
      say(out, 'Listening — say the readings, then tap again.');
      _stopT = setTimeout(stop, MAX_MS);
    });
  }

  var API = { parseVitals: parseVitals, digitsFromWords: digitsFromWords,
              RANGE: RANGE, attach: attach };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.HomattDictate = API;
})(typeof window !== 'undefined' ? window : globalThis);
