// Is every dose the one-tap package offers actually printed under the
// condition it is offered for?
//
//   node tests/measure-doses.js
//
// The package reads `medicines WHERE condition_id = ?` and offers each row as
// that condition's drug, with its dose, ticked or not, priced and prescribed.
// So the question this answers is narrow and the only one that matters:
//
//   for every one of the 1,008 medicine rows, is the line it was lifted from
//   printed under THAT condition's heading in the book — or under a different
//   heading that the extraction ran into?
//
// Three checks, in the order they can fail:
//
//   1. source_line is verbatim inside that condition's own full_text.
//      (If this fails the row was assembled, not extracted.)
//   2. The condition's full_text does not run past its own section into a
//      NUMBERED HEADING that belongs to a different section — and, where it
//      does, no medicine is taken from beyond that heading. Both kinds of
//      heading count: one with a row of its own, and one the import buried
//      with no row at all.
//   3. The parsed dose, unit and route are readable in the line they came
//      from, so the table is not reporting a figure the book did not print
//      beside that drug.
//
// Check 2 is the one that matters most, and it is invisible in the code: a
// section that swallowed its neighbour still passes check 1 perfectly, because
// the neighbour's text IS inside its full_text.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, '..', 'app', 'clinic', 'data', 'uganda_clinical_guidelines_2023.db');

function q(sql) {
  const py = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(DB)})
c = db.cursor()
print(json.dumps([list(r) for r in c.execute(${JSON.stringify(sql)})]))
`;
  const f = path.join(os.tmpdir(), 'homatt-doses-' + process.pid + '.py');
  fs.writeFileSync(f, py);
  return JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 28 }).toString());
}

const tight = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

/* A numbered heading in the middle of a section's text, of either kind: a
 * section that has a row of its own, or one of the seven the import buried
 * inside a neighbour with no row at all (Oesophageal Varices, Alcohol Use
 * Disorders, Adenoid Disease…) — which the app already lists as real sections.
 *
 * It has to be strict. "Benzathine penicillin 2.4 MU IM" wrapping onto a new
 * line looks exactly like a heading numbered 2.4, and reading it as one
 * condemns the whole of the genital ulcer disease page.
 *
 * And the NUMBER ALONE IS NOT ENOUGH, which is what hid two of these. The
 * extraction mis-numbered part of the book: the row numbered 6.5.4.2 carries
 * the title "Spontaneous Bacterial Peritonitis" while the heading actually
 * printed at 6.5.4.2 reads "Oesophageal Varices". Looking the number up,
 * finding a title that did not match the words on the page and stopping there
 * missed a boundary that was plainly in the text. */
const HEAD = /(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,3})[ \t]+([A-Z][^\n]{2,80})/g;

(function main() {
  let conds, meds;
  try {
    conds = q('SELECT id, number, title, chapter_number, page, full_text FROM conditions');
    meds = q('SELECT id, condition_id, name, dose, unit, route, frequency, duration, source_line FROM medicines');
  } catch (e) { console.log('SKIP  could not read the guideline database — ' + e.message); return; }

  const C = {};
  const byNum = {}, titles = {};
  for (const [id, number, title, ch, page, ft] of conds) {
    C[id] = { id, number, title, ch, page, ft: ft || '' };
    byNum[number] = id;
    titles[tight(title)] = 1;
  }

  // ── Where each section stops being itself ──────────────────────────────
  const boundary = {};      // condition id -> [{at, number, title, id}]
  for (const id in C) {
    const v = C[id];
    HEAD.lastIndex = 0;
    let m;
    while ((m = HEAD.exec(v.ft)) !== null) {
      const num = m[1];
      if (num === v.number) continue;
      const t = m[2].replace(/\s*ICD[- ]?10.*$/i, '').replace(/\s*CODE:.*$/i, '').trim();
      const other = byNum[num];
      // A section that has a row of its own — but the NUMBER alone is not
      // enough. The extraction mis-numbered part of the book, so the row
      // numbered 6.5.4.2 is titled "Spontaneous Bacterial Peritonitis" while
      // the heading printed there says "Oesophageal Varices".
      if (other !== undefined && String(other) !== String(id) &&
          tight(t).startsWith(tight(C[other].title).slice(0, 12))) {
        (boundary[id] = boundary[id] || []).push({ at: m.index, number: num, title: C[other].title, id: other });
        continue;
      }
      // Or one of the seven headings the import buried with no row at all,
      // which the app already lists as real sections. Same test as
      // findBuried() in guidelines.js.
      if (t.length < 4 || /^(MU|IU|mg|ml|g|kg|mcg|units?)\b/i.test(t)) continue;
      if (String(num).split('.')[0] !== String(v.ch)) continue;
      if (!tight(t) || titles[tight(t)]) continue;
      (boundary[id] = boundary[id] || []).push({ at: m.index, number: num, title: t, id: null, buried: true });
    }
    if (boundary[id]) boundary[id].sort((a, b) => a.at - b.at);
  }

  // ── The three checks ───────────────────────────────────────────────────
  let inOwn = 0, notInOwn = [], stray = [], doseOff = [], routeOff = [];
  for (const [mid, cid, name, dose, unit, route, freq, dur, src] of meds) {
    const v = C[cid];
    const line = flat(src);
    if (!v) { notInOwn.push({ mid, why: 'no such condition', line }); continue; }
    const at = flat(v.ft).indexOf(line);
    if (!line || at < 0) { notInOwn.push({ mid, title: v.title, why: 'not in its own section text', line }); continue; }
    inOwn++;

    // 2. Past a heading that belongs to somebody else?
    const b = boundary[cid];
    if (b) {
      const rawAt = v.ft.indexOf(src);
      const owner = rawAt >= 0 ? b.filter(x => x.at <= rawAt).pop() : null;
      if (owner) {
        stray.push({ mid, host: v.title, real: owner.title + (owner.buried ? ' (no section of its own)' : ''),
                     realId: owner.id,
                     name, dose: [dose, unit].filter(Boolean).join(''), line });
        continue;         // its dose belongs to another section; don't judge it here
      }
    }

    // 3. Is the figure the table shows readable in the line it came from?
    if (dose != null && String(dose).trim()) {
      const d = String(dose).trim();
      if (line.replace(/\s+/g, '').indexOf(d.replace(/\s+/g, '')) < 0) {
        doseOff.push({ mid, title: v.title, name, dose: d, line });
      }
    }
    if (route && !new RegExp('\\b' + String(route).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(line)) {
      routeOff.push({ mid, title: v.title, name, route, line });
    }
  }

  console.log('');
  console.log('Every dose the package can offer, against the book it came from');
  console.log('  medicine rows                              : ' + meds.length);
  console.log('  source line verbatim in its own section     : ' + inOwn);
  console.log('  source line NOT in its own section          : ' + notInOwn.length);
  console.log('');
  console.log('  sections whose text runs into another section: ' + Object.keys(boundary).length +
    ' of ' + conds.length);
  for (const id in boundary) {
    console.log('    ' + C[id].number + '  ' + C[id].title + '  (p.' + C[id].page + ', ' +
      C[id].ft.length + ' chars) runs into:');
    boundary[id].forEach(x => console.log('        ' + x.number + '  ' + x.title));
  }
  console.log('');
  console.log('  MEDICINES PRINTED UNDER A DIFFERENT HEADING : ' + stray.length);
  const byReal = {};
  stray.forEach(s => { (byReal[s.real] = byReal[s.real] || []).push(s); });
  for (const real in byReal) {
    console.log('    filed under "' + byReal[real][0].host + '", printed under "' + real + '":');
    byReal[real].forEach(s => console.log('        ' + (s.name + ' ' + s.dose).trim()));
  }
  console.log('');
  console.log('  dose not readable in its own source line    : ' + doseOff.length +
    ' of ' + (inOwn - stray.length));
  doseOff.slice(0, 10).forEach(d =>
    console.log('        ' + d.title.slice(0, 24).padEnd(24) + ' ' + d.name + ' → "' + d.dose +
      '"  from: ' + d.line.slice(0, 58)));
  console.log('  route not readable in its own source line   : ' + routeOff.length);
  routeOff.slice(0, 8).forEach(d =>
    console.log('        ' + d.title.slice(0, 24).padEnd(24) + ' ' + d.name + ' → "' + d.route +
      '"  from: ' + d.line.slice(0, 58)));

  if (notInOwn.length) {
    console.log('');
    console.log('  NOT IN ITS OWN SECTION:');
    notInOwn.slice(0, 10).forEach(x => console.log('   ✗ ' + (x.title || '?') + ' — ' + x.why + ': ' + x.line.slice(0, 60)));
  }

  console.log('');
  if (!stray.length && !notInOwn.length) {
    console.log('  Every medicine the package can offer is printed under the');
    console.log('  heading it is offered for.');
  } else {
    console.log('  ' + stray.length + ' medicines are offered for a condition the book does not');
    console.log('  print them under. The app must not present these as that');
    console.log('  condition\'s treatment.');
  }
  if (notInOwn.length) process.exitCode = 1;
})();
