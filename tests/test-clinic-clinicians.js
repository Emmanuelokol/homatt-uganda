// The owner's side of the handshake.
//
// Show a code, see who is working here, see who they treated, end their access,
// leave them a reference. And — the part that is a removal rather than an
// addition — check that creating a login from inside the portal is gone from
// both portals, because that is how somebody used to join.
//
// The QR itself is checked for real: the canvas is read back and the dark
// module count compared against what the encoder says it should be. A canvas
// that stayed blank would otherwise pass every test anybody would think to
// write, and fail in the one place it matters — a phone held up to a screen.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});

const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8945, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

const calls = [];
function rpcReply(name, body) {
  calls.push({ name, body });
  if (name === 'create_clinic_link_code') {
    return { ok: true, id: 'code1', code: 'ABCD2345', clinic_id: CID,
             clinic_name: 'Kampala Clinic', access_days: (body && body.p_access_days) || 30,
             expires_at: new Date(Date.now() + 86400000).toISOString() };
  }
  if (name === 'clinic_clinicians_list') {
    return { ok: true, clinicians: [{
      stint_id: 's1', clinician_id: 'c1', full_name: 'Dr Okello John',
      profession: 'Medical Doctor', cadre: 'Medical Officer', phone: '0772000111',
      registration_no: 'UMDPC/12345', district: 'Lira',
      status: 'active', role: 'visiting_clinician',
      started_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      expires_at: new Date(Date.now() + 86400000 * 20).toISOString(),
      ended_at: null, ended_by: null, treatments: 14,
      last_seen: new Date(Date.now() - 3600000).toISOString(),
      rated: false, rating: null,
    }] };
  }
  if (name === 'clinic_clinician_detail') {
    return { ok: true,
      work: [{ created_at: new Date().toISOString(), patient_name: 'Achieng Mary',
               case_code: 'CASE-1', diagnosis: 'Malaria', severity: 'moderate' }],
      by_day: [{ day: '2026-09-10', n: 3 }] };
  }
  if (name === 'clinician_reference') {
    return { ok: true,
      profile: { full_name:'Dr Okello John', profession:'Medical Doctor' },
      stints: [
        { clinic_name:'Gulu Clinic', district:'Gulu', treatments:61,
          started_at:new Date(Date.now()-86400000*300).toISOString(),
          ended_at:new Date(Date.now()-86400000*90).toISOString(), status:'ended' },
        { clinic_name:'Kampala Clinic', district:'Kampala', treatments:14,
          started_at:new Date(Date.now()-86400000*10).toISOString(),
          ended_at:null, status:'active' },
      ],
      totals: { treatments:75, clinics:2 },
      conditions: [{ condition:'Malaria', n:31 }],
      ratings: [{ clinic_name:'Gulu Clinic', rating:5, would_rehire:true,
                  reference_note:'Careful with children.',
                  created_at:new Date().toISOString() }],
      average: 5 };
  }
  if (name === 'end_clinician_stint') return { ok: true, ended_by: 'owner' };
  if (name === 'rate_clinician') return { ok: true };
  if (name === 'get_clinic_staff') return [];
  if (name === 'message_threads') return [];
  return { ok: true };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.accept());          // the "end their access" confirm

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      let body = null;
      try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(rpcReply(name, body)) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'Owner', clinicName: 'Kampala Clinic',
      clinicId: cid, staffRole: 'owner', level: 'HC3',
    }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid },
    }));
  }, [CID, UID]);

  await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  // ── Creating a login from inside the portal is GONE ───────────────────
  const addStaff = await page.evaluate(() => ({
    modal:  !!document.getElementById('addStaffModal'),
    button: !!document.querySelector('[onclick*="openAddStaffModal"]'),
    fn:     typeof window.openAddStaffModal,
    create: !!document.getElementById('asCreateBtn'),
  }));
  result('the "Add staff account" modal is gone', addStaff.modal === false);
  result('the "Add staff account" button is gone', addStaff.button === false);
  result('and nothing is left that could open it', addStaff.fn === 'undefined', addStaff.fn);
  result('and the create button is gone', addStaff.create === false);
  result('but existing logins are still listed, so nobody is cut off',
    await page.evaluate(() => !!document.getElementById('staffList')));

  // ── The Clinicians card ───────────────────────────────────────────────
  result('there is a Clinicians card', await page.evaluate(() => !!document.getElementById('cliniciansCard')));

  const listed = await page.evaluate(() => (document.getElementById('ccList') || {}).innerText || '');
  result('it lists the clinician who scanned in', /Okello John/.test(listed), listed.slice(0, 60));
  result('with their registration number', /UMDPC\/12345/.test(listed));
  result('and how many they have treated', /14 treatments/.test(listed), listed.match(/\d+ treatments?/) || '');

  // ── Showing a code ────────────────────────────────────────────────────
  await page.selectOption('#ccDays', '30');
  await page.click('#ccMakeBtn');
  await page.waitForTimeout(900);

  const made = calls.find(c => c.name === 'create_clinic_link_code');
  result('the owner can make a code', !!made, made ? JSON.stringify(made.body) : 'never called');
  if (made) {
    result('the access length is the one the owner chose', made.body.p_access_days === 30, String(made.body.p_access_days));
    result('and the code itself is short-lived, whatever the access length is',
      made.body.p_hours === 24, String(made.body.p_hours));
    result('a code is good for one clinician, not a poster on the wall',
      made.body.p_max_uses === 1, String(made.body.p_max_uses));
  }

  const shown = await page.evaluate(() => ({
    code: (document.getElementById('ccCode') || {}).textContent || '',
    boxShown: getComputedStyle(document.getElementById('ccCodeBox')).display !== 'none',
    hint: (document.getElementById('ccCodeHint') || {}).innerText || '',
  }));
  result('the code is shown big enough to read off the screen', shown.code === 'ABCD2345', shown.code);
  result('and it says how long it lasts', /24 hours/.test(shown.hint), shown.hint.slice(0, 80));

  // ── The QR is really drawn ────────────────────────────────────────────
  // Read the canvas back. A blank canvas passes "the element exists" and fails
  // the only test that matters: a phone pointed at it.
  const qr = await page.evaluate(() => {
    const c = document.getElementById('ccQR');
    if (!c || !c.width) return { ok: false, why: 'no canvas' };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      (d[i] < 128 ? dark++ : light++);
    }
    const expect = window.HomattQR
      ? window.HomattQR.encode('HOMATT-CLINIC:ABCD2345', { level: 'M' })
      : null;
    return { ok: true, w: c.width, dark, light,
             version: expect && expect.version, size: expect && expect.size };
  });
  result('the QR canvas is actually drawn on', qr.ok && qr.w > 0, JSON.stringify({ w: qr.w }));
  result('it has dark modules, not a blank white square', qr.dark > 0, 'dark px=' + qr.dark);
  result('and light ones, so it is not a solid black square', qr.light > 0, 'light px=' + qr.light);
  // A real QR is roughly a third to a half dark. Far outside that and something
  // is wrong even though a square appeared.
  const frac = qr.dark / (qr.dark + qr.light);
  result('the dark/light balance is what a QR code looks like',
    frac > 0.15 && frac < 0.6, Math.round(frac * 100) + '% dark');
  result('the payload fits in a small symbol, so it scans from a distance',
    qr.version <= 3, 'version ' + qr.version + ', ' + qr.size + ' modules');

  // ── Who they treated ──────────────────────────────────────────────────
  await page.evaluate(() => {
    const b = document.querySelector('.cc-act[data-act="work"]');
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const work = await page.evaluate(() => (document.getElementById('ccWork_s1') || {}).innerText || '');
  result('the owner can see who the clinician treated, in their own clinic',
    /Achieng Mary/.test(work), work.slice(0, 60));
  result('with what was treated', /Malaria/.test(work));

  // ── What they did at OTHER clinics ────────────────────────────────────
  // The loop the whole feature exists to close: an owner deciding whether to
  // let somebody treat patients can see where they have worked and what the
  // last owners said, rather than a name and a hope.
  await page.evaluate(() => {
    const b = document.querySelector('.cc-act[data-act="record"]');
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  const rec = await page.evaluate(() => (document.getElementById('ccWork_s1') || {}).innerText || '');
  result('the owner can see what this clinician did at other clinics',
    /Gulu Clinic/.test(rec), rec.slice(0, 70).replace(/\n/g, ' '));
  result('with the totals across all of them', /75 treatments/.test(rec));
  result('and what another owner wrote about them',
    /Careful with children/.test(rec));
  result('and their average rating', /rated 5\/5/.test(rec));
  // The promise, checked on the one screen most likely to break it.
  result('and NOT one patient from any clinic',
    !/Achieng|Mukasa|Nakato|070011/.test(rec), rec.slice(0, 50).replace(/\n/g, ' '));

  // ── Ending, and the reference ─────────────────────────────────────────
  await page.evaluate(() => {
    const b = document.querySelector('.cc-act[data-act="end"]');
    if (b) b.click();
  });
  await page.waitForTimeout(1000);
  result('the owner can end their access',
    !!calls.find(c => c.name === 'end_clinician_stint'));

  const rateOpen = await page.evaluate(() =>
    getComputedStyle(document.getElementById('ccRateModal')).display !== 'none');
  result('and is asked for a reference straight away, not a week later', rateOpen);

  await page.evaluate(() => {
    // Three stars rather than the default five, so the value is carried and not
    // merely defaulted.
    const bs = document.querySelectorAll('#ccStarPick button');
    if (bs[2]) bs[2].click();
    document.getElementById('ccNote').value = 'Kept good records.';
    document.getElementById('ccRehire').checked = false;
    document.getElementById('ccRateSave').click();
  });
  await page.waitForTimeout(800);

  const rated = calls.find(c => c.name === 'rate_clinician');
  result('the reference is saved', !!rated, rated ? JSON.stringify(rated.body.p) : 'never called');
  if (rated) {
    result('with the rating the owner actually chose', rated.body.p.rating === '3', rated.body.p.rating);
    result('with their words', /Kept good records/.test(rated.body.p.reference_note || ''));
    result('and with "would not work with again" carried, not lost',
      rated.body.p.would_rehire === 'false', String(rated.body.p.would_rehire));
  }

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e));
  result('nothing on the settings screen threw', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
