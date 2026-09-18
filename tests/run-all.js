#!/usr/bin/env node
/* Run every test-*.js and print one line each.
 *
 *   node tests/run-all.js              everything
 *   node tests/run-all.js dictate pay  only files whose name contains those
 *
 * Each test is its own process because each one starts its own web server and
 * its own browser; a crash in one must not take the rest with it.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const pick = process.argv.slice(2);
const files = fs.readdirSync(DIR)
  .filter((f) => /^test-.*\.js$/.test(f))
  .filter((f) => !pick.length || pick.some((p) => f.includes(p)))
  .sort();

if (!files.length) { console.error('No tests matched.'); process.exit(1); }

let pass = 0, fail = 0, crashed = 0;
const bad = [];

for (const f of files) {
  let out = '';
  try {
    // test-datacost.js deliberately sits idle for 90 seconds at a time to
    // prove the app is not polling, so the ceiling has to clear that.
    out = execFileSync(process.execPath, [path.join(DIR, f)],
      { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''));
    if (!/^(PASS|FAIL)/m.test(out)) out += '\nCRASH  ' + (e.message || '').split('\n')[0];
  }
  const p = (out.match(/^PASS/gm) || []).length;
  const f2 = (out.match(/^FAIL/gm) || []).length;
  const c = /CRASH/.test(out) ? 1 : 0;
  pass += p; fail += f2; crashed += c;
  console.log(`${f.padEnd(30)} pass=${String(p).padEnd(4)} fail=${String(f2).padEnd(3)} crash=${c}`);
  if (f2 || c) {
    bad.push(f);
    out.split('\n').filter((l) => /^FAIL|CRASH/.test(l)).slice(0, 8)
      .forEach((l) => console.log('    ' + l));
  }
}

console.log(`\n${files.length} files · ${pass} passed · ${fail} failed · ${crashed} crashed`);
if (bad.length) console.log('look at: ' + bad.join(', '));
process.exit(fail || crashed ? 1 : 0);
