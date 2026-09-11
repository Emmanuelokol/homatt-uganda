// Does laying the guideline out lose any of it?
//
// The book is the one thing in this app that must not be paraphrased, trimmed
// or quietly dropped. outline() rejoins lines the PDF wrapped and turns tildes
// into bullets — both of which MOVE text — so "nothing was lost" has to be a
// number, checked against every section, not a impression from reading three.
//
//   node tests/measure-guidelines.js
//
// It compares the words going in with the words coming out, for all 551
// sections × 9 text columns. Markers (~ • - –) are not words and are expected
// to go; anything else that disappears is a fault and is printed.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, '..', 'app', 'clinic', 'data', 'uganda_clinical_guidelines_2023.db');
const SRC = path.join(__dirname, '..', 'app', 'clinic', 'js', 'guidelines.js');

// Pull outline() out of the file and run it on its own. The module is an IIFE
// that expects a browser, so the two functions are lifted by source rather
// than by loading the whole thing.
const js = fs.readFileSync(SRC, 'utf8');
function lift(name) {
  const at = js.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('cannot find ' + name + '() in guidelines.js');
  let i = js.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < js.length; k++) {
    if (js[k] === '{') depth++;
    else if (js[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  return js.slice(at, end);
}
const markRe = js.match(/var MARK_RE = [^\n]+/)[0];
const sandbox = new Function(`
  ${markRe}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var _sevSel = null;
  function markSeverity(t){ return esc(t); }
  ${lift('isHeading')}
  ${lift('outline')}
  return { outline: outline, isHeading: isHeading };
`)();

/* Words, for comparing what went in against what came out.
 *
 * The two sides are NOT treated the same, and that matters: the guideline text
 * is plain prose containing "<6" and ">12" all over the paediatric tables, so
 * running an HTML tag-stripper over the SOURCE matches "<6 ... >" as if it
 * were a tag and deletes everything between them. That is how this file first
 * reported 137 lost words that were never lost — a measurement corrupting its
 * own input reads exactly like a bug in the thing being measured.
 */
function words(s, isHtml) {
  var t = String(s || '');
  if (isHtml) {
    t = t.replace(/<li value="(\d+)"[^>]*>/g, ' $1. ')   // the kept source number
         .replace(/<br\s*\/?>/g, ' ')
         .replace(/<[^>]+>/g, ' ')
         .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return t
    .replace(/[~•–—]/g, ' ')
    .split(/\s+/).filter(Boolean)
    // A lone hyphen, asterisk or angle bracket was a bullet marker, not a
    // word. Inside a word ("co-trimoxazole") it is untouched, because that
    // token never splits.
    .filter(function (w) { return !/^[-*>]$/.test(w); });
}

function dump() {
  const py = `
import sqlite3, json, sys
db = sqlite3.connect(${JSON.stringify(DB)})
c = db.cursor()
cols = ['causes','clinical_features','differential','investigations','management',
        'prevention','complications','notes','full_text']
out = []
for row in c.execute("select id,title,chapter_title," + ",".join(cols) + " from conditions"):
    out.append({'id': row[0], 'title': row[1], 'chapter': row[2],
                'cols': {cols[i]: row[3+i] for i in range(len(cols))}})
print(json.dumps(out))
`;
  const f = path.join(require('os').tmpdir(), 'homatt-guidelines-dump.py');
  fs.writeFileSync(f, py);
  return JSON.parse(execFileSync('python3', [f], { maxBuffer: 1 << 30 }).toString());
}

(function main() {
  let rows;
  try { rows = dump(); }
  catch (e) { console.log('SKIP  could not read the guideline database — ' + e.message); process.exit(0); }

  let fields = 0, empty = 0, lostFields = 0, lostWords = 0;
  let bullets = 0, headings = 0, joined = 0;
  const worst = [];

  for (const r of rows) {
    for (const col of Object.keys(r.cols)) {
      const src = r.cols[col];
      if (!src || !String(src).trim()) { empty++; continue; }
      fields++;
      const html = sandbox.outline(src);
      const a = words(src, false), b = words(html, true);
      bullets  += (html.match(/<li>/g) || []).length;
      headings += (html.match(/<h4/g) || []).length;
      // A line the PDF wrapped that is now part of the sentence above it.
      joined += Math.max(0, String(src).split('\n').filter(l => l.trim()).length -
                            ((html.match(/<li>/g) || []).length +
                             (html.match(/<p /g) || []).length +
                             (html.match(/<h4/g) || []).length));

      // Multiset comparison: every word in must appear as often coming out.
      const count = new Map();
      for (const w of a) count.set(w, (count.get(w) || 0) + 1);
      for (const w of b) count.set(w, (count.get(w) || 0) - 1);
      const missing = [];
      for (const [w, n] of count) if (n > 0) for (let k = 0; k < n; k++) missing.push(w);
      if (missing.length) {
        lostFields++; lostWords += missing.length;
        if (worst.length < 10) {
          worst.push(`${r.title} · ${col}: lost ${missing.length} — ${missing.slice(0, 8).join(' ')}`);
        }
      }
    }
  }

  console.log('');
  console.log('Laying out the Uganda Clinical Guidelines');
  console.log('  sections            : ' + rows.length);
  console.log('  text fields laid out: ' + fields + '   (' + empty + ' empty, skipped)');
  console.log('  bullets made        : ' + bullets);
  console.log('  headings found      : ' + headings);
  console.log('  wrapped lines rejoined into the sentence above: ' + joined);
  console.log('');
  console.log('  fields that lost a word : ' + lostFields);
  console.log('  words lost in total     : ' + lostWords);
  if (worst.length) {
    console.log('');
    worst.forEach(w => console.log('  ✗ ' + w));
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('  Every word that went in came out. The markers (~ • - –) are');
    console.log('  gone because they are now real bullets; nothing else moved.');
  }
})();
