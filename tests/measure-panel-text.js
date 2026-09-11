// How the one-tap package lays out the guideline's own words.
//
//   node tests/measure-panel-text.js
//
// WHAT THIS WAS WRITTEN TO PROVE, AND WHAT IT ACTUALLY FOUND
//
// The package shows the guideline text in "Guideline notes for this
// condition", and it lays it out with its OWN rule — not the one the guideline
// screen uses. Two rules for the same job drift, and the second one is always
// the one nobody measured, so the intention was to replace the panel's rule
// with the screen's: join a line to the one above only when that line RAN TO
// THE MARGIN, which is the only evidence left that the typesetter wrapped it
// rather than ended it. That rule was measured at 0 words lost across all 551
// sections and it is what fixed the unreadable guideline screen.
//
// Measured here, it is the WRONG rule for this panel, and by a wide margin:
//
//                               the panel's rule    the screen's rule
//   sentences cut in half                 0                  1,723
//   sentences welded together           110                    180
//   letters lost                          0                      0
//
// The reason is what each one is fed. The screen lays out `full_text` — raw
// pages, wrapped at a fixed column, where line length is real evidence. The
// panel lays out the already-split fields (management, clinical features),
// which are mostly short bullets and list items, so "this line stopped short
// of the margin" is true of almost all of them and the rule refuses to join
// anything.
//
// So the panel's rule stays. Recorded here because "make the two the same"
// is an obvious-looking change that a later reader will propose again, and
// this is the answer.
//
// What is counted:
//   broken   a paragraph that ends with no terminal punctuation and is
//            followed by one starting in lower case — a sentence the reader
//            sees cut in half. Lower is better.
//            NOTE this measure is circular for the shipped rule: joining
//            exactly those pairs is what that rule DOES, so it scores 0 by
//            construction. It is here to size what the other rule would cost,
//            not to award the shipped one a prize.
//   welded   a paragraph holding a full stop followed by a capital where the
//            source had a line break at a SHORT line — two sentences run
//            together. Lower is better.
//   lost     letters that went in and did not come out. Must be 0. Letters,
//            not words, because both rules mend a word the PDF broke across a
//            line — which turns two tokens into one and reads as a loss.

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
  const f = path.join(os.tmpdir(), 'homatt-panel-' + process.pid + '.py');
  fs.writeFileSync(f, py);
  return JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 28 }).toString());
}

/* Lifted from ucg-autofill.js so this measures what the panel really does. */
const GL_DROP = [/^\s*$/, /^page\s+\d+/i, /^\d+\s*$/, /^Uganda Clinical Guidelines/i];
const GL_BULLET = /^\s*(?:[~•\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/;
const glShout = s => /^[A-Z0-9][A-Z0-9 ,'()\/&+-]{2,59}$/.test(String(s).trim()) ||
                     /^[A-Z][^a-z]*:?$/.test(String(s).trim());

function keep(text) {
  const out = [];
  String(text || '').replace(/\r/g, '').split('\n').forEach(ln => {
    const s = ln.replace(/ /g, ' ')
                .replace(/Uganda Clinical Guidelines\s*\d{4}/gi, '').trim();
    if (!s) return;
    for (const re of GL_DROP) if (re.test(s)) return;
    out.push(s);
  });
  return out;
}

// The rule that shipped.
function joinOld(kept) {
  const out = [];
  for (const s of kept) {
    const prev = out.length ? out[out.length - 1] : null;
    const joins = prev && !GL_BULLET.test(s) && !glShout(s) &&
      !/[.:;!?]$/.test(prev) && !glShout(prev) && /^[a-z0-9(,;]/.test(s);
    if (joins) out[out.length - 1] = /[a-z]-$/.test(prev) ? prev.slice(0, -1) + s : prev + ' ' + s;
    else out.push(s);
  }
  return out;
}

// The rule the guideline screen uses, and that measure-guidelines.js measured.
function joinNew(kept) {
  const lens = kept.map(s => s.length).sort((a, b) => a - b);
  const W = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.85))] : 0;
  const FULL = Math.max(24, W - 12);
  const out = [], raw = [];
  for (const s of kept) {
    const prev = out.length ? out[out.length - 1] : null;
    const prevRaw = raw.length ? raw[raw.length - 1] : '';
    const joins = prev && !GL_BULLET.test(s) && !glShout(s) && !glShout(prev) &&
      prevRaw.length >= FULL;
    if (joins) {
      out[out.length - 1] = /[a-z]-$/.test(prev) ? prev.slice(0, -1) + s : prev + ' ' + s;
      raw[raw.length - 1] = s;
    } else { out.push(s); raw.push(s); }
  }
  return out;
}

function score(kept, lines) {
  let broken = 0, welded = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    if (GL_BULLET.test(a) || GL_BULLET.test(b) || glShout(a) || glShout(b)) continue;
    if (!/[.:;!?]$/.test(a) && /^[a-z]/.test(b)) broken++;
  }
  // Two sentences welded: a full stop mid-paragraph where the source broke the
  // line at a point well short of the margin.
  const lens = kept.map(s => s.length).sort((x, y) => x - y);
  const W = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.85))] : 0;
  const short = new Set(kept.filter(s => s.length < Math.max(24, W - 12)).map(s => s.slice(-18)));
  for (const l of lines) {
    if (GL_BULLET.test(l) || glShout(l)) continue;
    let m; const re = /([a-z\)])\s+([A-Z])/g;
    while ((m = re.exec(l))) {
      const before = l.slice(0, m.index + 1);
      for (const tail of short) { if (before.endsWith(tail)) { welded++; break; } }
    }
  }
  /* Counting WORDS here would be wrong. Both rules repair a word the PDF
   * broke across a line ("chil-" + "dren"), which turns two tokens into one
   * and reads as a word lost when it is a word mended. Letters do not move:
   * a repair only removes a hyphen. So the check is on the letters. */
  return { broken, welded, letters: lines.join('').replace(/[^a-z0-9]/gi, '').toLowerCase() };
}

(function main() {
  let rows;
  try {
    rows = q("SELECT id, title, management, clinical_features, investigations, " +
             "differential, complications, causes, prevention, notes FROM conditions");
  } catch (e) { console.log('SKIP  could not read the guideline database — ' + e.message); return; }

  let fields = 0;
  const tot = { old: { broken: 0, welded: 0, lost: 0 }, now: { broken: 0, welded: 0, lost: 0 } };
  const worst = [];
  for (const r of rows) {
    for (let i = 2; i < r.length; i++) {
      const text = r[i];
      if (!text || !String(text).trim()) continue;
      const kept = keep(text);
      if (!kept.length) continue;
      fields++;
      const src = kept.join('').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const a = score(kept, joinOld(kept));
      const b = score(kept, joinNew(kept));
      tot.old.broken += a.broken; tot.old.welded += a.welded;
      tot.now.broken += b.broken; tot.now.welded += b.welded;
      // A repair removes a hyphen, so the letters that survive it are the
      // letters that went in, minus the hyphens — which are not letters.
      tot.old.lost += Math.max(0, src.length - a.letters.length);
      tot.now.lost += Math.max(0, src.length - b.letters.length);
      if (a.broken - b.broken > 4) worst.push([r[1], a.broken, b.broken]);
    }
  }

  console.log('');
  console.log('Laying out the guideline text inside the one-tap package');
  console.log('  sections            : ' + rows.length);
  console.log('  text fields laid out: ' + fields);
  console.log('');
  console.log("                            the panel's rule   the screen's rule");
  console.log('  sentences cut in half   : ' + String(tot.old.broken).padStart(10) +
    String(tot.now.broken).padStart(21));
  console.log('  sentences welded together:' + String(tot.old.welded).padStart(10) +
    String(tot.now.welded).padStart(21));
  console.log('  letters lost            : ' + String(tot.old.lost).padStart(10) +
    String(tot.now.lost).padStart(21));
  if (worst.length) {
    console.log('');
    console.log('  Sections the screen\'s rule would break worst, if it were used here:');
    worst.sort((x, y) => (y[1] - y[2]) - (x[1] - x[2]));
    worst.slice(0, 8).forEach(w =>
      console.log('    ' + w[0].slice(0, 46).padEnd(46) + ' ' + w[1] + ' → ' + w[2]));
  }
  console.log('');
  console.log('  The panel keeps its own rule. It is fed the already-split fields —');
  console.log('  short bullets and list items — where line length is not evidence of');
  console.log('  anything, while the guideline screen is fed raw wrapped pages where');
  console.log('  it is. Same job, different input, and the input decides.');
  if (tot.old.lost > 0) {
    console.log('');
    console.log('  LETTERS WERE LOST. Nothing the guideline says may be dropped.');
    process.exitCode = 1;
  }
})();
