// How well does the parser cope with how people ACTUALLY talk?
//
// Not tidy textbook sentences — the real thing: Ugandan English, half-finished
// clauses, "yeah" in the middle, a recogniser's punctuation, the clinician
// correcting themselves. The first case is verbatim from a phone in a clinic,
// including the recogniser's own commas.
//
// Every case says what a human reading it would put in each box. A field left
// as '' means it must NOT be filled — inventing one is worse than leaving it.
const D = require('../app/clinic/js/clinic-dictate.js');

const CASES = [
  // ── The one from the screenshot, word for word ────────────────────────────
  { t: "Name of the person is Emmanuel Opal. He is male, and, he's age 28 years old. Yeah. He has come with a fever and cough.",
    name: 'Emmanuel Opal', sex: 'male', age: '28', unit: 'years',
    complaint: 'fever', story: [] },

  // ── Naming, the many ways it is said ──────────────────────────────────────
  { t: 'The name of the patient is Grace Nakato, she is female, 40 years.',
    name: 'Grace Nakato', sex: 'female', age: '40', unit: 'years', complaint: '' },
  { t: 'Patient name Okello John, male, 35 years old, complains of headache',
    name: 'Okello John', sex: 'male', age: '35', unit: 'years', complaint: 'headache' },
  { t: 'We have Mukasa Peter here, he is 52, complaining of chest pain',
    name: 'Mukasa Peter', sex: 'male', age: '52', unit: 'years', complaint: 'chest pain' },
  { t: 'This patient is called Nakimuli Sarah and she is 24 years',
    name: 'Nakimuli Sarah', sex: 'female', age: '24', unit: 'years', complaint: '' },
  { t: 'Am seeing Achieng Mary, 19 year old female with abdominal pain',
    name: 'Achieng Mary', sex: 'female', age: '19', unit: 'years', complaint: 'abdominal pain' },
  { t: 'The mother has brought a baby called Kato, 8 months old, with diarrhoea',
    name: 'Kato', sex: '', age: '8', unit: 'months', complaint: 'diarrhoea' },

  // ── Complaints, said the way clinicians actually say them ─────────────────
  { t: 'He has come with a fever and cough for three days',
    name: '', sex: 'male', age: '', unit: '', complaint: 'fever' },
  { t: 'She has come in with vomiting since morning',
    name: '', sex: 'female', age: '', unit: '', complaint: 'vomiting' },
  { t: 'The patient is complaining of a headache',
    name: '', sex: '', age: '', unit: '', complaint: 'headache' },
  { t: 'He is having a running stomach since yesterday',
    name: '', sex: 'male', age: '', unit: '', complaint: 'running stomach' },
  { t: 'She has got pain in the chest when she breathes',
    name: '', sex: 'female', age: '', unit: '', complaint: 'pain' },
  { t: 'The problem is a cough that is not going away',
    name: '', sex: '', age: '', unit: '', complaint: 'cough' },
  { t: 'He is feeling body hotness and weakness',
    name: '', sex: 'male', age: '', unit: '', complaint: 'body hotness' },
  { t: 'She reports fever for two days now',
    name: '', sex: 'female', age: '', unit: '', complaint: 'fever' },
  { t: 'Brought in with difficulty in breathing',
    name: '', sex: '', age: '', unit: '', complaint: 'difficulty in breathing' },
  // The symptoms are the complaint. The DISEASE the clinician guessed at out
  // loud must never become one — that is checked separately below, over every
  // case, because it is the one mistake that would reach a prescription.
  { t: 'He is suffering from malaria symptoms, fever and joint pain',
    name: '', sex: 'male', age: '', unit: '', complaint: 'fever' },

  // ── Ages, said loosely ────────────────────────────────────────────────────
  { t: "She's age 33 years old, complains of back pain",
    name: '', sex: 'female', age: '33', unit: 'years', complaint: 'back pain' },
  { t: 'The age is 45, male, with swollen legs',
    name: '', sex: 'male', age: '45', unit: 'years', complaint: 'swollen legs' },
  { t: 'A child of 3 years with fever',
    name: '', sex: '', age: '3', unit: 'years', complaint: 'fever' },
  { t: 'Baby of six months, not feeding well',
    name: '', sex: '', age: '6', unit: 'months', complaint: '' },
  { t: 'He is 60 years of age and has a cough',
    name: '', sex: 'male', age: '60', unit: 'years', complaint: 'cough' },

  // ── Filler, stutters and the recogniser's punctuation ─────────────────────
  { t: "Erm, the patient, yeah, is a female, and, and she's 27, with, with a rash",
    name: '', sex: 'female', age: '27', unit: 'years', complaint: 'rash' },
  { t: 'Okay so this is Namuli Betty, um, 31 years, she has fever',
    name: 'Namuli Betty', sex: 'female', age: '31', unit: 'years', complaint: 'fever' },

  // ── Things that must NOT become a name ────────────────────────────────────
  { t: 'The name is not known, male, 40 years, with a wound',
    name: '', sex: 'male', age: '40', unit: 'years', complaint: 'wound' },
  { t: 'Patient is a young man of 22 with a headache',
    name: '', sex: 'male', age: '22', unit: 'years', complaint: 'headache' },
  { t: 'This is an emergency, he is bleeding',
    name: '', sex: 'male', age: '', unit: '', complaint: 'bleeding' },
];

let scores = { name: [0, 0], sex: [0, 0], age: [0, 0], complaint: [0, 0], lost: 0 };
const misses = [];

for (const c of CASES) {
  const p = D.parsePerson(c.t);
  const s = D.parseStory(c.t);
  const got = {
    name: p.name || '',
    sex: p.sex || '',
    age: p.age || '',
    complaint: (s.complaint || '').toLowerCase(),
  };
  const want = {
    name: c.name, sex: c.sex, age: c.age,
    complaint: (c.complaint || '').toLowerCase(),
  };
  for (const k of ['name', 'sex', 'age']) {
    scores[k][1]++;
    if (got[k] === want[k]) scores[k][0]++;
    else misses.push(`${k}: want "${want[k]}" got "${got[k]}"   ← ${c.t.slice(0, 58)}`);
  }
  scores.complaint[1]++;
  // The complaint is a phrase; the required words must be in it and it must be
  // empty when nothing should have been taken.
  const ok = want.complaint
    ? got.complaint.includes(want.complaint)
    : got.complaint === '';
  if (ok) scores.complaint[0]++;
  else misses.push(`complaint: want "${want.complaint}" got "${got.complaint}"   ← ${c.t.slice(0, 58)}`);

  if ((s.lost || '').trim()) {
    scores.lost++;
    misses.push(`LOST WORDS: "${s.lost}"   ← ${c.t.slice(0, 58)}`);
  }
}

// No disease name may ever reach a field, however plainly it was said. A
// complaint is a symptom; a diagnosis is a decision, and the clinician makes
// it by tapping, not by talking.
const DISEASES = /\b(?:malaria|typhoid|pneumonia|tuberculosis|tb|hiv|aids|diabetes|cholera|meningitis|sepsis|anaemia|ulcers?)\b/i;
let leaked = 0;
for (const c of CASES) {
  const s2 = D.parseStory(c.t);
  const p2 = D.parsePerson(c.t);
  const fields = [s2.complaint, p2.name].join(' | ');
  if (DISEASES.test(fields)) {
    leaked++;
    misses.push(`DIAGNOSIS LEAKED into a field: "${fields}"   ← ${c.t.slice(0, 50)}`);
  }
}

console.log(`how people actually talk — ${CASES.length} dictations`);
for (const k of ['name', 'sex', 'age', 'complaint']) {
  const [a, b] = scores[k];
  console.log(`  ${k.padEnd(10)} ${a}/${b}${a === b ? '' : '   ← ' + (b - a) + ' wrong'}`);
}
console.log(`  words lost ${scores.lost}`);
console.log(`  diagnoses leaked into a field ${leaked}`);
if (misses.length) {
  console.log('\n  where it slips:');
  misses.forEach(m => console.log('    ' + m));
}
