// What can a clinician actually FIND in the guideline?
//
//   node tests/measure-search.js
//
// Emmanuel typed "Family" into the guideline search and was told "Nothing in
// this book matches". Chapter 15 of the Uganda Clinical Guidelines IS "FAMILY
// PLANNING (FP)". The book was not missing it — the search could not see it.
//
// The cause is one line that never ran: every index in every book is
// `CREATE VIRTUAL TABLE … USING fts5`, and the SQLite compiled into the WASM
// this app ships has FTS3 and FTS4 but NOT FTS5. `MATCH` threw on every
// search, a catch swallowed it, and the app quietly fell back to
// `title LIKE '%term%'` — so a section could only ever be found if the typed
// word was in its own heading.
//
// This measures both, over words a clinician would really type: the old
// title-only fallback, and the scan that replaced it.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, '..', 'app', 'clinic', 'data', 'uganda_clinical_guidelines_2023.db');
const WASM = path.join(__dirname, '..', 'app', 'clinic', 'js', 'vendor', 'sql-wasm.wasm');

/* Words a clinician would type. Deliberately a mix:
 *   • whole chapters that are not diseases — the ones reported missing
 *   • ordinary conditions, which the old search DID find
 *   • things that are only ever mentioned in the body of a section */
const TERMS = [
  // the report
  'family', 'family planning', 'planning',
  // the other non-disease chapters
  'immunisation', 'immunization', 'nutrition', 'palliative', 'oncology',
  'dental', 'surgery', 'anaesthesia', 'radiology',
  // ordinary conditions — these must not get worse
  'malaria', 'typhoid', 'pneumonia', 'anaemia', 'diabetes', 'asthma',
  'epilepsy', 'scabies', 'cataract',
  // contraception, by every name a clinician uses
  'condom', 'implant', 'iud', 'injectable', 'vasectomy', 'tubal ligation',
  'emergency contraception',
  // things that live in the body of a section, not in any heading
  'bed nets', 'mosquito', 'breastfeeding', 'rehydration', 'counselling',
  'referral', 'weight band', 'chest indrawing', 'danger signs',
  // medicines, which are named in management text
  'coartem', 'artemether', 'ors', 'paracetamol', 'ceftriaxone', 'metformin',
  // numbers — the book's own addressing
  '19.2', '15.2',
];

function py(script) {
  const f = path.join(os.tmpdir(), 'homatt-search-' + process.pid + '.py');
  fs.writeFileSync(f, script);
  return JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 28 }).toString());
}

/* The two searches, written in SQL exactly as the app writes them, so this
 * measures the app's queries rather than a paraphrase of them. */
const BODY = ['causes', 'clinical_features', 'differential', 'investigations',
              'management', 'prevention', 'complications', 'notes', 'full_text'];
const W = { title: 120, start: 70, word: 60, chapter: 45, number: 90, body: 8 };

/* Words a clinician says that the book does not print. Kept in step with
 * SAY_ALSO in guidelines.js — consulted only when the book's own words find
 * nothing, and the screen says what was substituted. */
const SAY_ALSO = {
  coartem: 'lumefantrine', panadol: 'paracetamol', septrin: 'cotrimoxazole',
  septrine: 'cotrimoxazole', flagyl: 'metronidazole', amoxil: 'amoxicillin',
  piriton: 'chlorphenamine', brufen: 'ibuprofen', bp: 'blood pressure',
  sugars: 'diabetes', 'sugar disease': 'diabetes', tb: 'tuberculosis',
  fp: 'contracept', anc: 'antenatal', jiggers: 'tungiasis', ringworm: 'tinea',
  piles: 'haemorrhoid', 'sickle cells': 'sickle cell', 'high blood': 'hypertension',
};

function queries(term) {
  const raw = String(term).trim();
  const toks = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const bodyOr = BODY.map(c => `ifnull(${c},'') LIKE ?`).join(' OR ');
  const score = [], where = [], sp = [], wp = [];
  for (const t of toks) {
    const any = '%' + t + '%', start = t + '%';
    score.push(
      `(CASE WHEN title LIKE ? THEN ${W.title} ELSE 0 END)` +
      `+(CASE WHEN title LIKE ? THEN ${W.start} ELSE 0 END)` +
      `+(CASE WHEN title LIKE ? OR title LIKE ? THEN ${W.word} ELSE 0 END)` +
      `+(CASE WHEN ifnull(chapter_title,'') LIKE ? THEN ${W.chapter} ELSE 0 END)` +
      `+(CASE WHEN ifnull(number,'') LIKE ? THEN ${W.number} ELSE 0 END)` +
      `+(CASE WHEN ${bodyOr} THEN ${W.body} ELSE 0 END)`);
    sp.push(any, start, '% ' + t + '%', '%(' + t + '%', any, start, ...BODY.map(() => any));
    where.push(`(title LIKE ? OR ifnull(chapter_title,'') LIKE ? OR ifnull(number,'') LIKE ? OR ${bodyOr})`);
    wp.push(any, any, start, ...BODY.map(() => any));
  }
  // A section number goes straight to that section, ahead of everything.
  const isNum = /^\d{1,2}(?:\.\d{1,3})*\.?$/.test(raw);
  return {
    old: ['SELECT id, number, title FROM conditions WHERE title LIKE ? ORDER BY length(title) LIMIT 12',
          ['%' + term + '%']],
    now: isNum
      ? ['SELECT id, number, title, 0 AS _s FROM conditions WHERE number = ? OR number LIKE ? ' +
         'ORDER BY length(number), id LIMIT 12',
         [raw.replace(/\.$/, ''), raw.replace(/\.$/, '') + '.%']]
      : ['SELECT id, number, title, ' + score.join('+') + ' AS _s FROM conditions WHERE ' +
         where.join(' AND ') + ' ORDER BY _s DESC, length(title) ASC LIMIT 12', sp.concat(wp)],
    chapter: isNum ? ['SELECT number, title FROM chapters WHERE 0', []]
      : ['SELECT number, title FROM chapters WHERE title LIKE ? ORDER BY number',
         ['%' + (toks[0] || term) + '%']],
  };
}

(function main() {
  // 1. Is FTS5 actually in the engine we ship? This is the whole cause.
  let wasm = Buffer.alloc(0);
  try { wasm = fs.readFileSync(WASM); } catch (e) {}
  const has = s => wasm.includes(Buffer.from(s));
  console.log('');
  console.log('The engine this app ships (js/vendor/sql-wasm.wasm, ' +
    (wasm.length / 1024).toFixed(0) + ' KB)');
  console.log('  fts3 present : ' + has('fts3'));
  console.log('  fts4 present : ' + has('fts4'));
  console.log('  fts5 present : ' + has('fts5') + '   ← every index in every book is fts5');

  // A term the book does not use is searched again under the word it DOES
  // use, exactly as the app does it.
  const plan = TERMS.map(t => {
    const q = queries(t);
    const also = SAY_ALSO[String(t).toLowerCase().trim()];
    if (also) q.alias = queries(also).now;
    return [t, q];
  });
  const script = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(DB)})
c = db.cursor()
out = []
for term, q in ${JSON.stringify(plan)}:
    row = {'term': term}
    for k in ('old', 'now', 'chapter'):
        sql, params = q[k]
        try: row[k] = len(list(c.execute(sql, params)))
        except Exception as e: row[k] = -1
    sql, params = q['now']
    try: row['top'] = [r[2] for r in c.execute(sql, params)][:1]
    except Exception: row['top'] = []
    row['alias'] = 0
    if row['now'] + row['chapter'] == 0 and 'alias' in q:
        sql, params = q['alias']
        try:
            hits = list(c.execute(sql, params))
            row['alias'] = len(hits)
            if hits: row['top'] = ['(the book says) ' + hits[0][2]]
        except Exception: pass
    out.append(row)
print(json.dumps(out))
`;
  let res;
  try { res = py(script); }
  catch (e) { console.log('SKIP  could not read the guideline database — ' + e.message); return; }

  let oldFound = 0, nowFound = 0, rescued = [];
  console.log('');
  console.log('  term                        old   now   first result now');
  console.log('  ' + '-'.repeat(74));
  for (const r of res) {
    const nowTotal = r.now + r.chapter + (r.alias || 0);
    if (r.old > 0) oldFound++;
    if (nowTotal > 0) nowFound++;
    if (r.old === 0 && nowTotal > 0) rescued.push(r.term);
    const flag = r.old === 0 && nowTotal > 0 ? ' ←' : '  ';
    console.log('  ' + r.term.padEnd(26) +
      String(r.old).padStart(4) + String(nowTotal).padStart(6) + flag + '  ' +
      (r.chapter > 0 ? 'chapter · ' : '') + (r.top[0] || '—'));
  }
  console.log('');
  console.log('  terms a clinician could find, of ' + TERMS.length + ':');
  console.log('    title-only fallback (what shipped) : ' + oldFound);
  console.log('    scanning the book (now)            : ' + nowFound);
  console.log('');
  console.log('  found nothing before, found now: ' + rescued.length);
  if (rescued.length) console.log('    ' + rescued.join(', '));

  // Nothing that worked may have stopped working.
  const lost = res.filter(r => r.old > 0 && (r.now + r.chapter) === 0).map(r => r.term);
  console.log('');
  console.log('  found before, found nothing now: ' + lost.length +
    (lost.length ? '  ✗ ' + lost.join(', ') : '  (nothing was lost)'));
  if (lost.length) process.exitCode = 1;
})();
