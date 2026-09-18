// How far apart the two blood-pressure tables actually are.
//
// Not a test — it prints numbers. Re-run it if the bands change and put the
// number in the commit message.
//
// The question it answers: does it MATTER which classification the flowsheet
// uses? Every example on the internet uses the American Heart Association's
// 2017 table. The app ships the Uganda Clinical Guidelines and a clinician can
// open the same book on the same phone. If the two tables agreed on almost
// everything, using the familiar one would be a reasonable convenience. If
// they disagree on a large share of real readings, then using the AHA's would
// put a label on one screen that the book on the next screen contradicts.
//
// So: walk every plausible adult reading and count.
const path = require('path');
const fs = require('fs');

global.window = global.window || {};
new Function(fs.readFileSync(
  path.join(__dirname, '..', 'app', 'clinic', 'js', 'clinic-vitals.js'), 'utf8')).call(global);
const HV = global.window.HomattVitals;

// The AHA 2017 categories, for comparison only. NOT used by the app.
function aha(s, d) {
  if (s > 180 || d > 120) return 'crisis';
  if (s >= 140 || d >= 90) return 'stage2';
  if (s >= 130 || d >= 80) return 'stage1';
  if (s >= 120) return 'elevated';
  return 'normal';
}
// The UCG bands, named so the two can be lined up. The app's own classifier is
// what produces these — this function only renames them.
function ucg(s, d) {
  const k = HV.classify(s, d, { ageYears: 40 }).key;
  return k;
}

// Does the pair disagree about what to DO? That is the only comparison worth
// making — "pre-hypertension" and "elevated" are different words for the same
// advice, while "stage 1 hypertension" starts a medicine.
const TREAT = {
  aha:  { normal: 0, elevated: 0, stage1: 1, stage2: 2, crisis: 3 },
  ucg:  { normal: 0, pre: 0, stage1: 1, stage2: 2, emergency: 3, low: -1, unknown: 0 }
};

let total = 0, sameWord = 0, sameAction = 0;
const drift = {};

for (let s = 90; s <= 200; s++) {
  for (let d = 50; d <= 130; d++) {
    if (d >= s) continue;
    total++;
    const a = aha(s, d), u = ucg(s, d);
    const aAct = TREAT.aha[a], uAct = TREAT.ucg[u];
    if (a === u) sameWord++;
    if (aAct === uAct) sameAction++;
    else {
      const key = a + ' → ' + u;
      drift[key] = (drift[key] || 0) + 1;
    }
  }
}

console.log('Adult readings walked (systolic 90–200, diastolic 50–130, d < s): ' + total);
console.log('');
console.log('  identical label   : ' + sameWord + '  (' + (100 * sameWord / total).toFixed(1) + '%)');
console.log('  same ACTION       : ' + sameAction + '  (' + (100 * sameAction / total).toFixed(1) + '%)');
console.log('  DIFFERENT action  : ' + (total - sameAction) + '  (' +
            (100 * (total - sameAction) / total).toFixed(1) + '%)');
console.log('');
console.log('Where they part company (AHA label → this app\'s UCG label):');
Object.keys(drift).sort((a, b) => drift[b] - drift[a]).forEach((k) => {
  console.log('  ' + k.padEnd(26) + drift[k]);
});

console.log('');
console.log('Readings a clinician sees every day:');
[[135, 85], [145, 92], [132, 78], [150, 96], [165, 104], [185, 112], [128, 82]]
  .forEach(([s, d]) => {
    console.log('  ' + (s + '/' + d).padEnd(9) +
      'AHA: ' + aha(s, d).padEnd(10) +
      'book: ' + HV.classify(s, d, { ageYears: 40 }).label);
  });

// ── And the paediatric half, which is not a disagreement but an absence ──
// The AHA table has no paediatric row at all: applying it to a child means
// applying the adult numbers. Count how many child readings that mislabels.
console.log('');
let childTotal = 0, childWrong = 0, wouldMissShock = 0, wouldMissHigh = 0;
for (const age of [0.5, 2, 4, 8, 11]) {
  for (let s = 50; s <= 160; s++) {
    childTotal++;
    const real = HV.classify(s, Math.round(s * 0.62), { ageYears: age }).key;
    const adult = HV.classify(s, Math.round(s * 0.62), { ageYears: 40 }).key;
    const realBad = (real === 'child-low' || real === 'child-high');
    const adultBad = (adult === 'low' || adult === 'stage1' ||
                      adult === 'stage2' || adult === 'emergency');
    if (realBad !== adultBad) {
      childWrong++;
      if (real === 'child-low' && !adultBad) wouldMissShock++;
      if (real === 'child-high' && !adultBad) wouldMissHigh++;
    }
  }
}
console.log('Child readings walked (ages 0.5, 2, 4, 8, 11): ' + childTotal);
console.log('  the adult table would have called it wrong : ' + childWrong +
            '  (' + (100 * childWrong / childTotal).toFixed(1) + '%)');
console.log('  ...of which the adult table calls a child BELOW their range fine : ' + wouldMissShock);
console.log('  ...and calls a child ABOVE their range fine                      : ' + wouldMissHigh);
