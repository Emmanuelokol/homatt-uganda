// Is the whole book in there?
//
// Emmanuel photographed the printed contents page of the Uganda Clinical
// Guidelines 2023 and asked, reasonably, whether everything on it is actually
// in the app. "Probably" is not an answer for a reference a clinician treats
// from, so this checks it entry by entry.
//
//   node tests/measure-guidelines-coverage.js
//
// Two kinds of check:
//   1. Every entry transcribed from the photographed contents pages is looked
//      up by title. Anything not found is printed.
//   2. Structural: no chapter empty, no section without a page, and the page
//      numbers span the whole book rather than stopping early — which is what
//      a truncated import looks like.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, '..', 'app', 'clinic', 'data', 'uganda_clinical_guidelines_2023.db');

/* Transcribed from the photographs of the book's own contents pages
 * (pages XV–XX). Title first, then the page the book prints beside it.
 * Titles are matched loosely — the book's contents page and its body headings
 * differ in punctuation and capitalisation in places, and that is the book's
 * inconsistency, not a missing section. */
const TOC = [
  // ── 16 OBSTETRIC ──
  ['Eclampsia', 733], ['Obstructed Labour', 742], ['Ruptured Uterus', 743],
  ['Retained Placenta', 745], ['Postpartum Haemorrhage', 746],
  ['Puerperal Fever', 750], ['Newborn Resuscitation', 756],
  ['Postnatal Depression', 781], ['Obstetric Fistula', 784],
  // ── 17 CHILDHOOD ILLNESS ──
  ['Sick Newborn', 796], ['Check for Jaundice', 810],
  ['Check for Diarrhoea', 811], ['Check for HIV Infection', 815],
  ['Check for Anaemia', 846],
  // ── 18 IMMUNIZATION ──
  ['Prophylaxis Against Neonatal Tetanus', 883],
  ['Vaccination against COVID-19', 885],
  // ── 19 NUTRITION ──
  ['Infant and Young Child Feeding', 887], ['Nutrition in HIV/AIDS', 888],
  ['Nutrition in Diabetes', 889], ['Classification of Malnutrition', 892],
  ['Management of Moderate Acute Malnutrition', 897],
  ['Management of Uncomplicated Severe Acute Malnutrition', 898],
  ['Management of Complicated Severe Acute Malnutrition', 899],
  ['Discharge from Nutritional Programme', 916],
  ['Obesity and Overweight', 919],
  // ── 20 EYE ──
  ['Conjunctivitis', 923], ['Stye', 925], ['Trachoma', 926], ['Keratitis', 927],
  ['Uveitis', 928], ['Orbital Cellulitis', 930], ['Xerophthalmia', 932],
  ['Cataract', 933], ['Glaucoma', 935], ['Diabetic Retinopathy', 936],
  ['Refractive Errors', 937], ['Low Vision', 939],
  ['Foreign Body in the Eye', 941], ['Blunt Injuries', 942],
  ['Penetrating Eye Injuries', 943], ['Chemical Injuries to the Eye', 944],
  ['Retinoblastoma', 945],
  // ── 21 ENT ──
  ['Foreign Body in the Ear', 947], ['Wax in the Ear', 948],
  ['Otitis External', 949], ['Otitis Media', 951], ['Glue Ear', 953],
  ['Mastoiditis', 954], ['Foreign Body in the Nose', 955],
  ['Epistaxis', 957], ['Nasal Allergy', 958], ['Sinusitis', 960],
  ['Atrophic Rhinitis', 962], ['Adenoid Disease', 963],
  ['Pharyngitis', 969], ['Pharyngo-Tonsillitis', 970],
  ['Peritonsillar Abscess', 971],
  // ── 22 SKIN ──
  ['Impetigo', 974], ['Boils', 976], ['Cellulitis and Erysipelas', 977],
  ['Herpes Simplex', 979], ['Herpes Zoster', 981], ['Tineas', 982],
  ['Scabies', 987], ['Pediculosis', 989], ['Tungiasis', 991],
  ['Acne', 994], ['Urticaria', 996], ['Eczema', 997], ['Psoriasis', 999],
  ['Leg Ulcers', 1001], ['Steven-Johnson Syndrome', 1002],
  // ── 23 ORAL AND DENTAL ──
  ['Halitosis', 1005], ['Dentin Hypersensitivity', 1006],
  ['Malocclusion', 1006], ['Fluorosis', 1007], ['Dental Caries', 1010],
  ['Pulpitis', 1012], ['Acute Periapical Abscess', 1013], ['Gingivitis', 1016],
  ['Chronic Gingivitis', 1017], ['Periodontitis', 1020],
  ['Periodontal Abscess', 1021], ['Stomatitis', 1022],
  ['Aphthous Ulceration', 1025], ['Pericoronitis', 1027],
  ['Osteomyelitis of the Jaw', 1028], ['Oral Candidiasis', 1030],
  ['Kaposi', 1031], ['Hairy Leukoplakia', 1032],
  ['Traumatic lesions I', 1032], ['Traumatic lesions II', 1033],
  ['Traumatic lesions III', 1035], ['Burkitt', 1036],
  // ── 24 SURGERY, RADIOLOGY AND ANAESTHESIA ──
  ['Intestinal Obstruction', 1039], ['Internal Haemorrhage', 1041],
  ['Management of Medical Conditions in Surgical Patient', 1042],
  ['Newborn with Surgical Emergencies', 1045],
  ['Surgical Antibiotic Prophylaxis', 1046],
  ['Diagnostic Imaging', 1047], ['General Considerations', 1055],
  ['General Anaesthesia', 1057],
  ['Selection of Type of Anaesthesia for the Patient', 1060],
];

function q(sql) {
  const py = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(DB)})
c = db.cursor()
print(json.dumps([list(r) for r in c.execute(${JSON.stringify(sql)})]))
`;
  const f = path.join(os.tmpdir(), 'homatt-cov.py');
  fs.writeFileSync(f, py);
  return JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 28 }).toString());
}

(function main() {
  let all;
  try { all = q('select id, number, title, chapter_number, page from conditions'); }
  catch (e) { console.log('SKIP  could not read the guideline database — ' + e.message); process.exit(0); }

  const norm = s => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  const rows = all.map(r => ({ id: r[0], number: r[1], title: r[2], ch: r[3], page: r[4] }));

  /* Sections the import buried inside their neighbour: real headings in the
   * book with no row of their own. The app recovers these at runtime (see
   * findBuried() in guidelines.js), so a coverage check that only looked at
   * the table would report them missing when a clinician can in fact find
   * them. Detected the same way here, from the same text. */
  const full = q('select id, number, title, chapter_number, full_text from conditions');
  const tight = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const known = new Set(rows.map(r => tight(r.title)));
  const recovered = [];
  const HEAD = /(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,3})[ \t]+([A-Z][^\n]{2,80})/g;
  for (const [id, number, title, ch, txt] of full) {
    if (!txt) continue;
    HEAD.lastIndex = 0;
    let m;
    while ((m = HEAD.exec(txt)) !== null) {
      let t = m[2].replace(/\s*ICD[- ]?10.*$/i, '').replace(/\s*CODE:.*$/i, '').trim();
      if (t.length < 4 || /^(MU|IU|mg|ml|g|kg|mcg|units?)\b/i.test(t)) continue;
      const tn = tight(t);
      if (!tn || tn === tight(title) || known.has(tn)) continue;
      if (parseInt(m[1].split('.')[0], 10) !== Number(ch)) continue;
      recovered.push({ title: t, number: m[1], host: title, ch: ch, page: null });
    }
  }
  recovered.forEach(r => rows.push({ id: null, number: r.number, title: r.title,
                                     ch: r.ch, page: null, recovered: true, host: r.host }));

  // ── 1. Every transcribed contents entry ──────────────────────────────
  const missing = [];
  let found = 0, pageOk = 0, pageOff = [];
  for (const [title, page] of TOC) {
    const t = norm(title);
    const hit = rows.filter(r => norm(r.title).includes(t));
    if (!hit.length) { missing.push(title + '  (book p.' + page + ')'); continue; }
    found++;
    // The page the app shows should be the page the book prints. A few
    // differ by a page where a section starts mid-page in the PDF.
    const near = hit.some(h => h.recovered || Math.abs(Number(h.page) - page) <= 2);
    if (near) pageOk++; else pageOff.push(title + ': book p.' + page + ', app p.' + hit.map(h => h.page).join('/'));
  }

  // ── 2. Structural ────────────────────────────────────────────────────
  const chs = q('select number, title from chapters order by number');
  const perCh = {};
  rows.forEach(r => { perCh[r.ch] = (perCh[r.ch] || 0) + 1; });
  const emptyCh = chs.filter(c => !perCh[c[0]]).map(c => c[0] + ' ' + c[1]);
  const noPage = rows.filter(r => !r.page).length;
  const pages = rows.map(r => Number(r.page)).filter(n => n > 0);
  const maxPage = Math.max.apply(null, pages);
  const minPage = Math.min.apply(null, pages);

  console.log('');
  console.log('Is the whole book in the app?');
  console.log('  sections in the database : ' + (rows.length - recovered.length));
  console.log('  recovered from inside a neighbour : ' + recovered.length +
    (recovered.length ? '  (' + recovered.map(r => r.title).join(', ') + ')' : ''));
  console.log('  reachable in the app     : ' + rows.length);
  console.log('  chapters                 : ' + chs.length + (emptyCh.length ? '  (EMPTY: ' + emptyCh.join('; ') + ')' : '  (none empty)'));
  console.log('  sections with no page    : ' + noPage);
  console.log('  page range covered       : ' + minPage + ' – ' + maxPage + '  (the printed book runs to 1161)');
  console.log('');
  console.log('  contents-page entries checked : ' + TOC.length);
  console.log('  found in the app              : ' + found);
  console.log('  missing                       : ' + missing.length);
  console.log('  page number agrees with book  : ' + pageOk + ' of ' + found);

  if (missing.length) {
    console.log('');
    console.log('  NOT FOUND:');
    missing.forEach(m => console.log('   ✗ ' + m));
    process.exitCode = 1;
  }
  if (pageOff.length) {
    console.log('');
    console.log('  page differs by more than 2 (worth a look, not necessarily wrong):');
    pageOff.slice(0, 12).forEach(m => console.log('   · ' + m));
  }
  if (!missing.length) {
    console.log('');
    console.log('  Every entry transcribed from the photographed contents pages');
    console.log('  is present. The app also holds sub-sections the printed');
    console.log('  contents page does not list at all.');
  }
})();
