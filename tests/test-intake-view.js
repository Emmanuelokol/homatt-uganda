// Reading back what the intake screen wrote.
//
// A clinic opened an active treatment to record a follow-up and found the
// diagnosis, the money, the return date and the medicines — and nothing at all
// about why the patient had come. The data was never lost: `clinical_findings`
// was fetched on every one of those rows and simply never drawn.
//
// The same record, opened through the HISTORY SEARCH instead, has always shown
// it. Two renderers for one record, and the one that dropped everything is the
// one a clinician uses to decide what to do next. So the parsing lives in one
// module that both renderers read, and this drives that module directly.
//
// THE ASSERTION THAT MATTERS MOST is not that it parses the tidy case. It is
// that it cannot silently swallow anything. A parser that turns prose into
// labelled fields is only safe if every word of the input ends up in some
// field — otherwise the fix for "the record shows nothing" becomes "the record
// shows most of it", which is worse, because it looks complete.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + JSON.stringify(got))); }
}
function eq(name, got, want) { ok(name, got === want, got); }

global.window = global.window || {};
new Function(fs.readFileSync(
  path.join(__dirname, '..', 'app', 'clinic', 'js', 'clinic-intake-view.js'), 'utf8')).call(global);
const HI = global.window.HomattIntake;

ok('the module loads', !!HI && typeof HI.parse === 'function');

// ── 1. The shape the intake screen actually writes ───────────────────────
const REAL =
  'Patient: Female, 34 years\n' +
  'Chief complaint: fever and headache for three days\n' +
  'History: started Friday, worse at night, vomited twice, no diarrhoea\n' +
  'Vitals: BP 142/92 mmHg · Temp 38.9 °C · Weight 58 kg · Pulse 104/min\n' +
  'Background: no known illness, not on any medicine';
const p = HI.parse(REAL);

eq('the patient line is read',      p.who, 'Female, 34 years');
eq('the complaint is read',         p.chief, 'fever and headache for three days');
ok('the story is read',             /vomited twice/.test(p.history), p.history);
ok('the background is read',        /not on any medicine/.test(p.background), p.background);
eq('the systolic',  p.readings.sbp, 142);
eq('the diastolic', p.readings.dbp, 92);
eq('the temperature', p.readings.temp, 38.9);
eq('the weight',    p.readings.weight, 58);
eq('the pulse',     p.readings.pulse, 104);
eq('the age, in years', HI.ageYears(p), 34);
eq('the sex',       HI.sex(p), 'female');

// ── 2. A NUMBER IS ONLY TAKEN WHEN IT WAS LABELLED ───────────────────────
// The rule the dictation parser follows, and for the same reason: a bare
// number guessed into the wrong box is how a temperature becomes a weight.
const bare = HI.readings('38.9 142 104 58');
eq('a bare number fills nothing', Object.keys(bare).length, 0);
eq('an unlabelled temperature is not a weight', HI.readings('38.9').temp, undefined);
eq('but a unit alone is enough for a temperature', HI.readings('38.9 °C').temp, 38.9);
eq('and for a weight', HI.readings('58 kg').weight, 58);
eq('a blood pressure needs its label', HI.readings('142/92').sbp, undefined);
eq('...and has it', HI.readings('BP 142/92').sbp, 142);

// ── 3. Months, weeks and days, because a child's age decides the table ───
eq('8 months',  HI.ageYears({ who: 'Male, 8 months' }), 0.67);
eq('3 weeks',   HI.ageYears({ who: 'Female, 3 weeks' }), 0.06);
eq('10 days',   HI.ageYears({ who: 'Male, 10 days' }), 0.03);
eq('no age at all is null, not a guess', HI.ageYears({ who: 'Female' }), null);
eq('and no patient line at all is null', HI.ageYears({}), null);

// ── 4. NOTHING IS EVER LOST ──────────────────────────────────────────────
//
// Every realistic thing a clinic's clinical_findings can hold. Each must come
// back with every word accounted for in some field.
const CORPUS = [
  REAL,
  // a record from before the intake screen existed — no labels at all
  'Pt c/o cough x 3/7, no fever. Chest clear. Rx amox.',
  // dictated, then a follow-up appended by the dashboard
  REAL + '\n\n[Follow-up · 14 Sept 2026]\nFever settled, BP rechecked 128/84, refilled meds.',
  // two follow-ups
  REAL + '\n\n[Follow-up · 14 Sept]\nBetter.\n\n[Follow-up · 21 Sept]\nDischarged.',
  // lab results appended by the wizard under the summary
  REAL + '\nResults: RDT positive for P. falciparum',
  // a second dictation adding a complaint
  REAL + '\nChief complaint: also joint pain',
  // vitals only
  'Vitals: BP 190/110 mmHg · Pulse 104/min',
  // ragged whitespace and a wrapped line
  'Chief complaint: severe\n   abdominal pain\n\nBackground:  known ulcers  ',
  // nothing
  '',
  // a single word
  'malaria',
];
let lostAny = [];
CORPUS.forEach(function (t, i) {
  const r = HI.everyWord(t);
  if (!r.ok) lostAny.push('#' + i + ' lost: ' + r.lost.join(' '));
});
ok('every word of every realistic record survives the parse',
  lostAny.length === 0, lostAny);

/* THE CONTROL. "Nothing was lost" is also what a check that inspects nothing
 * returns, so the same comparison is run with the label-stripping switched
 * off. The parser genuinely does consume those label words — they become the
 * field names — so with keepLabels on, every one of them MUST be reported
 * missing. If it is not, this check is measuring nothing and the row above it
 * is worthless. */
const control = HI.everyWord(REAL, { keepLabels: true });
ok('CONTROL: with the labels counted as content, they ARE reported missing',
  control.ok === false && control.lost.indexOf('complaint') >= 0,
  control.lost);
ok('...and the ordinary call, which does not count them, is clean',
  HI.everyWord(REAL).ok === true, HI.everyWord(REAL).lost);

/* And the stripping must be ANCHORED, not a blanket word filter. The words
 * "chief complaint" inside a sentence are content and must still be required
 * to survive — otherwise the stripper would hide a real loss of exactly the
 * words this feature is about. */
const midSentence = HI.everyWord('History: the chief complaint was fever');
ok('a label appearing mid-sentence is content, and still has to survive',
  midSentence.ok === true, midSentence.lost);
ok('...and it really is in the parsed output',
  /chief complaint was fever/.test(HI.parse('History: the chief complaint was fever').history));

// ── 5. A record with no labels comes back whole, not empty ───────────────
const freeform = HI.parse('Pt c/o cough x 3/7, no fever. Chest clear.');
eq('freehand text is not mistaken for a complaint', freeform.chief, '');
ok('...it is kept in full, so the card can print it',
  freeform.other.join(' ').indexOf('Chest clear') >= 0, freeform.other);

// ── 6. The chief complaint is ONE thing ──────────────────────────────────
const twice = HI.parse(REAL + '\nChief complaint: also joint pain');
eq('a second complaint does not overwrite the first',
  twice.chief, 'fever and headache for three days');
ok('...it joins the history, where the clinician reads it',
  /also joint pain/.test(twice.history), twice.history);

// ── 7. Follow-ups are kept apart from the original visit ─────────────────
const withFU = HI.parse(REAL + '\n\n[Follow-up · 14 Sept 2026]\nFever settled, BP rechecked 128/84.');
eq('the follow-up is its own entry', withFU.followups.length, 1);
ok('...dated', /14 Sept 2026/.test(withFU.followups[0].when), withFU.followups[0].when);
ok('...with its note', /Fever settled/.test(withFU.followups[0].text), withFU.followups[0].text);
eq('and the ORIGINAL readings are not replaced by the follow-up’s',
  withFU.readings.sbp, 142);

// ── 8. The card ──────────────────────────────────────────────────────────
const card = HI.cardHTML({ clinical_findings: REAL });
ok('the card names the section', /WHAT THEY CAME WITH|What they came with/i.test(card));
ok('the card carries the complaint', /fever and headache/.test(card));
ok('the card carries the story', /vomited twice/.test(card));
ok('the card carries the background', /not on any medicine/.test(card));
ok('the readings are chips, not a sentence', (card.match(/pr-vital/g) || []).length >= 4,
  (card.match(/pr-vital/g) || []).length);

const empty = HI.cardHTML({ clinical_findings: '' });
ok('an empty record says so rather than drawing an empty card',
  /Nothing was recorded/.test(empty), empty.slice(0, 80));
eq('...and says nothing at all where the card is one of a list',
  HI.cardHTML({ clinical_findings: '' }, { quiet: true }), '');

// HTML in the record must not become HTML on the page.
const nasty = HI.cardHTML({ clinical_findings: 'Chief complaint: <img src=x onerror=alert(1)>' });
ok('anything that looks like markup is escaped',
  nasty.indexOf('<img') < 0 && nasty.indexOf('&lt;img') >= 0, nasty.slice(0, 160));

// ── 9. It never throws ───────────────────────────────────────────────────
ok('rubbish in gives a value out, not an exception', (function () {
  const junk = [undefined, null, '', 0, 1, 'a', '\n\n\n', '::::', 'Vitals:', 'Patient:',
                '[Follow-up]', '[Follow-up · ]', {}, []];
  for (const j of junk) {
    try {
      const q = HI.parse(j);
      HI.readings(j); HI.ageYears(q); HI.sex(q); HI.everyWord(j);
      HI.chipsHTML(q); HI.cardHTML({ clinical_findings: j });
    } catch (e) { console.log('    threw on ' + JSON.stringify(j) + ': ' + e.message); return false; }
  }
  return true;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
