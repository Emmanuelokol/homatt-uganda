// How much of the printed book can a clinician actually reach?
//
//   node tests/measure-book-coverage.js [path/to/UCG_2023.html]
//
// Emmanuel opened "24.1 Surgery", saw an empty card, and said: "when I check
// in the book, the context is there". He was right to ask, and the answer
// needed a number rather than an opinion.
//
// This walks the SOURCE — the converted book the database is cut from — and
// asks, line by line, whether each line ended up somewhere a clinician can
// read it. Three outcomes per line:
//
//   in a section    it is inside some row's full_text
//   furniture       a running header or footer the conversion interleaved
//                   ("306 / Uganda / Clinical / Guidelines / 2023 / CHAPTER…")
//   UNREACHABLE     it is in the book and nowhere in the app
//
// WHAT IT FOUND THE FIRST TIME IT WAS RUN
//
// The numbered spine is complete: `ucg_spine` gives each section a span that
// ends exactly where the next one begins, so no clinical text falls between
// two sections. My first attempt at this measurement said 9.2% of section text
// was missing; that was my own matcher landing headings in the abbreviations
// list, not a fault in the book or the build. Worth recording, because the
// wrong number was alarming and confident.
//
// What was genuinely unreachable was everything printed OUTSIDE that spine:
//
//   front matter   64,670 letters   PRESCRIPTION WRITING RULES, INJECTIONS,
//                                   Antimicrobial Resistance, Appropriate
//                                   Medicines Use, the abbreviations list
//   back matter    27,087 letters   the four appendices — including the
//                                   National Laboratory Test Menu, which says
//                                   which tests an HC II, HC III, HC IV,
//                                   district hospital or national referral
//                                   hospital can actually run
//
// Both are now chapter 25.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, '..', 'app', 'clinic', 'data', 'uganda_clinical_guidelines_2023.db');
const TOOLS = path.join(__dirname, '..', 'tools');
const SRC = process.argv[2] ||
  '/root/.claude/uploads/f3451427-e03d-514d-8f41-e3e6f96e4176/57d82386-Uganda_Clinical_Guidelines_2023.html';

const PY = `
import sys, re, json, sqlite3
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import ucg_spine, ucg_clean

lines = ucg_spine.load_lines(${JSON.stringify(SRC)})
toc = ucg_spine.parse_toc(lines)
chapters = {int(n): e['title'] for n, e in toc.items()
            if e['depth'] == 1 and n.isdigit()}
mask = set(ucg_clean.furniture_mask(lines, chapters))

def letters(s):
    return len(re.sub(r'[^A-Za-z0-9]', '', s or ''))

# The book starts at its Foreword. Everything above that is the conversion's
# own head — a <style> block and a "Converted Document" title — which is not
# the book and must not be counted as content it is failing to show.
start = 0
for i, l in enumerate(lines[:400]):
    if re.sub(r'\s+', ' ', l).strip().lower() == 'foreword':
        start = i
        break

real = [(i, letters(lines[i])) for i in range(start, len(lines)) if i not in mask]
total = sum(n for _, n in real)

# What the app holds. A line is reachable if its text is inside some section's
# full_text — compared squashed, because the build de-hyphenates as it writes.
db = sqlite3.connect(${JSON.stringify(DB)})
blob = ' \\n '.join((r[0] or '') for r in db.execute('SELECT full_text FROM conditions'))
squash = lambda s: re.sub(r'[^a-z0-9]', '', (s or '').lower())
hay = squash(blob)

# Two kinds of line are legitimately not inside any section's text, and
# counting them as loss would hide the real number behind a permanent 3%.
#   - the book's own table of contents: dot leaders and a printed page number
#   - a section's own heading, which the card shows as its title
titles = set()
for r in db.execute('SELECT number, title FROM conditions'):
    titles.add(squash((r[0] or '') + (r[1] or '')))
    titles.add(squash(r[1]))
CONTENTS = re.compile(r'\.{4,}\s*[\dixvlcXIVLC]*\s*$')

reach = 0
missing = []
n_toc = n_head = 0
for i, n in real:
    if n == 0:
        continue
    k = squash(lines[i])
    if len(k) < 4:
        reach += n          # too short to locate; follows the line above it
        continue
    if k in hay:
        reach += n
        continue
    if CONTENTS.search(lines[i]):
        n_toc += n          # the printed index, replaced by the app's own
        continue
    if squash(re.sub(r'\s*ICD[\s-]*10.*$', '', lines[i], flags=re.I)) in titles:
        n_head += n         # the heading itself — it is the card's title
        continue
    missing.append((i, lines[i][:90], n))

by_ch = {}
for r in db.execute('SELECT chapter_number, COUNT(*), SUM(LENGTH(COALESCE(full_text,"")))'
                    ' FROM conditions GROUP BY chapter_number ORDER BY chapter_number'):
    by_ch[r[0]] = (r[1], r[2] or 0)

print(json.dumps({
  'lines': len(lines), 'furniture': len(mask), 'start': start,
  'total': total, 'reach': reach,
  'missing': missing[:40], 'nmissing': len(missing),
  'misslet': sum(m[2] for m in missing), 'toc': n_toc, 'head': n_head,
  'sections': db.execute('SELECT COUNT(*) FROM conditions').fetchone()[0],
  'chapters': db.execute('SELECT COUNT(*) FROM chapters').fetchone()[0],
  'ref': by_ch.get(25, (0, 0)),
}))
`;

(function main() {
  if (!fs.existsSync(SRC)) {
    console.log('');
    console.log('SKIP  the source book is not on this machine.');
    console.log('      This measurement compares the app against the converted');
    console.log('      book the database is cut from. Pass its path:');
    console.log('        node tests/measure-book-coverage.js <UCG_2023.html>');
    return;
  }
  const f = path.join(os.tmpdir(), 'homatt-cov-' + process.pid + '.py');
  fs.writeFileSync(f, PY);
  let r;
  try { r = JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 28 }).toString()); }
  catch (e) { console.log('SKIP  could not read the book or the database — ' + e.message); return; }

  const pct = (100 * r.reach / Math.max(1, r.total)).toFixed(2);
  console.log('');
  console.log('How much of the book a clinician can reach');
  console.log('  source lines            : ' + r.lines + '  (the book starts at line ' + r.start + ')');
  console.log('  running headers/footers : ' + r.furniture + '  (not content)');
  console.log('  letters in the book     : ' + r.total);
  console.log('  letters reachable in app: ' + r.reach + '   ' + pct + '%');
  console.log('  of the rest —');
  console.log('    the printed index      : ' + r.toc + '  (the app builds its own contents page)');
  console.log('    section headings       : ' + r.head + '  (shown as the card title)');
  console.log('  letters UNREACHABLE     : ' + r.misslet + '   on ' + r.nmissing + ' lines');
  console.log('');
  console.log('  sections in the app     : ' + r.sections + ' across ' + r.chapters + ' chapters');
  console.log('  of those, reference     : ' + r.ref[0] + ' sections, ' + r.ref[1] + ' characters');
  if (r.nmissing) {
    console.log('');
    console.log('  Lines that are in the book and nowhere in the app:');
    r.missing.slice(0, 25).forEach(m =>
      console.log('    ' + String(m[0]).padStart(7) + '  ' + m[1]));
    if (r.nmissing > 25) console.log('    … and ' + (r.nmissing - 25) + ' more');
  }
  console.log('');
  console.log('  The book\'s own table of contents is deliberately not brought in:');
  console.log('  it is page numbers for a printed copy, and the app builds its own');
  console.log('  contents page from the sections, which is complete and tappable.');
})();
