/* Homatt Health — the vitals engine
 *
 * The arithmetic and the judgement behind the flowsheet: mean arterial
 * pressure, the change since the last reading, and what band a reading falls
 * in. Nothing here touches the screen or the network, so it can be measured
 * directly (tests/test-vitals-engine.js, tests/measure-vitals.js).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHERE THE THRESHOLDS COME FROM, WHICH IS THE WHOLE POINT
 *
 * They come from the Uganda Clinical Guidelines 2023 — the book this app
 * already ships, in app/clinic/data/uganda_clinical_guidelines_2023.db, and
 * the book a Ugandan clinician is actually held to.
 *
 * This matters because the obvious alternative is the AHA's table, which is
 * what every American example uses, and the two DISAGREE in the range where
 * most patients sit:
 *
 *      reading        AHA                        UCG 4.1.6
 *      135/85         Hypertension, stage 1      Pre-hypertension
 *      145/95         Hypertension, stage 2      Hypertension, stage 1
 *      185/115        Crisis (>180/120: no)      Emergency/urgency (>180/110)
 *
 * Under the AHA table this app would print "Stage 1 hypertension" on a phone
 * whose own guideline screen, one tap away, calls the same reading
 * pre-hypertension and says to try lifestyle measures for three months before
 * any medicine. Two answers to one question, in one app, and the clinician
 * would have no way to know which one the app meant. So: the book wins, and
 * every band below names the section it came from.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A CHILD IS NEVER GIVEN AN ADULT STAGE
 *
 * A systolic of 85 is shock in an adult and the middle of the normal range in
 * a three-year-old. Measured across 555 paediatric readings
 * (tests/measure-vitals.js), the adult table gets 245 of them — 44% — wrong:
 *
 *   205  a child ABOVE the range for their age, called normal. A ten-year-old
 *        at 115 is over the book's 90–110 and clears the adult "<120" line.
 *    40  a child inside their range, called hypotensive. An infant at 80 is
 *        mid-range for under-1s and under the adult "<90" line.
 *     0  a child BELOW their range, called normal.
 *
 * That last row is worth stating rather than assuming: the paediatric low
 * thresholds (70, 80, 90) all sit at or under the adult 90, so the adult table
 * cannot miss a low child — it over-warns instead. The harm is entirely in the
 * other two rows, and the 205 is the one that matters, because a rising blood
 * pressure in a child is the sign that gets ignored.
 *
 * So under 13 the book's own paediatric table is used instead (UCG 1.1.2.1,
 * "Normal ranges for vital signs in children"), and the result is "in range /
 * below / above" for that age — never "stage 1", which is not a thing a child
 * has.
 *
 * That table gives SYSTOLIC only. So a child's diastolic is reported and not
 * judged, and the card says so. Inventing a paediatric diastolic threshold to
 * make the display symmetrical would be the exact class of mistake this file
 * exists to avoid.
 *
 * When the age is not recorded, the adult table is used and the result carries
 * `assumedAdult: true` so the screen can say so out loud.
 */
(function () {
  'use strict';

  /* The book's paediatric table stops at ">12", and everything above it is
   * given adult figures. 13 is therefore the line, and it is the book's line
   * rather than one chosen here. */
  var ADULT_FROM = 13;

  // ── UCG 1.1.2.1 · "Normal ranges for vital signs in children" ────────────
  // Age (Years) | Pulse | Systolic BP | Respiration
  //   <1        | 120-160 |  70-90     | 30-40
  //   1-5       | 100-120 |  80-90     | 25-30
  //   6-12      |  80-100 |  90-110    | 20-25
  //   >12       |  60-100 | 100-120    | 15-20   ← adults, handled below
  var CHILD_BANDS = [
    { under: 1,  label: 'under 1 year', sbp: [70, 90],  pulse: [120, 160], resp: [30, 40] },
    { under: 6,  label: '1–5 years',    sbp: [80, 90],  pulse: [100, 120], resp: [25, 30] },
    { under: 13, label: '6–12 years',   sbp: [90, 110], pulse: [80, 100],  resp: [20, 25] }
  ];

  var SRC_BP     = 'Uganda Clinical Guidelines 4.1.6';
  var SRC_EMERG  = 'Uganda Clinical Guidelines 4.1.6.1';
  var SRC_CHILD  = 'Uganda Clinical Guidelines 1.1.2.1';
  var SRC_SHOCK  = 'Uganda Clinical Guidelines 1.1.2';
  var SRC_O2     = 'Uganda Clinical Guidelines 1.4';

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function bandFor(ageYears) {
    var a = num(ageYears);
    if (a === null || a < 0) return null;            // not recorded
    if (a >= ADULT_FROM) return null;                // adult
    for (var i = 0; i < CHILD_BANDS.length; i++) {
      if (a < CHILD_BANDS[i].under) return CHILD_BANDS[i];
    }
    return null;
  }

  /* ── Mean arterial pressure ───────────────────────────────────────────────
   *
   *      MAP = DBP + (SBP − DBP) / 3
   *
   * Written out because the formula is very easy to mangle: the "⅓" turns into
   * "31" the moment it passes through anything that flattens a fraction, and
   * `DBP + 31 * (SBP − DBP)` for 120/80 gives 1320 instead of 93.3 — a number
   * so large it would be obvious, which is the only reason it is not
   * dangerous. Rounded to one decimal, because that is how it is read aloud. */
  function map(sbp, dbp) {
    var s = num(sbp), d = num(dbp);
    if (s === null || d === null) return null;
    if (s <= 0 || d <= 0 || d > s) return null;      // a diastolic above the
    return Math.round((d + (s - d) / 3) * 10) / 10;  // systolic is a typo
  }

  /* ── What band a blood pressure is in ─────────────────────────────────────
   *
   * `severity` is 0 (normal) … 4 (emergency), and it is what the delta below
   * compares. It is deliberately NOT the same as "the number went up": see
   * `delta()`. */
  function classify(sbp, dbp, opts) {
    opts = opts || {};
    var s = num(sbp), d = num(dbp);
    var band = bandFor(opts.ageYears);
    var assumedAdult = (num(opts.ageYears) === null);

    if (s === null || d === null || s <= 0 || d <= 0) {
      return {
        key: 'unknown', label: 'Not recorded', tone: 'grey', severity: 0,
        adult: !band, ageBand: band ? band.label : null, source: '',
        assumedAdult: false, note: ''
      };
    }

    // ── A child: the book's own range for the age, systolic only ───────────
    if (band) {
      var lo = band.sbp[0], hi = band.sbp[1];
      var key, label, tone, sev;
      if (s < lo)      { key = 'child-low';  tone = 'bad';  sev = 3;
                         label = 'Below the range for ' + band.label; }
      else if (s > hi) { key = 'child-high'; tone = 'warn'; sev = 2;
                         label = 'Above the range for ' + band.label; }
      else             { key = 'child-ok';   tone = 'ok';   sev = 0;
                         label = 'In the range for ' + band.label; }
      return {
        key: key, label: label, tone: tone, severity: sev,
        adult: false, ageBand: band.label, range: [lo, hi],
        source: SRC_CHILD, assumedAdult: false,
        note: 'The book gives ' + lo + '–' + hi + ' mmHg systolic for ' +
              band.label + '. It gives no diastolic range for a child, so ' +
              d + ' is recorded and not judged. A child is not staged.'
      };
    }

    // ── An adult: UCG 4.1.6, and the emergency line from 4.1.6.1 ───────────
    if (s > 180 || d > 110) {
      return {
        key: 'emergency', label: 'Hypertensive emergency or urgency',
        tone: 'bad', severity: 4, adult: true, ageBand: null,
        source: SRC_EMERG, assumedAdult: assumedAdult,
        note: 'Above 180/110. The book separates the two by whether there is ' +
              'organ damage — headache with confusion or fits, chest pain, ' +
              'breathlessness, no urine, visual change. Either way it is an ' +
              'admission (HC4), and the pressure is brought down over hours, ' +
              'not minutes.'
      };
    }
    /* Low pressure is not in the 4.1.6 table at all — that table starts at
     * "Normal <120". Under 90 systolic is taken from the shock section, and
     * it is kept because a flowsheet that can only say "normal or high" is
     * blind in exactly the direction that kills fastest. */
    if (s < 90) {
      return {
        key: 'low', label: 'Low blood pressure', tone: 'bad', severity: 3,
        adult: true, ageBand: null, source: SRC_SHOCK,
        assumedAdult: assumedAdult,
        note: 'Under 90 systolic. Look for shock — fast thin pulse, cold ' +
              'hands, slow capillary refill, confusion.'
      };
    }
    if (s >= 160 || d >= 100) {
      return {
        key: 'stage2', label: 'Hypertension, stage 2', tone: 'bad',
        severity: 3, adult: true, ageBand: null, source: SRC_BP,
        assumedAdult: assumedAdult, note: ''
      };
    }
    if (s >= 140 || d >= 90) {
      return {
        key: 'stage1', label: 'Hypertension, stage 1', tone: 'warn',
        severity: 2, adult: true, ageBand: null, source: SRC_BP,
        assumedAdult: assumedAdult, note: ''
      };
    }
    if (s >= 120 || d >= 80) {
      return {
        key: 'pre', label: 'Pre-hypertension', tone: 'warn', severity: 1,
        adult: true, ageBand: null, source: SRC_BP,
        assumedAdult: assumedAdult, note: ''
      };
    }
    return {
      key: 'normal', label: 'Normal', tone: 'ok', severity: 0,
      adult: true, ageBand: null, source: SRC_BP,
      assumedAdult: assumedAdult, note: ''
    };
  }

  /* ── The window a reading is being steered toward ─────────────────────────
   * For an adult this is the book's own management target — "blood pressure
   * below 140/90" — with the bottom taken from the shock section. For a child
   * it is the paediatric range, systolic only. */
  function window_(ageYears) {
    var band = bandFor(ageYears);
    if (band) return { sbp: [band.sbp[0], band.sbp[1]], dbp: null };
    return { sbp: [90, 139], dbp: [60, 89] };
  }

  function outsideBy(v, lohi) {
    if (v === null || !lohi) return 0;
    if (v < lohi[0]) return lohi[0] - v;
    if (v > lohi[1]) return v - lohi[1];
    return 0;
  }

  /* ── How far this reading is from where it should be ──────────────────── */
  function distance(sbp, dbp, ageYears) {
    var w = window_(ageYears);
    return outsideBy(num(sbp), w.sbp) + outsideBy(num(dbp), w.dbp);
  }

  /* ── The change since the last reading ────────────────────────────────────
   *
   * THE SIGN OF THE CHANGE IS NOT THE ANSWER, and this is the one piece of
   * judgement in this file.
   *
   * "BP fell by 20" is a green arrow in a patient at 200/120 who has just had
   * hydralazine, and it is the beginning of the end in a patient at 95/60 who
   * is bleeding. A flowsheet that colours every fall green would paint a
   * haemorrhage in the same colour as a cure.
   *
   * So the reading is judged by whether it moved TOWARD the window it belongs
   * in, not by whether the number went down. Both directions are read the same
   * way, and the answer is the same shape for a shocked patient and a
   * hypertensive one.
   *
   * TOLERANCE. Anything under 5 mmHg of movement is called stable. A cuff
   * read by ear is graduated in 2 mmHg and is routinely a few off between two
   * honest readings of the same arm; labelling that noise "worsening" every
   * few minutes is how a flowsheet trains the person reading it to ignore it.
   */
  var NOISE = 5;

  function delta(cur, prev, opts) {
    opts = opts || {};
    var cs = num((cur || {}).sbp), cd = num((cur || {}).dbp);
    if (cs === null || cd === null) return null;

    var out = {
      sys: null, dia: null, map: null,
      status: 'FIRST', dir: 0, text: '', first: true
    };

    var cls = classify(cs, cd, opts);
    var ps = num((prev || {}).sbp), pd = num((prev || {}).dbp);
    if (ps === null || pd === null) {
      // Nothing to compare with. A single reading in a crisis band is still
      // critical — there is no "wait for a second one" here.
      out.status = (cls.severity >= 4) ? 'CRITICAL' : 'FIRST';
      return out;
    }

    out.first = false;
    out.sys = cs - ps;
    out.dia = cd - pd;
    var cm = map(cs, cd), pm = map(ps, pd);
    out.map = (cm !== null && pm !== null) ? Math.round((cm - pm) * 10) / 10 : null;
    out.text = sign(out.sys) + '/' + sign(out.dia);

    var dNow = distance(cs, cd, opts.ageYears);
    var dWas = distance(ps, pd, opts.ageYears);
    var moved = dWas - dNow;                   // positive = toward the window

    if (moved > NOISE)       { out.status = 'IMPROVING'; out.dir = 1; }
    else if (moved < -NOISE) { out.status = 'WORSENING'; out.dir = -1; }
    else                     { out.status = 'STABLE';    out.dir = 0; }

    /* A reading in the emergency band is CRITICAL whichever way it moved.
     * 220/130 down to 200/125 is improvement and is still an emergency, and
     * the word on the card has to be the one that gets somebody out of their
     * chair. The direction is kept in `dir` so the arrow can still say the
     * medicine is working. */
    if (cls.severity >= 4) out.status = 'CRITICAL';

    return out;
  }

  function sign(n) {
    if (n === null) return '';
    if (n > 0) return '+' + n;
    if (n < 0) return '−' + Math.abs(n);   // a real minus sign, not a hyphen
    return '0';
  }

  // ── The other readings, each from the book ──────────────────────────────

  function pulse(p, ageYears) {
    var v = num(p);
    if (v === null || v <= 0) return { key: 'unknown', label: '', tone: 'grey', source: '' };
    var band = bandFor(ageYears);
    if (band) {
      if (v < band.pulse[0]) return { key: 'low',  label: 'Slow for ' + band.label, tone: 'bad',  source: SRC_CHILD };
      if (v > band.pulse[1]) return { key: 'high', label: 'Fast for ' + band.label, tone: 'warn', source: SRC_CHILD };
      return { key: 'ok', label: 'In range for ' + band.label, tone: 'ok', source: SRC_CHILD };
    }
    if (v >= 120) return { key: 'high', label: 'Fast pulse', tone: 'warn', source: SRC_SHOCK };
    if (v < 50)   return { key: 'low',  label: 'Slow pulse', tone: 'bad',  source: SRC_SHOCK };
    return { key: 'ok', label: 'Normal', tone: 'ok', source: SRC_CHILD };
  }

  function resp(r, ageYears) {
    var v = num(r);
    if (v === null || v <= 0) return { key: 'unknown', label: '', tone: 'grey', source: '' };
    var band = bandFor(ageYears);
    var lo = band ? band.resp[0] : 15, hi = band ? band.resp[1] : 20;
    var who = band ? band.label : 'an adult';
    if (v > hi) return { key: 'high', label: 'Fast breathing for ' + who, tone: 'warn', source: SRC_CHILD };
    if (v < lo) return { key: 'low',  label: 'Slow breathing for ' + who, tone: 'bad',  source: SRC_CHILD };
    return { key: 'ok', label: 'In range for ' + who, tone: 'ok', source: SRC_CHILD };
  }

  function temp(t) {
    var v = num(t);
    if (v === null || v <= 0) return { key: 'unknown', label: '', tone: 'grey', source: '' };
    if (v >= 40)   return { key: 'hyperpyrexia', label: 'Very high fever', tone: 'bad',  source: '' };
    if (v >= 38)   return { key: 'fever',        label: 'Fever',           tone: 'warn', source: '' };
    if (v < 35.5)  return { key: 'low',          label: 'Low temperature', tone: 'bad',  source: '' };
    return { key: 'ok', label: 'Normal', tone: 'ok', source: '' };
  }

  /* Hypoxaemia is defined in UCG 1.4 as SpO2 under 90%. The 90–93 band is a
   * prompt to look, not a threshold from the book — several sections give
   * oxygen at under 94%, and COPD is deliberately kept at 88–92%, so the card
   * says "look" rather than naming a number to act on. */
  function spo2(v_) {
    var v = num(v_);
    if (v === null || v <= 0) return { key: 'unknown', label: '', tone: 'grey', source: '' };
    if (v < 90)  return { key: 'low',  label: 'Hypoxaemia', tone: 'bad',  source: SRC_O2 };
    if (v < 94)  return { key: 'mid',  label: 'Low — look at the patient', tone: 'warn', source: '' };
    return { key: 'ok', label: 'Normal', tone: 'ok', source: '' };
  }

  /* ── Shock index ─────────────────────────────────────────────────────────
   * Pulse ÷ systolic. 0.9 and above is the compensating patient the two
   * separate thresholds both miss: a 22-year-old at 110/115 has neither a
   * pulse over 120 nor a systolic under 90, and is in trouble. Already used by
   * the suggestion engine's rigidity guard; the same number, in one place. */
  function shockIndex(p, s) {
    var pv = num(p), sv = num(s);
    if (pv === null || sv === null || sv <= 0 || pv <= 0) return null;
    return Math.round((pv / sv) * 100) / 100;
  }

  // ── The interval countdown ───────────────────────────────────────────────
  //
  // "Monitor every 15 minutes" is an order, and the flowsheet's job is to say
  // when the next one is owed. Everything is computed from the last reading's
  // own timestamp rather than from when a timer was started, so closing the
  // screen, losing the signal or the phone sleeping in a pocket cannot make it
  // drift — there is no clock to keep running.
  function due(lastAtMs, intervalMin, nowMs) {
    var iv = num(intervalMin);
    if (!iv || iv <= 0) return null;
    var last = num(lastAtMs);
    var now = num(nowMs);
    if (now === null) now = new Date().getTime();
    if (last === null) {
      return { dueAt: now, remainingMs: 0, overdue: true, text: 'due now', everMs: 0 };
    }
    var dueAt = last + iv * 60000;
    var rem = dueAt - now;
    return {
      dueAt: dueAt,
      remainingMs: rem,
      overdue: rem <= 0,
      text: rem <= 0 ? ('overdue by ' + clock(-rem)) : ('next check in ' + clock(rem)),
      everMs: iv * 60000
    };
  }

  function clock(ms) {
    var total = Math.max(0, Math.round(num(ms) / 1000));
    var m = Math.floor(total / 60), s = total % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm';
    }
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ── Is this an acute stretch or a chronic one? ───────────────────────────
   * One flowsheet, two ways of reading it, and the readings themselves decide
   * which — not a switch somebody has to remember to flip. More than one
   * reading inside six hours is a ward observation; a reading a day is
   * somebody's blood pressure being followed. The clinician can still override
   * it, because a rule about time cannot know what is happening in the room. */
  function suggestMode(stamps) {
    if (!stamps || stamps.length < 2) return 'acute';
    var sorted = stamps.slice().sort(function (a, b) { return b - a; });
    var span = sorted[0] - sorted[1];
    return (span <= 6 * 3600 * 1000) ? 'acute' : 'chronic';
  }

  window.HomattVitals = {
    map: map,
    classify: classify,
    delta: delta,
    distance: distance,
    window: window_,
    pulse: pulse,
    resp: resp,
    temp: temp,
    spo2: spo2,
    shockIndex: shockIndex,
    due: due,
    clock: clock,
    suggestMode: suggestMode,
    ADULT_FROM: ADULT_FROM,
    CHILD_BANDS: CHILD_BANDS,
    NOISE: NOISE
  };
})();
