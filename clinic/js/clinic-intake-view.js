/* Homatt Health — reading back what the intake screen wrote
 *
 * A clinic opened an active treatment to record a follow-up and found the
 * diagnosis, the money, the return date and the medicines — and nothing at
 * all about why the patient had come. No complaint, no story, no background,
 * no readings.
 *
 * The data was never lost. `clinical_findings` was fetched and simply never
 * drawn: `renderPatientDetailBody` returned `hero + strip + meds + past`.
 *
 * THE SHAPE OF THE FAULT, which is the part worth remembering: there are TWO
 * renderers for one patient record. The history search draws it with
 * `renderHistVisitCard`, which has always shown the findings. The active
 * treatments list draws it with `renderPatientDetailBody`, which never did.
 * The same record was complete through one door and gutted through the other,
 * and the gutted one is the door a clinician uses to decide what to do next.
 *
 * That is the third time this exact shape has come up in this project — the
 * microphone, the follow-up dose table, and now the record itself — so this
 * lives in ONE module that BOTH renderers read, rather than being fixed twice.
 *
 * ── WHAT IT PARSES ───────────────────────────────────────────────────────
 *
 * `clinic-intake.js` writes a known shape:
 *
 *     Patient: Female, 46 years
 *     Chief complaint: severe headache for two days
 *     History: started yesterday, no fever, vomited twice
 *     Vitals: BP 190/110 mmHg · Temp 38.9 °C · Weight 64 kg · Pulse 104/min
 *     Background: known hypertensive, not taking her tablets
 *
 * and the wizard appends the lab results under it. The follow-up form then
 * appends `[Follow-up · <date>]` blocks over time. So the text is structured,
 * and showing it as one grey blob throws that structure away.
 *
 * ── NOTHING IS EVER LOST ─────────────────────────────────────────────────
 *
 * Every line that is not recognised goes into `other`, which the card prints.
 * A record written before the intake screen existed, or by a clinic that types
 * freehand, has no labels at all — it comes back entirely as `other` and is
 * shown in full. The parser may fail to STRUCTURE text; it may never drop it.
 * `parse(t).everyWord` is asserted against the input in the tests for exactly
 * this reason.
 */
(function (root) {
  'use strict';

  // The labels intake writes, in the order it writes them.
  var LABELS = [
    { key: 'who',        re: /^patient\s*:\s*/i },
    { key: 'chief',      re: /^(?:chief\s+)?complaint\s*:\s*/i },
    { key: 'history',    re: /^history\s*:\s*/i },
    { key: 'vitals',     re: /^vitals?\s*:\s*/i },
    { key: 'background', re: /^background\s*:\s*/i },
    // Written by the wizard when lab results were entered at the time.
    { key: 'results',    re: /^(?:lab\s+)?results?\s*:\s*/i }
  ];

  var FOLLOWUP = /^\[\s*follow-?up\b([^\]]*)\]\s*$/i;

  function parse(text) {
    var out = {
      who: '', chief: '', history: '', vitals: '', background: '', results: '',
      readings: {}, followups: [], other: [], raw: String(text == null ? '' : text)
    };
    if (!out.raw.trim()) return out;

    var lines = out.raw.split(/\r?\n/);
    var current = null;       // the label a continuation line belongs to
    var inFollowup = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { continue; }

      var fu = trimmed.match(FOLLOWUP);
      if (fu) {
        inFollowup = { when: (fu[1] || '').replace(/^[\s·-]+/, '').trim(), text: '' };
        out.followups.push(inFollowup);
        current = null;
        continue;
      }

      var matched = false;
      for (var j = 0; j < LABELS.length; j++) {
        if (LABELS[j].re.test(trimmed)) {
          var val = trimmed.replace(LABELS[j].re, '').trim();
          var k = LABELS[j].key;
          /* A second "Chief complaint:" cannot overwrite the first. The rule
           * the dictation parser follows — the chief complaint is ONE thing —
           * has to hold when reading back too, or a re-dictated record would
           * show only the later attempt. Later ones join the history. */
          if (out[k]) out.history = (out.history ? out.history + ' ' : '') + val;
          else out[k] = val;
          current = k; inFollowup = null; matched = true;
          break;
        }
      }
      if (matched) continue;

      // A continuation of whatever came before it.
      if (inFollowup) { inFollowup.text += (inFollowup.text ? '\n' : '') + trimmed; }
      else if (current) { out[current] += (out[current] ? '\n' : '') + trimmed; }
      else { out.other.push(trimmed); }
    }

    out.readings = readings(out.vitals);
    return out;
  }

  /* ── The readings, as numbers ─────────────────────────────────────────────
   *
   * So the card can colour them against the guideline bands rather than
   * printing a string. Every one requires its LABEL or an unambiguous unit —
   * the same rule the dictation parser follows, and for the same reason: a
   * bare number guessed into the wrong box is how a temperature becomes a
   * weight. Nothing here infers. */
  function readings(s) {
    var v = {};
    var t = String(s || '');
    if (!t) return v;
    var bp = t.match(/\bBP\s*(\d{2,3})\s*\/\s*(\d{2,3})/i);
    if (bp) { v.sbp = +bp[1]; v.dbp = +bp[2]; }
    var temp = t.match(/\bTemp\w*\s*([\d.]+)\s*°?\s*C\b/i) || t.match(/([\d.]+)\s*°\s*C\b/i);
    if (temp) v.temp = parseFloat(temp[1]);
    var w = t.match(/\bWeight\s*([\d.]+)\s*kg\b/i) || t.match(/([\d.]+)\s*kg\b/i);
    if (w) v.weight = parseFloat(w[1]);
    var p = t.match(/\bPulse\s*(\d{2,3})/i) || t.match(/(\d{2,3})\s*\/\s*min\b/i);
    if (p) v.pulse = +p[1];
    var sp = t.match(/\bSpO.?2?\s*(\d{2,3})\s*%?/i);
    if (sp) v.spo2 = +sp[1];
    return v;
  }

  /* The age intake recorded, in years, out of the "Patient:" line — so the
   * readings are coloured against the right table. A child's 85 systolic is
   * the middle of their range and shock in an adult. */
  function ageYears(parsed) {
    var m = String((parsed && parsed.who) || '').match(/(\d+(?:\.\d+)?)\s*(year|month|week|day)/i);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) return null;
    var unit = m[2].toLowerCase();
    if (unit === 'month') return Math.round((n / 12) * 100) / 100;
    if (unit === 'week') return Math.round((n / 52) * 100) / 100;
    if (unit === 'day') return Math.round((n / 365) * 100) / 100;
    return n;
  }

  function sex(parsed) {
    var m = String((parsed && parsed.who) || '').match(/\b(male|female)\b/i);
    return m ? m[1].toLowerCase() : '';
  }

  /* ── Did every word of the input survive into some field? ─────────────────
   *
   * The tests assert this directly, because a parser that turns prose into
   * labelled fields is only safe if it cannot silently swallow any of it. The
   * fix for "the record shows nothing" must not become "the record shows most
   * of it", which is worse — it looks complete.
   *
   * The LABELS themselves are not content. "Chief complaint:" at the start of
   * a line becomes the field's name and the card prints its own heading, so
   * counting it as lost text would make this check permanently red and
   * therefore useless. Stripping is ANCHORED to the start of a line: the same
   * words appearing inside a sentence ("History: the chief complaint was
   * fever") are content and are still required to survive.
   *
   * `opts.keepLabels` turns the stripping off. That is what the test's control
   * uses: with it on, the labels ARE reported missing, which proves this
   * comparison can see an absence at all. Without such a control, "nothing was
   * lost" is also what a check that inspects nothing returns.
   */
  function everyWord(text, opts) {
    opts = opts || {};
    var p = parse(text);
    var got = [p.who, p.chief, p.history, p.vitals, p.background, p.results]
      .concat(p.other)
      .concat(p.followups.map(function (f) { return f.when + ' ' + f.text; }))
      .join(' ');

    function words(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9.\/°%]+/g, ' ')
        .split(' ').filter(Boolean);
    }

    // The input, with the structural markers the parser consumed removed.
    var expected = String(text == null ? '' : text);
    if (!opts.keepLabels) {
      expected = expected.split(/\r?\n/).map(function (line) {
        var t = line.trim();
        var fu = t.match(FOLLOWUP);
        if (fu) return (fu[1] || '').replace(/^[\s·-]+/, '');   // keep the date
        for (var j = 0; j < LABELS.length; j++) {
          if (LABELS[j].re.test(t)) return t.replace(LABELS[j].re, '');
        }
        return t;
      }).join('\n');
    }

    var want = words(expected), have = {};
    words(got).forEach(function (w) { have[w] = (have[w] || 0) + 1; });
    var lost = [];
    for (var i = 0; i < want.length; i++) {
      if (have[want[i]]) have[want[i]]--;
      else lost.push(want[i]);
    }
    return { lost: lost, ok: lost.length === 0 };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function para(s) { return esc(s).replace(/\n/g, '<br>'); }

  /* ── The readings, as chips, coloured against the guideline band ──────────
   *
   * Coloured by `HomattVitals` where it is loaded, which reads the Uganda
   * Clinical Guidelines rather than the American table, and reads a child
   * against the book's paediatric range rather than an adult stage. Where it
   * is not loaded the chips still show, in the plain colour — a reading with
   * no colour is still the reading, and refusing to draw it because the engine
   * is missing would be the worse failure. */
  function chipsHTML(parsed) {
    var v = (parsed && parsed.readings) || {};
    var HV = root.HomattVitals;
    var age = ageYears(parsed);
    var out = [];

    function chip(tone, big, unit, title) {
      out.push('<span class="pr-vital ' + tone + '"' + (title ? ' title="' + esc(title) + '"' : '') +
        '><b>' + esc(big) + '</b><i>' + esc(unit) + '</i></span>');
    }
    function tone(t) {
      return t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : '';
    }

    if (v.sbp && v.dbp) {
      var c = HV ? HV.classify(v.sbp, v.dbp, { ageYears: age }) : null;
      chip(c ? tone(c.tone) : '', v.sbp + '/' + v.dbp, 'mmHg',
        c ? (c.label + (c.source ? ' · ' + c.source : '')) : '');
    }
    if (v.temp) {
      var t = HV ? HV.temp(v.temp) : null;
      chip(t ? tone(t.tone) : '', v.temp, '°C', t ? t.label : '');
    }
    if (v.pulse) {
      var p = HV ? HV.pulse(v.pulse, age) : null;
      chip(p ? tone(p.tone) : '', v.pulse, '/min', p ? p.label : '');
    }
    if (v.spo2) {
      var o = HV ? HV.spo2(v.spo2) : null;
      chip(o ? tone(o.tone) : '', v.spo2, '% SpO₂', o ? o.label : '');
    }
    if (v.weight) chip('', v.weight, 'kg', '');

    /* The shock index, which the two separate thresholds both miss: a
     * 22-year-old at 110/115 has neither a pulse over 120 nor a systolic
     * under 90, and is in trouble. */
    if (HV && v.pulse && v.sbp) {
      var si = HV.shockIndex(v.pulse, v.sbp);
      if (si !== null && si >= 0.9) {
        chip('bad', si, 'shock index', 'Pulse divided by systolic. 0.9 and above is a patient who is compensating.');
      }
    }
    return out.length ? '<div class="pr-vitals">' + out.join('') + '</div>' : '';
  }

  /* ── The whole "what they came with" block ────────────────────────────────
   * Built here so the two record renderers cannot draw it differently. */
  function cardHTML(record, opts) {
    opts = opts || {};
    var p = parse((record || {}).clinical_findings);
    var has = p.chief || p.history || p.background || p.vitals ||
              p.results || p.other.length || p.followups.length;
    if (!has) {
      /* Say it plainly rather than drawing an empty card. A visit recorded
       * before the intake screen existed, or saved straight from the one-tap
       * package, genuinely has nothing here — and "nothing was written down"
       * is itself worth knowing before a follow-up is decided. */
      return opts.quiet ? '' :
        '<div class="pr-came"><div class="pr-sec">What they came with</div>' +
        '<div class="pr-note">Nothing was recorded for this visit — no complaint, ' +
        'no history and no readings.</div></div>';
    }

    var bits = '<div class="pr-came"><div class="pr-sec">What they came with' +
      (p.who ? ' <b>· ' + esc(p.who) + '</b>' : '') + '</div>';

    if (p.chief) bits += '<div class="pr-came-chief">' + para(p.chief) + '</div>';
    bits += chipsHTML(p);

    function block(label, text) {
      if (!text) return '';
      return '<div class="pr-came-t">' + esc(label) + '</div>' +
             '<div class="pr-came-p">' + para(text) + '</div>';
    }
    bits += block('The story', p.history);
    bits += block('Background', p.background);
    bits += block('Results at the time', p.results);
    if (p.other.length) bits += block('Also written down', p.other.join('\n'));

    // Follow-up notes, newest last, the way they were written.
    if (p.followups.length) {
      bits += '<div class="pr-came-t">Since then</div>';
      p.followups.forEach(function (f) {
        bits += '<div class="pr-came-fu"><b>' + esc(f.when || 'Follow-up') + '</b>' +
                (f.text ? '<br>' + para(f.text) : '') + '</div>';
      });
    }
    return bits + '</div>';
  }

  root.HomattIntake = {
    parse: parse,
    readings: readings,
    ageYears: ageYears,
    sex: sex,
    everyWord: everyWord,
    chipsHTML: chipsHTML,
    cardHTML: cardHTML
  };
})(window);
