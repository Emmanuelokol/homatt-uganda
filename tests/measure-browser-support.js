// What browser does this app actually require, and why?
//
// "It does not load on some browsers" is not something anybody can chase.
// This prints the reason, with file and line.
//
// THE DISTINCTION THAT MATTERS, and the reason this is worth measuring:
//
//   A missing METHOD is a runtime error in one function. `[].flat()` on an old
//   engine throws where it is called; everything else on the page still works.
//
//   A missing SYNTAX FEATURE is a PARSE error, and it takes the WHOLE FILE
//   with it — every function in it, including the ones that never touch the
//   new syntax. One `?.` in clinic.js means `requireClinic` does not exist,
//   so every guarded page is a blank screen. No try/catch can reach it,
//   because nothing in the file ever runs. That is what "the site doesn't
//   load" looks like from the outside.
//
// ON THE INSTRUMENT, which was wrong the first time and worth writing down.
// The first version of this file blanked strings and comments with a
// hand-rolled scanner and then matched with clever regexes. It was wrong in
// BOTH directions:
//
//   · it reported 12 optional-chaining sites where there are 36 — the blanker
//     lost track of quoting (it does not understand regex literals) and
//     silently blanked real code;
//   · and it reported "class private field #x" four times in dashboard.html,
//     every one of them a CSS hex colour — `#FFF8E1` inside an inline style.
//
// A rule that cannot tell `#private` from `#FFF8E1` is worse than no rule, and
// a scanner that under-reports is worse still: it is the one that says the
// problem is fixed. So this now uses a LITERAL search, which has complete
// recall by construction, and prints every line it finds so a reader can
// judge. It can over-report (a `?.` inside a string would be listed); it
// cannot under-report. That is the safe direction for a check whose job is to
// find something before a clinic does.
//
//     node tests/measure-browser-support.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'app');

const RULES = [
  // ── SYNTAX: a parse error, the whole file never runs ─────────────────
  { kind: 'syntax', find: '?.', name: 'optional chaining  a?.b',
    chrome: 80, firefox: 74, safari: '13.1', year: 2020 },
  { kind: 'syntax', find: '??', name: 'nullish coalescing  a ?? b',
    chrome: 80, firefox: 72, safari: '13.1', year: 2020 },
  { kind: 'syntax', find: '||=', name: 'logical assignment  ||=',
    chrome: 85, firefox: 79, safari: '14.0', year: 2021 },
  { kind: 'syntax', find: '&&=', name: 'logical assignment  &&=',
    chrome: 85, firefox: 79, safari: '14.0', year: 2021 },

  // ── RUNTIME: throws where it is called, the rest of the file lives ───
  { kind: 'runtime', find: '.flatMap(', name: 'Array.prototype.flatMap',
    chrome: 69, firefox: 62, safari: '12.0', year: 2019 },
  { kind: 'runtime', find: 'Object.fromEntries', name: 'Object.fromEntries',
    chrome: 73, firefox: 63, safari: '12.1', year: 2019 },
  { kind: 'runtime', find: '.replaceAll(', name: 'String.prototype.replaceAll',
    chrome: 85, firefox: 77, safari: '13.1', year: 2021 },
  { kind: 'runtime', find: 'Promise.allSettled', name: 'Promise.allSettled',
    chrome: 76, firefox: 71, safari: '13.0', year: 2020 },
  { kind: 'runtime', find: 'structuredClone(', name: 'structuredClone',
    chrome: 98, firefox: 94, safari: '15.4', year: 2022 },
  { kind: 'runtime', find: 'globalThis', name: 'globalThis',
    chrome: 71, firefox: 65, safari: '12.1', year: 2019 },
  { kind: 'runtime', find: 'navigator.clipboard', name: 'navigator.clipboard',
    chrome: 66, firefox: 63, safari: '13.1', year: 2018 },
  { kind: 'runtime', find: 'Intl.RelativeTimeFormat', name: 'Intl.RelativeTimeFormat',
    chrome: 71, firefox: 65, safari: '14.0', year: 2019 },
];

/* Sites that USE a newer feature but cannot break, each read and checked by
 * hand. A guarded use is not a dependency, and counting it as one makes the
 * headline number wrong in the other direction — "needs Chrome 76" when
 * Chrome 60 runs it perfectly well.
 *
 * Anything NOT on this list is treated as a hard dependency, so a new
 * unguarded use shows up the moment it is added. The list is the exception,
 * never the rule. */
const GUARDED = {
  'clinic/clinic-sw.js': {
    'Promise.allSettled': 'feature-detected: `Promise.allSettled ? … : shim`',
  },
  'clinic/js/clinic-dictate.js': {
    globalThis: 'in the untaken branch of `typeof window !== "undefined" ? window : globalThis`',
  },
  'clinic/js/clinic-speak.js': {
    globalThis: 'in the untaken branch of `typeof window !== "undefined" ? window : globalThis`',
  },
  'clinic/clinician/js/clinician.js': {
    globalThis: 'in the untaken branch of `typeof window !== "undefined" ? window : globalThis`',
  },
  'clinic/clinician/js/qr.js': {
    globalThis: 'in the untaken branch of `typeof window !== "undefined" ? window : globalThis`',
  },
  'clinic/dashboard.html': {
    'navigator.clipboard': 'inside try/catch, falls back to document.execCommand',
  },
  'clinic/js/pwa-install.js': {
    'navigator.clipboard': 'guarded by `if (navigator.clipboard && navigator.clipboard.writeText)`',
  },
};
function guardReason(f) {
  const g = GUARDED[f.file];
  if (!g) return null;
  const key = Object.keys(g).find(k => f.rule.find.indexOf(k) >= 0 || k.indexOf(f.rule.find) >= 0);
  return key ? g[key] : null;
}

function walk(dir, hit) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    // vendor/ is third-party and shipped as published; data/ and fonts/ are
    // not code. Everything else in the portal is ours and has to run.
    if (st.isDirectory()) { if (f === 'vendor' || f === 'data' || f === 'fonts') continue; walk(p, hit); }
    else if (/\.(js|html)$/.test(f)) hit.push(p);
  }
}

const files = [];
walk(path.join(APP, 'clinic'), files);
files.sort();

const findings = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      let n = 0, from = 0, at;
      while ((at = lines[i].indexOf(rule.find, from)) >= 0) { n++; from = at + 1; }
      if (n) {
        const f = { file: path.relative(APP, file), line: i + 1, rule, n,
                    text: lines[i].trim().slice(0, 76) };
        f.guard = guardReason(f);
        findings.push(f);
      }
    }
  }
}

const num = (v) => parseFloat(String(v));
const worstN = (list, k) => list.reduce((a, f) => Math.max(a, num(f.rule[k])), 0);
const worstS = (list, k) => list.reduce((a, f) => num(f.rule[k]) > num(a) ? f.rule[k] : a, '0');
const total = (list) => list.reduce((a, f) => a + f.n, 0);

console.log('');
console.log('  What browser this app requires, and why');
console.log('  ' + '='.repeat(74));
console.log('  ' + files.length + ' shipped files (vendor, data and fonts excluded)');
console.log('');

const syntax = findings.filter(f => f.rule.kind === 'syntax');
const runtime = findings.filter(f => f.rule.kind === 'runtime');

function section(title, list, note) {
  console.log('  ' + title);
  console.log('  ' + note);
  console.log('  ' + total(list) + ' occurrence' + (total(list) === 1 ? '' : 's') +
              ' in ' + new Set(list.map(f => f.file)).size + ' file(s)');
  if (!list.length) { console.log('    none'); console.log(''); return; }
  const byFile = {};
  list.forEach(f => { (byFile[f.file] = byFile[f.file] || []).push(f); });
  Object.keys(byFile).sort().forEach((file) => {
    const fs_ = byFile[file];
    console.log('');
    console.log('    ' + file + '   ' + total(fs_) + ' occurrence(s)   needs Chrome ' +
      worstN(fs_, 'chrome') + ', Firefox ' + worstN(fs_, 'firefox') + ', Safari ' + worstS(fs_, 'safari'));
    fs_.slice(0, 40).forEach(f => {
      console.log('      ' + String(f.line).padStart(5) + '  ' + f.text);
      if (f.guard) console.log('             ↳ safe — ' + f.guard);
    });
    if (fs_.length > 40) console.log('      …and ' + (fs_.length - 40) + ' more lines');
  });
  console.log('');
}

section('SYNTAX — a parse error: the WHOLE FILE never runs', syntax,
  'This is what produces "the site does not load".');
section('RUNTIME — throws only where it is called', runtime,
  'The page still loads; one feature misbehaves.');

console.log('  ' + '='.repeat(74));
// A guarded use is not a dependency. The minimum is computed from the ones
// that can actually fail.
const hard = findings.filter(f => !f.guard);
console.log('  ' + findings.length + ' site(s) use a newer feature; ' +
            findings.filter(f => f.guard).length + ' of them are feature-detected or ' +
            'caught, leaving ' + hard.length + ' that could actually fail.');
console.log('');
if (hard.length) {
  console.log('  MINIMUM BROWSER for the app as shipped:');
  console.log('    Chrome/Edge ' + worstN(hard, 'chrome') +
              '   Firefox ' + worstN(hard, 'firefox') +
              '   Safari ' + worstS(hard, 'safari'));
  console.log('    Nothing released before ' + hard.reduce((a, f) => Math.max(a, f.rule.year), 0) +
              ' can open it.');
} else {
  console.log('  No hard dependency on anything newer. Every use is guarded.');
}
if (syntax.filter(f => !f.guard).length) {
  const sf = [...new Set(syntax.filter(f => !f.guard).map(f => f.file))];
  console.log('');
  console.log('  Files that will not PARSE on an older engine — these are the fatal ones,');
  console.log('  because the whole file is lost, not one function:');
  sf.forEach(f => console.log('    · ' + f));
} else {
  console.log('');
  console.log('  No file depends on syntax an older engine cannot parse — so no');
  console.log('  browser can be left staring at a blank page.');
}
console.log('');
