// What 50 KB actually buys, at the detail a clinical photograph really has.
//
// This is not a test and prints no PASS/FAIL. The question it answers is the
// one the ceiling raises: a wound photograph is only worth taking if a
// clinician can still see the margin of the lesion in it, and "under 50 KB" is
// a promise about the file, not about the picture.
//
// The camera Chromium fakes is a smooth synthetic pattern that compresses to
// almost nothing, so it flatters the ladder badly. The images below span the
// range instead — from a flat gradient (what a photograph of a chest X-ray on
// a lightbox looks like to an encoder) through multi-octave texture (skin,
// which is what most of these will be) to pure noise (worse than anything a
// camera can produce, included as the floor).
//
//     node tests/measure-photo.js
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP = path.join(__dirname, '..', 'app');
const PORT = 8958, ORIGIN = 'http://localhost:' + PORT;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ url: '/clinic/js/clinic-photo.js' });

  const rows = await page.evaluate(async () => {
    const W = 1280, H = 960;

    // A deterministic value-noise field, so the numbers are the same on every
    // machine and a change in them means a change in the encoder or the ladder.
    function field(seed) {
      let s = seed >>> 0;
      return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    function octaves(n, amp) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#c98d76'; cx.fillRect(0, 0, W, H);       // a skin-ish base
      const rnd = field(20260912);
      for (let o = 0; o < n; o++) {
        const cell = 128 >> o;
        for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
          const v = Math.round((rnd() - 0.5) * amp * 255 / (o + 1));
          cx.fillStyle = 'rgba(' + (128 + v) + ',' + (110 + v) + ',' + (105 + v) + ',0.5)';
          cx.fillRect(x, y, cell, cell);
        }
      }
      return cv;
    }
    function gradient() {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      const g = cx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#f2e2d8'); g.addColorStop(1, '#7a3b30');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.fillStyle = 'rgba(120,20,20,.55)';
      cx.beginPath(); cx.ellipse(W * .5, H * .5, 220, 160, 0.4, 0, 7); cx.fill();
      return cv;
    }
    function noise() {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'); const d = cx.createImageData(W, H);
      const rnd = field(7);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = rnd() * 255; d.data[i+1] = rnd() * 255; d.data[i+2] = rnd() * 255; d.data[i+3] = 255;
      }
      cx.putImageData(d, 0, 0); return cv;
    }

    /* Sensor grain over the texture, which is the part that actually costs.
     * A drawn image is far cleaner than anything a phone camera produces: the
     * octave fields above come out at 9-16 KB, while a real 1280x960 frame at
     * q0.60 is more like 100-250 KB, and almost all of the difference is
     * per-pixel noise from the sensor. Leaving it out would have made this
     * measurement say the ladder is never needed. */
    function grain(cv, amp) {
      const cx = cv.getContext('2d');
      const d = cx.getImageData(0, 0, W, H);
      const rnd = field(99991);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (rnd() - 0.5) * amp;
        d.data[i] = Math.max(0, Math.min(255, d.data[i] + n));
        d.data[i+1] = Math.max(0, Math.min(255, d.data[i+1] + n * 0.9));
        d.data[i+2] = Math.max(0, Math.min(255, d.data[i+2] + n * 1.1));
      }
      cx.putImageData(d, 0, 0); return cv;
    }

    const CASES = [
      ['a flat lesion on even skin  (gradient)', gradient()],
      ['ordinary skin texture       (3 octaves)', octaves(3, 0.35)],
      ['coarse wound / dressing     (5 octaves)', octaves(5, 0.7)],
      ['skin + daylight sensor grain           ', grain(octaves(3, 0.35), 26)],
      ['skin + dim-room sensor grain           ', grain(octaves(3, 0.35), 60)],
      ['pure noise — worse than any camera     ', noise()],
    ];

    const out = [];
    for (const [name, cv] of CASES) {
      // What it would cost with NO ladder at all, at full size and medium
      // quality — the number the ceiling is being compared against.
      const plain = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.6));
      const got = await window.HomattPhoto._encode(cv, W, H);
      out.push({ name, plain: plain.size, bytes: got.bytes, w: got.w, h: got.h,
                 q: got.q, under: got.under });
    }
    return out;
  });

  const kb = n => (n / 1024).toFixed(1).padStart(6) + ' KB';
  console.log('');
  console.log('  50 KB, and what it costs — 1280x960 source, ' + rows.length + ' kinds of picture');
  console.log('  ' + '-'.repeat(76));
  console.log('  what it is                                 at q0.60   kept as        size');
  for (const r of rows) {
    console.log('  ' + r.name + ' ' + kb(r.plain) + '  ' +
      String(r.w + 'x' + r.h).padEnd(9) + ' q' + r.q.toFixed(2) + '  ' + kb(r.bytes) +
      (r.under ? '' : '   OVER'));
  }
  console.log('  ' + '-'.repeat(76));
  const kept = rows.filter(r => Math.max(r.w, r.h) >= 1024).length;
  console.log('  kept at 1024px or better: ' + kept + ' of ' + rows.length +
    '   ·   all under 50 KB: ' + rows.every(r => r.under));
  console.log('');

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
