// What colour is --primary actually, per skin and theme, and what text can sit
// on it? Measured rather than guessed.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    const ext = path.extname(p);
    rs.writeHead(200, { 'Content-Type': ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html' });
    rs.end(d);
  });
});
(async () => {
  await new Promise(r => server.listen(8969, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.route('**/*', r => r.request().url().startsWith('http://localhost:8969') ? r.continue() : r.abort());
  await page.setContent(`<link rel="stylesheet" href="http://localhost:8969/clinic/css/clinic.css"><div class="x"></div>`);
  await page.waitForTimeout(400);
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      const r = await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
        const cs = getComputedStyle(document.documentElement);
        const get = k => cs.getPropertyValue(k).trim();
        const hex = (c) => {
          const d = document.createElement('div'); d.style.color = c;
          document.body.appendChild(d);
          const v = getComputedStyle(d).color; d.remove(); return v;
        };
        const lum = (c) => { const m = hex(c).match(/[\d.]+/g).map(Number);
          const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        const ratio = (a,c) => { const x=lum(a), y=lum(c);
          return ((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2); };
        const out = {};
        ['--primary','--primary-d','--deep','--brand-tint','--brand-ink','--surface','--text','--border','--success','--danger','--warning','--info','--text-lt','--bg'].forEach(k => out[k]=get(k));
        out.white_on_primary = ratio('#ffffff', get('--primary'));
        out.black_on_primary = ratio('#0B120E', get('--primary'));
        out.white_on_deep = ratio('#ffffff', get('--deep'));
        out.brandink_on_tint = ratio(get('--brand-ink'), get('--brand-tint'));
        out.text_on_surface = ratio(get('--text'), get('--surface'));
        return out;
      }, [skin, theme]);
      console.log(skin+'/'+theme,
        'primary', r['--primary'],
        '| white', r.white_on_primary, 'black', r.black_on_primary,
        '| deep', r['--deep'], 'white-on-deep', r.white_on_deep,
        '| tint', r.brandink_on_tint);
    }
  }
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
