// Runs the REAL formatter from ucg-autofill.js over the whole guideline
// database and reports what it does — so the heuristics are judged on all
// 535 conditions, not on the one that happened to be on screen.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const fs = require('fs');
const src = fs.readFileSync(require('path').join(APP, 'clinic/js/ucg-autofill.js'), 'utf8');
const a = src.indexOf('  var GL_DROP = [');
const b = src.indexOf('  // Collapsible guideline detail');
if (a < 0 || b < 0) { console.error('could not find the formatter block'); process.exit(1); }
const body = src.slice(a, b);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mod = new Function('esc', body + '\n return {glHtml:glHtml, glLines:glLines, glIsHeading:glIsHeading};')(esc);
module.exports = mod;

if (require.main === module) {
  const { execSync } = require('child_process');
  const rowsJson = execSync(`python3 -c "
import sqlite3, json
c=sqlite3.connect(require('path').join(APP, 'clinic/data/uganda_clinical_guidelines_2023.db'))
cols=['management','clinical_features','differential','investigations','complications','causes','prevention','notes','full_text']
out=[]
for r in c.execute('select title,'+','.join(cols)+' from conditions'):
    out.append({'title':r[0], 'secs':{cols[i]:(r[i+1] or '') for i in range(len(cols))}})
print(json.dumps(out))
"`, { maxBuffer: 1 << 30 }).toString();
  const rows = JSON.parse(rowsJson);
  let secs = 0, linesIn = 0, linesOut = 0, headings = 0, bullets = 0, warns = 0, frags = 0, crashes = 0;
  const sampleH = [], sampleW = [];
  for (const r of rows) {
    for (const k of Object.keys(r.secs)) {
      const t = r.secs[k];
      if (!t.trim()) continue;
      secs++;
      linesIn += t.split('\n').filter(x => x.trim()).length;
      let html;
      try { html = mod.glHtml(t); } catch (e) { crashes++; console.log('CRASH', r.title, k, e.message); continue; }
      linesOut += mod.glLines(t).length;
      const h = html.match(/<h6 class="gl-h">/g); if (h) headings += h.length;
      const li = html.match(/<li>/g); if (li) bullets += li.length;
      const w = html.match(/gl-warn/g); if (w) warns += w.length;
      if (/gl-frag/.test(html)) frags++;
      if (sampleH.length < 30 && h) (html.match(/<h6 class="gl-h">([^<]*)</g) || []).forEach(x => { if (sampleH.length < 30) sampleH.push(x.slice(17, -1)); });
      if (sampleW.length < 12 && w) (html.match(/<span>([^<]*)</g) || []).forEach(x => { if (sampleW.length < 12) sampleW.push(x.slice(6, -1)); });
    }
  }
  console.log('sections           ', secs);
  console.log('lines in / out     ', linesIn, '→', linesOut, '(' + Math.round(100 - linesOut / linesIn * 100) + '% fewer, sentences rejoined + page furniture dropped)');
  console.log('headings marked    ', headings);
  console.log('bullets marked     ', bullets);
  console.log('warnings marked    ', warns);
  console.log('heading tails kept ', frags);
  console.log('crashes            ', crashes);
  console.log('\nsample headings:'); sampleH.slice(0, 24).forEach(s => console.log('   ', s.slice(0, 72)));
  console.log('\nsample warnings:'); sampleW.slice(0, 10).forEach(s => console.log('   ', s.slice(0, 72)));
}
