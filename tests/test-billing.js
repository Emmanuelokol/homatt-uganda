// The bill must follow the list.
//
// Before this, "Total Charged" was two empty boxes: removing a lab test or
// crossing out a medicine changed nothing, because the total was never derived
// from them. A clinician could take four drugs off a package and still charge
// the patient for them. This drives the real package with real priced stock and
// checks the figure moves both ways.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const num = s => Number(String(s || '').replace(/[^0-9]/g, '')) || 0;

(async () => {
  await new Promise(r => server.listen(8947, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8947')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  await page.goto('http://localhost:8947/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);

  await page.goto('http://localhost:8947/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#confirmedDx', { timeout: 20000 });
  // A shelf with real selling prices, so medicines have something to cost.
  await page.evaluate(() => {
    window._stockItems = [
      { id: 's1', item_name: 'Ciprofloxacin', item_type: 'medicine', is_active: true, selling_price: 500,  quantity: 200 },
      { id: 's2', item_name: 'Ceftriaxone',   item_type: 'medicine', is_active: true, selling_price: 9000, quantity: 20 },
      { id: 's3', item_name: 'Doxycycline',   item_type: 'medicine', is_active: true, selling_price: 300,  quantity: 100 },
    ];
    if (window._wizState) window._wizState.clinicInventory = window._stockItems;
  });
  await page.fill('#confirmedDx', 'Typhoid');
  await page.click('#ucgOneTap');
  await page.waitForTimeout(4500);

  const read = () => page.evaluate(() => ({
    total: (document.getElementById('ucgTotal') || {}).textContent || '',
    lab:   (document.getElementById('ucgFeeL') || {}).value,
    meds:  (document.getElementById('ucgFeeM') || {}).value,
    tests: [...document.querySelectorAll('[data-rmtest]')].length,
    on:    [...document.querySelectorAll('.ucg-drug.on')].length,
    onNames: [...document.querySelectorAll('.ucg-drug.on')].map(r => (r.textContent||'').slice(0,18)).join('/'),
    unpriced: !!document.querySelector('.ucg-unpriced'),
  }));

  const dbg = await page.evaluate(() => ({
    ticks: document.querySelectorAll('[data-tick]').length,
    rows: document.querySelectorAll('.ucg-drug').length,
    tickInsideRow: !!(document.querySelector('.ucg-drug [data-tick]')),
    stock: (window._stockItems||[]).length,
    stateStock: ((window._wizState||{}).clinicInventory||[]).length,
  }));
  console.log('  [dbg]', JSON.stringify(dbg));
  const a = await read();
  result('the package arrives already priced, not at zero',
    num(a.total) > 0 && num(a.meds) > 0, JSON.stringify(a));

  // Tick a second medicine the clinic actually stocks and prices — Ceftriaxone
  // at 9000 each — so there is a real figure to expect. This used to tick
  // Doxycycline, which the typhoid package only carried because page-range
  // slicing had handed it a neighbouring section's drug list.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ucg-drug:not(.on)')]
      .find(r => /ceftriaxone/i.test(r.textContent || ''));
    const btn = row && row.querySelector('[data-tick]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  const b2 = await read();
  result('ticking another medicine puts its price on the bill',
    num(b2.meds) > num(a.meds) && num(b2.total) > num(a.total),
    a.meds + ' -> ' + b2.meds + '  ticked=' + b2.on + ' [' + b2.onNames + ']');

  // Untick it again — the figure must come back DOWN to where it was.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ucg-drug.on')]
      .find(r => /ceftriaxone/i.test(r.textContent || ''));
    const btn = row && row.querySelector('[data-tick]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  const c = await read();
  result('crossing a medicine out takes its price back off',
    num(c.meds) === num(a.meds) && num(c.total) === num(a.total),
    b2.meds + ' -> ' + c.meds + '  (total ' + b2.total + ' -> ' + c.total + ')');

  // Remove a lab test — the lab figure must drop.
  await page.evaluate(() => {
    const rm = document.querySelector('[data-rmtest]');
    if (rm) rm.click();
  });
  await page.waitForTimeout(600);
  const d = await read();
  result('removing a lab test takes its price off too',
    num(d.lab) < num(c.lab) && num(d.total) < num(c.total),
    c.lab + ' -> ' + d.lab + '  (total ' + c.total + ' -> ' + d.total + ')');

  // Changing the quantity must reprice, not stay at the old number.
  const before = await read();
  await page.evaluate(() => {
    const inp = document.querySelector('.ucg-drug.on input[data-qt]');
    if (inp) { inp.value = String((Number(inp.value) || 1) + 10); inp.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(600);
  const e = await read();
  result('changing the quantity changes what is charged',
    num(e.meds) > num(before.meds), before.meds + ' -> ' + e.meds);

  // A medicine the clinic has never priced must say so, not be silently free.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ucg-drug:not(.on)')]
      .find(r => /chloramphenicol/i.test(r.textContent || ''));
    const btn = row && row.querySelector('[data-tick]');
    if (btn) btn.click();                       // stocked by nobody -> no price
  });
  await page.waitForTimeout(600);
  const f = await read();
  result('an unpriced medicine is called out, never silently free',
    f.unpriced === true, 'warning shown: ' + f.unpriced + ' (meds ' + f.meds + ')');

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
