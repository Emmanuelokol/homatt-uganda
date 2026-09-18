// How well do the RULES alone split a dictated consultation?
//
// Measured, not asserted. The rules run on the phone the instant the transcript
// arrives — no second round trip, no model — so whatever they get right is what
// the clinician sees first, and the model (when there is one) only improves it.
// The number that matters is not "how often is it perfect" but "how often does
// something end up in the wrong box", because a wrong box is a record that
// reads correctly and says the wrong thing.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const D = require(require('path').join(APP, 'clinic/js/clinic-dictate.js'));

// Real shapes of Ugandan clinic dictation. `c` = words that must reach the
// complaint, `h` = the story, `b` = background. A word listed must appear in
// that box; nothing listed may appear in another.
const CASES = [
  { t: 'complains of fever and headache for two days, no vomiting, has taken panadol',
    c: ['fever'], h: ['two days', 'no vomiting', 'panadol'], b: [] },
  { t: 'she presents with cough for one week, worse at night, no fever',
    c: ['cough'], h: ['one week', 'no fever'], b: [] },
  { t: 'complains of abdominal pain since yesterday, known diabetic on metformin',
    c: ['abdominal pain'], h: ['yesterday'], b: ['diabetic', 'metformin'] },
  { t: 'came with diarrhoea three days, four episodes today, no blood in stool',
    c: ['diarrhoea'], h: ['three days', 'no blood'], b: [] },
  { t: 'complains of chest pain, is a known hypertensive on amlodipine, no shortness of breath',
    c: ['chest pain'], h: ['no shortness'], b: ['hypertensive', 'amlodipine'] },
  { t: 'presents with fever for one day, child is not feeding well, mother says convulsions at home',
    c: ['fever'], h: ['not feeding', 'convulsions'], b: [] },
  { t: 'complains of headache and dizziness, history of migraine',
    c: ['headache'], h: [], b: ['migraine'] },
  { t: 'she has body weakness for two weeks, denies cough, denies night sweats',
    c: ['weakness'], h: ['denies cough', 'denies night sweats'], b: [] },
  { t: 'complains of painful urination for three days, no fever, previously treated for UTI',
    c: ['painful urination'], h: ['three days', 'no fever'], b: ['treated for uti'] },
  { t: 'presents with swollen legs, known heart problem, on furosemide',
    c: ['swollen legs'], h: [], b: ['heart problem', 'furosemide'] },
  { t: 'complains of back pain after lifting, he is a boda rider',
    c: ['back pain'], h: ['lifting'], b: ['boda'] },
  { t: 'came with vomiting since morning, has not passed urine, no diarrhoea',
    c: ['vomiting'], h: ['not passed urine', 'no diarrhoea'], b: [] },
  { t: 'complains of ear pain right side for four days, no discharge',
    c: ['ear pain'], h: ['four days', 'no discharge'], b: [] },
  { t: 'she complains of itching rash on the arms, no new soap, no fever',
    c: ['rash'], h: ['no new soap', 'no fever'], b: [] },
  { t: 'presents with fever and joint pains, family history of sickle cell',
    c: ['fever'], h: [], b: ['sickle cell'] },
  { t: 'complains of cough for three weeks, smoker, no weight loss',
    c: ['cough'], h: ['no weight loss'], b: ['smoker'] },
  { t: 'came with a wound on the foot from a nail, last tetanus not known',
    c: ['wound'], h: ['nail', 'tetanus'], b: [] },
  { t: 'complains of general body pain and fever, took coartem two days ago with no relief',
    c: ['body pain'], h: ['coartem', 'no relief'], b: [] },
  { t: 'presents with heavy menstrual bleeding for five days, known anaemic',
    c: ['bleeding'], h: ['five days'], b: ['anaemic'] },
  { t: 'complains of blurred vision, is a known diabetic, no eye pain',
    c: ['blurred vision'], h: ['no eye pain'], b: ['diabetic'] },
  { t: 'the child has fever and refuses to eat, no convulsions, no vomiting',
    c: ['fever'], h: ['refuses to eat', 'no convulsions', 'no vomiting'], b: [] },
  { t: 'complains of difficulty in breathing, known asthmatic using salbutamol',
    c: ['difficulty in breathing'], h: [], b: ['asthmatic', 'salbutamol'] },
  { t: 'came with swelling of the face since morning, ate groundnuts, no rash elsewhere',
    c: ['swelling'], h: ['groundnuts', 'no rash'], b: [] },
  { t: 'complains of burning in the chest after eating, worse when lying down',
    c: ['burning'], h: ['after eating', 'lying down'], b: [] },
  { t: 'presents with fever and chills for two days, slept without a net',
    c: ['fever'], h: ['two days', 'net'], b: [] },
  { t: 'complains of toothache lower left for a week, no swelling of the face',
    c: ['toothache'], h: ['week', 'no swelling'], b: [] },
  { t: 'she has been feeling tired, is on ARVs, no fever',
    c: ['tired'], h: ['no fever'], b: ['arvs'] },
  { t: 'complains of pain in the right leg after a fall, able to walk',
    c: ['pain'], h: ['fall', 'able to walk'], b: [] },
  { t: 'came with headache for one day, no neck stiffness, no photophobia',
    c: ['headache'], h: ['no neck stiffness', 'no photophobia'], b: [] },
  { t: 'complains of loss of appetite and weight loss for a month, known epileptic on phenobarbitone',
    c: ['appetite'], h: ['month'], b: ['epileptic', 'phenobarbitone'] },
];

let perfect = 0, misplaced = 0, lost = 0;
const problems = [];
for (const k of CASES) {
  const r = D.parseStory(k.t);
  const box = { c: (r.complaint || '').toLowerCase(),
                h: (r.history || '').toLowerCase(),
                b: (r.background || '').toLowerCase() };
  const faults = [];
  for (const which of ['c', 'h', 'b']) {
    for (const w of k[which]) {
      const lw = w.toLowerCase();
      const inRight = box[which].includes(lw);
      const elsewhere = ['c', 'h', 'b'].filter(x => x !== which)
        .filter(x => box[x].includes(lw));
      if (!inRight && elsewhere.length) faults.push(`"${w}" in ${elsewhere[0]} not ${which}`);
      else if (!inRight) faults.push(`"${w}" LOST`);
    }
  }
  if ((r.lost || '').trim()) faults.push('lost: ' + r.lost.slice(0, 40));
  if (!faults.length) perfect++;
  else {
    if (faults.some(f => /LOST/.test(f))) lost++; else misplaced++;
    problems.push(k.t.slice(0, 52) + '\n      ' + faults.join(' · '));
  }
}
console.log(`rules alone, ${CASES.length} dictations`);
console.log(`  every word in the right box : ${perfect}`);
console.log(`  something in the wrong box  : ${misplaced}`);
console.log(`  something lost entirely     : ${lost}`);
if (problems.length) {
  console.log('\n  where it slips:');
  problems.forEach(p => console.log('    ' + p));
}
