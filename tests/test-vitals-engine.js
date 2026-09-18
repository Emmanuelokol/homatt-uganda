// The vitals engine: the arithmetic, and every threshold it decides on.
//
// This one needs no browser and no server. It loads app/clinic/js/clinic-vitals.js
// into a bare global and drives the functions directly, so the whole threshold
// table can be walked in milliseconds rather than a dozen clicks. The browser
// half — that the file parses, loads and reaches the screen — is
// test-flowsheet.js's job.
//
// WHAT IS ACTUALLY BEING GUARDED HERE
//
//  1. MAP is DBP + (SBP − DBP)/3. The fraction is the part that gets mangled
//     in transit; `DBP + 31 × (SBP − DBP)` is a real thing people have typed.
//
//  2. The bands are the UGANDA guideline's, not the AHA's. 135/85 must come
//     back "Pre-hypertension", because that is what the book on the same phone
//     says one tap away, and 145/95 must be stage 1 rather than stage 2.
//     Asserted as literal expectations so that swapping in the American table
//     — which is what every example on the internet uses — fails here loudly
//     rather than quietly disagreeing with the guideline screen.
//
//  3. A CHILD IS NEVER STAGED. This is the assertion that matters most. A
//     systolic of 85 is the middle of a three-year-old's range and shock in an
//     adult; 115 is normal in an adult and above range for a ten-year-old.
//     Both directions are tested. measure-vitals.js counts them: over 555
//     paediatric readings the adult table is wrong 245 times, 205 of those by
//     calling a child who is ABOVE their range normal. It never misses a LOW
//     child — the paediatric floors all sit at or under the adult 90 — so the
//     claim tested here is the one the measurement actually supports.
//
//  4. A FALL IN BLOOD PRESSURE IS NOT ALWAYS IMPROVEMENT. 200/120 → 170/100
//     is the hydralazine working. 95/60 → 80/50 is the same arithmetic and the
//     opposite event. A flowsheet that colours both green paints a haemorrhage
//     as a cure.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — got: ' + JSON.stringify(got))); }
}
function eq(name, got, want) { ok(name, got === want, got); }

// Load the module into a bare global, exactly as a page would.
global.window = global.window || {};
const SRC = path.join(__dirname, '..', 'app', 'clinic', 'js', 'clinic-vitals.js');
new Function(fs.readFileSync(SRC, 'utf8')).call(global);
const HV = global.window.HomattVitals;

ok('the module loads and exports', !!HV && typeof HV.classify === 'function');

// ── 1. Mean arterial pressure ────────────────────────────────────────────
eq('MAP 120/80 is 93.3',      HV.map(120, 80), 93.3);
eq('MAP 140/90 is 106.7',     HV.map(140, 90), 106.7);
eq('MAP 90/60 is 70',         HV.map(90, 60), 70);
eq('MAP 200/120 is 146.7',    HV.map(200, 120), 146.7);
// The whole point of writing the formula out: the mangled version gives 1320.
ok('MAP is not the "31" mangling', HV.map(120, 80) < 200, HV.map(120, 80));
eq('MAP of nothing is null',  HV.map('', ''), null);
eq('MAP refuses a diastolic above the systolic', HV.map(80, 120), null);
eq('MAP refuses a zero',      HV.map(120, 0), null);

// ── 2. The adult bands are the book's, not the AHA's ─────────────────────
const A = (s, d) => HV.classify(s, d, { ageYears: 30 }).key;
eq('118/78 normal',                 A(118, 78), 'normal');
eq('120/78 pre-hypertension',       A(120, 78), 'pre');
eq('135/85 is PRE-hypertension (AHA would say stage 1)', A(135, 85), 'pre');
eq('139/89 still pre-hypertension', A(139, 89), 'pre');
eq('140/90 is stage 1 (AHA would say stage 2)',          A(140, 90), 'stage1');
eq('145/95 stage 1',                A(145, 95), 'stage1');
eq('159/99 stage 1',                A(159, 99), 'stage1');
eq('160/95 stage 2',                A(160, 95), 'stage2');
eq('150/100 stage 2 on the diastolic alone', A(150, 100), 'stage2');
eq('181/100 emergency',             A(181, 100), 'emergency');
eq('170/112 emergency on the diastolic alone', A(170, 112), 'emergency');
eq('180/110 is NOT yet emergency (the book says above)', A(180, 110), 'stage2');
eq('89/55 is low',                  A(89, 55), 'low');
eq('90/60 is not low',              A(90, 60), 'normal');
eq('nothing recorded is unknown',   A('', ''), 'unknown');

ok('every adult band names its source section',
  ['normal', 'pre', 'stage1', 'stage2', 'emergency', 'low'].every(function (k) {
    const found = [[118, 78], [125, 82], [145, 95], [165, 95], [190, 100], [80, 50]]
      .map(function (p) { return HV.classify(p[0], p[1], { ageYears: 30 }); })
      .filter(function (c) { return c.key === k; })[0];
    return found && /Uganda Clinical Guidelines/.test(found.source);
  }));

// ── 3. A child is never given an adult stage ─────────────────────────────
const C = (s, d, age) => HV.classify(s, d, { ageYears: age });

ok('a 3-year-old at 85/55 is IN RANGE, not shocked', C(85, 55, 3).key === 'child-ok', C(85, 55, 3).key);
ok('...and the same reading in an adult IS low',     A(85, 55) === 'low');
// The other direction, and the one a sign-blind rule gets wrong: the book
// gives a 6–12-year-old 90–110 systolic, so 115 is ABOVE their range while the
// adult table calls the identical reading normal.
ok('a 10-year-old at 115/70 is ABOVE range',         C(115, 70, 10).key === 'child-high', C(115, 70, 10).key);
ok('...and the same reading in an adult is normal',  A(115, 70) === 'normal');
ok('a 10-year-old at 85/55 is below range',          C(85, 55, 10).key === 'child-low', C(85, 55, 10).key);
ok('a 6-month-old at 75/45 is in range',             C(75, 45, 0.5).key === 'child-ok', C(75, 45, 0.5).key);
ok('a 6-month-old at 60/40 is below range',          C(60, 40, 0.5).key === 'child-low', C(60, 40, 0.5).key);
ok('a 4-year-old at 110/70 is above range',          C(110, 70, 4).key === 'child-high', C(110, 70, 4).key);

ok('NO child of any age and any pressure is ever given an adult stage',
  (function () {
    for (let age = 0; age < 13; age += 0.5) {
      for (let s = 40; s <= 220; s += 5) {
        for (let d = 20; d < s; d += 10) {
          const k = HV.classify(s, d, { ageYears: age }).key;
          if (k === 'stage1' || k === 'stage2' || k === 'pre' ||
              k === 'normal' || k === 'low' || k === 'emergency') return false;
          if (HV.classify(s, d, { ageYears: age }).adult) return false;
        }
      }
    }
    return true;
  })());

eq('13 is where the book puts the adult line', HV.ADULT_FROM, 13);
ok('a 13-year-old IS staged as an adult', HV.classify(145, 95, { ageYears: 13 }).key === 'stage1');
ok('a child card says no diastolic range exists for a child',
  /no diastolic range for a child/.test(C(85, 55, 3).note), C(85, 55, 3).note);
ok('a child card names the systolic range it used',
  /80–90 mmHg systolic/.test(C(85, 55, 3).note), C(85, 55, 3).note);

// Age not recorded: the adult table is used, and it SAYS it assumed that.
ok('with no age, the adult table is used', HV.classify(145, 95, {}).key === 'stage1');
ok('...and the result says it assumed an adult', HV.classify(145, 95, {}).assumedAdult === true);
ok('with an age, nothing is assumed', HV.classify(145, 95, { ageYears: 40 }).assumedAdult === false);

// ── 4. The delta reads direction, not sign ───────────────────────────────
const D = (cs, cd, ps, pd, age) =>
  HV.delta({ sbp: cs, dbp: cd }, { sbp: ps, dbp: pd }, { ageYears: age === undefined ? 30 : age });

eq('200/120 → 170/100 is IMPROVING', D(170, 100, 200, 120).status, 'IMPROVING');
eq('95/60 → 80/50 is WORSENING',     D(80, 50, 95, 60).status, 'WORSENING');
ok('...and both of those are a FALL in pressure',
  D(170, 100, 200, 120).sys < 0 && D(80, 50, 95, 60).sys < 0);

eq('80/50 → 95/62 is IMPROVING (a RISE, in a shocked patient)', D(95, 62, 80, 50).status, 'IMPROVING');
eq('130/84 → 134/86 is STABLE (both in range)', D(134, 86, 130, 84).status, 'STABLE');
eq('142/92 → 145/94 is STABLE (inside the noise)', D(145, 94, 142, 92).status, 'STABLE');
eq('130/85 → 150/95 is WORSENING', D(150, 95, 130, 85).status, 'WORSENING');
eq('a first reading has nothing to compare', D(130, 85, '', '').status, 'FIRST');
eq('a first reading in the emergency band is still CRITICAL', D(200, 120, '', '').status, 'CRITICAL');
eq('220/130 → 200/125 is CRITICAL even though it improved', D(200, 125, 220, 130).status, 'CRITICAL');
eq('...and the arrow still shows the medicine working', D(200, 125, 220, 130).dir, 1);

eq('the delta text uses a real minus sign', D(170, 100, 200, 120).text, '−30/−20');
eq('the delta text signs a rise',           D(150, 95, 130, 85).text, '+20/+10');
eq('the MAP delta is carried too', D(170, 100, 200, 120).map, -23.4);

// The child case, which is the one a sign-based rule gets backwards.
eq('a 3-year-old 85/55 → 70/45 is WORSENING', D(70, 45, 85, 55, 3).status, 'WORSENING');
eq('a 3-year-old 70/45 → 85/55 is IMPROVING', D(85, 55, 70, 45, 3).status, 'IMPROVING');

eq('the noise floor is 5 mmHg', HV.NOISE, 5);

// ── 5. Pulse, breathing, temperature, oxygen ─────────────────────────────
eq('an adult at 130 has a fast pulse', HV.pulse(130, 30).key, 'high');
eq('an adult at 45 has a slow pulse',  HV.pulse(45, 30).key, 'low');
eq('an infant at 140 is IN RANGE',     HV.pulse(140, 0.5).key, 'ok');
ok('...where an adult at 140 is not',  HV.pulse(140, 30).key === 'high');
eq('a 10-year-old at 130 is fast',     HV.pulse(130, 10).key, 'high');
eq('a 10-year-old at 70 is slow',      HV.pulse(70, 10).key, 'low');

eq('an adult breathing 30 is fast',    HV.resp(30, 30).key, 'high');
eq('an infant breathing 35 is normal', HV.resp(35, 0.5).key, 'ok');

eq('40.2 is hyperpyrexia', HV.temp(40.2).key, 'hyperpyrexia');
eq('38.5 is fever',        HV.temp(38.5).key, 'fever');
eq('35.0 is low',          HV.temp(35.0).key, 'low');
eq('36.8 is normal',       HV.temp(36.8).key, 'ok');

eq('SpO2 88 is hypoxaemia',  HV.spo2(88).key, 'low');
eq('SpO2 92 is the look band', HV.spo2(92).key, 'mid');
eq('SpO2 97 is normal',      HV.spo2(97).key, 'ok');
ok('hypoxaemia cites UCG 1.4', /1\.4/.test(HV.spo2(88).source), HV.spo2(88).source);

// ── 6. Shock index ───────────────────────────────────────────────────────
eq('110/115 gives a shock index of 0.96', HV.shockIndex(110, 115), 0.96);
ok('...which the two separate thresholds both miss',
  HV.pulse(110, 30).key === 'ok' && HV.classify(115, 75, { ageYears: 30 }).key === 'normal');
eq('80 over 120 is 0.67', HV.shockIndex(80, 120), 0.67);
eq('a missing pulse gives null', HV.shockIndex('', 120), null);

// ── 7. The interval countdown ────────────────────────────────────────────
const T0 = 1758000000000;   // a fixed instant; nothing here reads the clock
let d1 = HV.due(T0, 15, T0 + 5 * 60000);
eq('ten minutes still to run', d1.text, 'next check in 10:00');
ok('...and it is not overdue', d1.overdue === false);
let d2 = HV.due(T0, 15, T0 + 20 * 60000);
ok('past the interval it is overdue', d2.overdue === true);
ok('...and says by how much', /overdue by 05:00/.test(d2.text), d2.text);
eq('no interval means no countdown', HV.due(T0, 0, T0), null);
ok('with no reading yet, one is due now', HV.due('', 15, T0).overdue === true);
eq('the clock reads hours when it is hours', HV.clock(2 * 3600 * 1000 + 5 * 60000), '2h 5m');

// ── 8. Which way to read the sheet ───────────────────────────────────────
const MIN = 60000, DAY = 24 * 3600 * 1000;
eq('two readings 15 minutes apart is a ward', HV.suggestMode([T0, T0 - 15 * MIN]), 'acute');
eq('two readings a day apart is a clinic',    HV.suggestMode([T0, T0 - DAY]), 'chronic');
eq('one reading defaults to the ward view',   HV.suggestMode([T0]), 'acute');
eq('no readings at all does not throw',       HV.suggestMode([]), 'acute');

// ── 9. It never throws on rubbish ────────────────────────────────────────
ok('rubbish in gives a value out, not an exception', (function () {
  const junk = [undefined, null, '', 'abc', NaN, -1, 0, 1e9, '12/80', {}, []];
  for (const a of junk) for (const b of junk) {
    try {
      HV.classify(a, b, { ageYears: a });
      HV.map(a, b);
      HV.delta({ sbp: a, dbp: b }, { sbp: b, dbp: a }, { ageYears: a });
      HV.pulse(a, b); HV.resp(a, b); HV.temp(a); HV.spo2(a);
      HV.shockIndex(a, b); HV.due(a, b, T0);
    } catch (e) { console.log('    threw on ' + JSON.stringify([a, b]) + ': ' + e.message); return false; }
  }
  return true;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
