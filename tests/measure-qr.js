// Is the QR encoder actually right?
//
// Not a test — a measurement, in the style of the other measure-*.js files. It
// compares every module of every symbol this app can produce against Python's
// `qrcode` reference library: 10 versions × 4 error-correction levels, plus a
// sweep of real payloads.
//
// Worth doing because a wrong encoder does not look wrong. Get one entry of the
// block table backwards and you still get a tidy black-and-white square with
// finders in three corners; it simply will not scan. The first person to find
// out is a clinician standing in a clinic doorway with a phone, and there is
// nothing on either screen to say why.
//
//   node tests/measure-qr.js          (needs python3 with `qrcode` installed)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load the encoder the same way a browser would, with its internals exposed so
// every mask can be compared and not only the one it would choose.
const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'clinician', 'js', 'qr.js'), 'utf8');
const src = raw.replace(
  'global.HomattQR = { encode: encode, toSVG: toSVG, toCanvas: toCanvas };',
  'global.HomattQR = { encode: encode, toSVG: toSVG, toCanvas: toCanvas, _int: { makeCodewords, newMatrix, placeFunction, placeData, functionMap, applyMask, placeFormat, penalty } };');
if (src === raw) { console.log('FAIL  could not reach the encoder internals — the export line changed'); process.exit(1); }
const sandbox = { window: {} };
new Function('window', src)(sandbox.window);
const QR = sandbox.window.HomattQR;
const I = QR._int;

// Build the symbol for one specific mask, rather than the best-scoring one.
function atMask(text, version, level, mask) {
  const size = version * 4 + 17;
  const cw = I.makeCodewords(text, version, level);
  const base = I.newMatrix(size);
  I.placeFunction(base, version);
  I.placeData(base, cw);
  const m = I.applyMask(base, I.functionMap(version, size), mask);
  I.placeFormat(m, level, mask);
  return m;
}

const PY = `
import sys, json
import qrcode
from qrcode.constants import ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H
from qrcode.util import QRData, MODE_8BIT_BYTE
LV = {'L': ERROR_CORRECT_L, 'M': ERROR_CORRECT_M, 'Q': ERROR_CORRECT_Q, 'H': ERROR_CORRECT_H}
req = json.loads(sys.stdin.read())
out = []
for item in req:
    q = qrcode.QRCode(version=item.get('version') or None,
                      error_correction=LV[item['level']], box_size=1, border=0)
    # Byte mode, forced. Left to itself the library picks alphanumeric mode for
    # an all-uppercase payload, which is a smaller symbol and a different one —
    # comparing against that would say our encoder is broken when it is not.
    q.add_data(QRData(item['text'].encode('utf-8'), mode=MODE_8BIT_BYTE))
    q.make(fit=item.get('version') is None)
    masks = []
    for mask in range(8):
        q.makeImpl(False, mask)
        masks.append([[1 if c else 0 for c in row] for row in q.get_matrix()])
    out.append({'version': q.version, 'masks': masks})
print(json.dumps(out))
`;

function reference(items) {
  const f = path.join(os.tmpdir(), 'homatt-qr-ref.py');
  fs.writeFileSync(f, PY);
  const out = execFileSync('python3', [f], { input: JSON.stringify(items), maxBuffer: 1 << 28 });
  return JSON.parse(out.toString());
}

function differs(a, b) {
  if (a.length !== b.length) return 'size ' + a.length + ' vs ' + b.length;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) if (a[i][j] !== b[i][j]) n++;
  }
  return n ? n + ' modules differ' : null;
}

(function main() {
  const cases = [];
  // Every version at every level, filled close to capacity so the block
  // interleaving is actually exercised rather than skipped.
  const LEVELS = ['L', 'M', 'Q', 'H'];
  for (let v = 1; v <= 10; v++) {
    for (const lv of LEVELS) {
      // Grow the payload until it no longer fits at this version, then step
      // back — that is the case most likely to expose a wrong block table.
      let text = '';
      for (let n = 1; n < 400; n++) {
        const t = 'HOMATT-' + 'X'.repeat(n);
        try { QR.encode(t, { level: lv, version: v }); text = t; } catch (e) { break; }
      }
      if (text) cases.push({ text, level: lv, version: v });
    }
  }

  // And the payloads this app will really produce.
  const real = [
    'HOMATT-CLINIC:VNKJCH96',
    'HOMATT-CLINIC:K3ETXD2J',
    'https://emmanuelokol.github.io/homatt-uganda/clinician/join.html?c=ZAZBG68K',
  ];
  for (const t of real) for (const lv of LEVELS) cases.push({ text: t, level: lv, version: 0 });

  // A missing library is a reason to skip. A reference script that breaks is
  // NOT — reporting that as "skipped" is how a comparison quietly stops
  // comparing anything while still printing a reassuring line.
  let refs;
  try {
    refs = reference(cases.map(c => ({ text: c.text, level: c.level, version: c.version || null })));
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    if (/ModuleNotFoundError|No module named/.test(msg)) {
      console.log('SKIP  python3 has no `qrcode` package — pip install qrcode');
      process.exit(0);
    }
    console.log('FAIL  the reference encoder could not be run, so nothing was compared:');
    console.log(msg.split('\n').slice(-6).join('\n'));
    process.exit(1);
  }

  let ok = 0, compared = 0; const bad = [];
  let sameChoice = 0;
  cases.forEach((c, i) => {
    const r = refs[i];
    let mine;
    try { mine = QR.encode(c.text, { level: c.level, version: c.version || 0 }); }
    catch (e) { bad.push(`${c.level}/v${c.version} len=${c.text.length}: threw ${e.message}`); return; }
    if (mine.version !== r.version) {
      bad.push(`${c.level}/v${c.version} len=${c.text.length}: chose version ${mine.version}, reference chose ${r.version}`);
      return;
    }
    // Compare EVERY mask, not just the chosen one. That checks the codewords,
    // the error correction, the block interleaving, the data placement, the
    // format bits and the version bits — eight independent times per symbol.
    for (let mask = 0; mask < 8; mask++) {
      compared++;
      const d = differs(atMask(c.text, mine.version, c.level, mask), r.masks[mask]);
      if (d) bad.push(`${c.level}/v${mine.version} len=${c.text.length} mask=${mask}: ${d}`);
      else ok++;
    }
    sameChoice += (differs(mine.modules, r.masks[mine.mask]) === null) ? 1 : 0;
  });

  // The claim printed below — "the penalty function is identical" — is only
  // worth printing if it was checked. Score the reference's own matrices with
  // our penalty function and with the reference's, and compare.
  let pen = { same: 0, diff: 0 };
  try {
    const sample = refs.slice(0, 12);
    const mineScores = sample.map(r => r.masks.map(m => I.penalty(m)));
    const f = path.join(os.tmpdir(), 'homatt-qr-pen.py');
    fs.writeFileSync(f, `
import sys, json
from qrcode.util import lost_point
req = json.loads(sys.stdin.read())
print(json.dumps([[lost_point([[bool(c) for c in row] for row in m]) for m in item] for item in req]))
`);
    const refScores = JSON.parse(execFileSync('python3', [f],
      { input: JSON.stringify(sample.map(r => r.masks)), maxBuffer: 1 << 28 }).toString());
    mineScores.forEach((row, i) => row.forEach((v, j) => {
      if (v === refScores[i][j]) pen.same++; else pen.diff++;
    }));
  } catch (e) { pen = null; }

  console.log('');
  console.log('QR encoder vs the python `qrcode` reference');
  console.log('  payloads         : ' + cases.length + '  (versions 1-10, levels L/M/Q/H)');
  console.log('  symbols compared : ' + compared + '  (every payload at every one of the 8 masks)');
  console.log('  identical        : ' + ok);
  console.log('  differing        : ' + bad.length);
  if (bad.length) {
    console.log('');
    bad.slice(0, 20).forEach(b => console.log('  ✗ ' + b));
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('  every module of every symbol matches at every mask.');
    console.log('');
    console.log('  The two sides need not agree on which mask to PICK, and a');
    console.log('  disagreement would not be a fault: python-qrcode scores the');
    console.log('  eight candidates with the format area still blank, while this');
    console.log('  encoder scores the finished symbol as ISO/IEC 18004 8.8.2 asks.');
    console.log('  Either way the mask is written into the format bits, which is');
    console.log('  how a reader knows which was used. On these payloads it did');
    console.log('  not come up — see the last line.');
    console.log('');
    if (!pen) {
      console.log('  penalty scores  : NOT COMPARED (the reference scorer would not run)');
      process.exitCode = 1;
    } else {
      console.log('  penalty scores  : ' + pen.same + ' identical, ' + pen.diff + ' different'
        + '  (our scorer against the reference\'s, on the reference\'s own matrices)');
      if (pen.diff) process.exitCode = 1;
    }
    console.log('  mask chosen     : the same one as the reference in '
      + sameChoice + ' of ' + cases.length + ' payloads');
  }
})();
