// The clinical camera on a patient's file.
//
// Four claims are being made, and each of them is the kind that reads as true
// and can quietly be false:
//
//   1. "It never goes to the gallery." The proof is that there is no file
//      input and no Intent anywhere in the sheet — the frame arrives as a
//      MediaStream and leaves as canvas pixels. A single <input type="file"
//      capture> would undo the whole feature on most Android builds, because
//      the camera app writes to MediaStore before handing back a copy.
//
//   2. "No location data." Asserted structurally, by segment IDENTITY rather
//      than segment number: every APPn block in the file is listed with the
//      name written inside it, and the only two allowed are "JFIF" (the
//      header) and "ICC_PROFILE" (a 472-byte generic sRGB profile Chromium's
//      encoder writes, which says how to interpret the colours and nothing
//      about who or where). Exif, XMP and IPTC — the three places a GPS tag
//      can live — must be absent. Grepping the bytes for "GPS" would pass on
//      a tag stored under a name I had not thought of; this cannot.
//
//      The first version of this test asserted "APP0 and nothing else" and
//      failed on the colour profile. Worth keeping in mind: a metadata check
//      written as "no extra segments" will fail on something harmless and
//      tempt whoever inherits it into loosening it to "no segment I have seen
//      before", which is how a real one gets through.
//
//   3. "Under 50 KB." The camera Chromium fakes is a smooth synthetic pattern
//      that would compress under the limit at any setting, so it proves
//      nothing on its own. The ladder is therefore also driven with 2000x1500
//      of random noise — the worst case JPEG has, an image with no
//      correlation between neighbouring pixels at all.
//
//   4. ".nomedia goes in first." Not just that it is written, but that it is
//      written BEFORE the first photograph lands in the folder. A marker that
//      arrives second leaves a window in which a scanner can index the folder,
//      and once indexed, adding the marker does not remove what it took.
//
// Plus the layout, at 360px, which is the phone this is used on.
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
const PORT = 8957, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Every APPn segment in a JPEG, named by the identifier written INSIDE it.
// Walks the marker chain rather than searching the bytes, so an Exif block
// cannot hide behind a marker number nobody checked.
function appSegments(buf) {
  const b = Buffer.from(buf);
  const out = [];
  if (b[0] !== 0xFF || b[1] !== 0xD8) return ['NOT-A-JPEG'];
  let i = 2;
  while (i < b.length - 3) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xDA || m === 0xD9) break;          // image data / end
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    if (m >= 0xE0 && m <= 0xEF) {
      const id = b.slice(i + 4, i + 4 + 32).toString('latin1').split('\0')[0]
        .replace(/[^\x20-\x7e]/g, '').trim();
      out.push('APP' + (m - 0xE0) + '(' + (id || '?') + ')');
    }
    if (m === 0xFE) out.push('COM');
    i += 2 + len;
  }
  return out;
}

// The only two blocks allowed in a photograph of a patient.
const ALLOWED = /^APP0\(JFIF\)$|^APP2\(ICC_PROFILE\)$/;
// Where a location tag could live if one existed.
const CARRIERS = /Exif|xap|xmp|adobe|Photoshop|IPTC|MPF|FPXR/i;

const VISIT = {
  id: 'visit-cam-1', patient_name: 'Nabirye Sarah', patient_phone: '0772000333',
  confirmed_diagnosis: 'Cellulitis', severity: 'moderate', patient_age: 34,
  created_at: new Date().toISOString(),
  total_charged_ugx: 20000, amount_paid: 20000, payment_status: 'paid',
  prescription_items: [], lab_tests_ordered: [],
};

// The contrast helper, same as test-readable.js: composite every translucent
// layer before measuring, or a dark-mode wash reads as opaque white.
const MEASURE_IN = (sel) => {
  function parse(c){var m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x)});
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function over(f,b){var a=f.a;return{r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
  function rel(c){function ch(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);}
  function ratio(a,b){var l1=rel(a),l2=rel(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  function bgOf(el){var stack=[],node=el,grad=false;
    while(node&&node.nodeType===1){var cs=getComputedStyle(node);
      if(cs.backgroundImage&&cs.backgroundImage!=='none')grad=true;
      var c=parse(cs.backgroundColor);
      if(c&&c.a>0){stack.push(c);if(c.a>=0.999)break;}
      node=node.parentElement;}
    var base={r:255,g:255,b:255,a:1},last=stack[stack.length-1];
    if(last&&last.a>=0.999){base=last;stack.pop();}
    for(var i=stack.length-1;i>=0;i--)base=over(stack[i],base);
    return {bg:base,gradient:grad};}
  function ownText(el){var t='';for(var i=0;i<el.childNodes.length;i++)
    if(el.childNodes[i].nodeType===3)t+=el.childNodes[i].nodeValue;return t.trim();}
  var root=document.querySelector(sel); if(!root) return {n:0,bad:['no sheet']};
  var bad=[],n=0,all=root.querySelectorAll('*');
  for(var i=0;i<all.length;i++){var el=all[i],text=ownText(el);
    if(!text||text.length<2)continue;
    var cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden')continue;
    if(parseFloat(cs.opacity)<0.25)continue;
    var r=el.getBoundingClientRect(); if(r.width<4||r.height<4)continue;
    var fg=parse(cs.color); if(!fg)continue;
    var b=bgOf(el); if(b.gradient)continue;
    if(fg.a<1)fg=over(fg,b.bg);
    var size=parseFloat(cs.fontSize)||14,weight=parseInt(cs.fontWeight,10)||400;
    var need=(size>=24||(size>=18.66&&weight>=700))?3:4.5;
    var got=ratio(fg,b.bg); n++;
    if(got<need)bad.push(text.slice(0,26).replace(/\s+/g,' ')+' ('+Math.round(got*100)/100+':1)');
  }
  return {n:n,bad:bad};
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({
    executablePath: CHROME,
    // A synthetic camera, and the permission prompt answered for us. Without
    // the fake device getUserMedia rejects with NotFoundError on a CI box and
    // every assertion below would be measuring the error message.
    args: ['--no-sandbox', '--use-fake-device-for-media-stream',
           '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await b.newContext({ viewport: { width: 360, height: 720 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  /* Anything carrying the PICTURE off the phone is counted.
   *
   * Not "any POST": the dashboard polls its own RPCs (message_threads,
   * get_pending_payments) with POST because that is how PostgREST calls a
   * function, and counting those reported an upload that never happened. What
   * matters is whether the PICTURE travels, so the rule is about the body and
   * not about the URL: a request carries an image if its bytes contain a JPEG
   * — raw (FF D8 FF, anywhere, so a multipart envelope is caught too) or
   * base64 ("/9j/", which is what FF D8 FF encodes to).
   *
   * Two URL-shaped versions of this check were wrong before this one. "Any
   * POST" counted the dashboard's own RPC polling, because PostgREST calls a
   * function with POST. "Any storage call" counted a GET of the clinic's logo,
   * which is a download. "Any non-GET storage call" counted
   * /object/sign/…/portrait.jpg, which is a POST that asks for a link to READ
   * something and sends no picture at all. The body knows; the URL guesses. */
  const outbound = [];
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    let body = null;
    try { body = r.request().postDataBuffer(); } catch (e) {}
    if (body && body.length) {
      const raw = body.toString('latin1');
      if (raw.indexOf('\xFF\xD8\xFF') >= 0) outbound.push('a JPEG in the body of ' + u);
      else if (raw.indexOf('/9j/') >= 0) outbound.push('a base64 JPEG in the body of ' + u);
    }
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D', clinicName: 'K', clinicId: cid, staffRole: 'owner', level: 'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  // ── 0. The module is there ───────────────────────────────────────────
  const mod = await page.evaluate(() => ({
    there: !!window.HomattPhoto,
    may: window.HomattPhoto ? window.HomattPhoto.may() : null,
    limit: window.HomattPhoto ? window.HomattPhoto.LIMIT : 0,
    nomedia: window.HomattPhoto ? window.HomattPhoto.NOMEDIA : '',
  }));
  result('the clinical camera is loaded', mod.there === true);
  result('an owner may use it', mod.may === true);
  result('the ceiling is 50 KB', mod.limit === 51200, mod.limit + ' bytes');

  // ── 1. It is reachable from the patient file ─────────────────────────
  const entry = await page.evaluate(async (v) => {
    window._activeDetailContext = { current: v, history: [] };
    const modal = document.getElementById('histModal');
    if (modal) modal.style.display = 'flex';
    renderActiveDetailView();
    await new Promise(r => setTimeout(r, 400));
    const btn = document.querySelector('[data-action="clinic-photo"]');
    const hero = document.querySelector('.pr-hero');
    const body = document.querySelector('#histModalBody');
    return {
      there: !!btn,
      inHero: !!(btn && hero && hero.contains(btn)),
      // The record already measures to the millimetre against the modal it
      // sits in; a new full-width button here pushed it 50px over once before.
      recordH: body ? Math.round(body.scrollHeight) : 0,
      roomH: body ? Math.round(body.clientHeight) : 0,
    };
  }, VISIT);
  result('the patient file offers a camera', entry.there === true);
  result('and it is an icon in a row that already existed, not a new block',
    entry.inHero === true);

  // ── 2. Opening it gives OUR viewport, not the phone's camera app ─────
  await page.evaluate(() => document.querySelector('[data-action="clinic-photo"]').click());
  await page.waitForTimeout(1400);

  const sheet = await page.evaluate(() => {
    const s = document.getElementById('cpSheet');
    if (!s) return { there: false };
    const v = document.getElementById('cpVideo');
    return {
      there: true,
      open: getComputedStyle(s).display !== 'none',
      live: !!document.querySelector('.cp-view.live'),
      streaming: !!(v && v.srcObject && v.srcObject.getVideoTracks().length > 0),
      fileInputs: s.querySelectorAll('input[type="file"]').length,
      captureAttrs: s.querySelectorAll('[capture]').length,
      msg: (document.getElementById('cpMsg') || {}).textContent || '',
    };
  });
  result('the sheet opens', sheet.there && sheet.open, sheet.msg);
  result('with a LIVE stream in the page — our own viewport',
    sheet.live === true && sheet.streaming === true);
  result('and no file picker or capture input anywhere in it — the gallery is never involved',
    sheet.fileInputs === 0 && sheet.captureAttrs === 0,
    sheet.fileInputs + ' file inputs, ' + sheet.captureAttrs + ' capture attrs');

  // ── 3. The split layout, measured at 360px ───────────────────────────
  const lay = await page.evaluate(() => {
    const s = document.getElementById('cpSheet').getBoundingClientRect();
    const view = document.querySelector('.cp-view').getBoundingClientRect();
    const ta = document.getElementById('clinical_findings_notes').getBoundingClientRect();
    const save = document.getElementById('cpSave').getBoundingClientRect();
    const over = [];
    document.querySelectorAll('#cpSheet button, #cpSheet textarea, #cpSheet video, #cpSheet img')
      .forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 && r.height < 2) return;
        if (r.right - s.right > 1 || s.left - r.left > 1) {
          over.push((el.id || el.className) + ' by ' + Math.round(Math.max(r.right - s.right, s.left - r.left)));
        }
      });
    return {
      sheetW: Math.round(s.width), sheetH: Math.round(s.height),
      viewH: Math.round(view.height), taTop: Math.round(ta.top), viewBottom: Math.round(view.bottom),
      taH: Math.round(ta.height), saveBottom: Math.round(save.bottom),
      innerH: window.innerHeight, over,
    };
  });
  result('the photograph is ON TOP and the notes UNDERNEATH',
    lay.taTop >= lay.viewBottom, 'preview ends at ' + lay.viewBottom + ', notes start at ' + lay.taTop);
  result('the viewport has real room on a 360px phone', lay.viewH >= 150, lay.viewH + 'px');
  result('and so does the note', lay.taH >= 60, lay.taH + 'px');
  result('nothing hangs off the edge of the sheet', lay.over.length === 0, lay.over.join(', '));
  result('the Save button is on the screen, not below it',
    lay.saveBottom <= lay.innerH + 1, lay.saveBottom + ' of ' + lay.innerH);

  // ── 4. Every word readable, in the light theme and the dark one ──────
  for (const [skin, theme] of [['default', 'light'], ['dark', 'dark']]) {
    await page.evaluate(([s, t]) => {
      document.documentElement.setAttribute('data-skin', s);
      document.documentElement.setAttribute('data-theme', t);
    }, [skin, theme]);
    await page.waitForTimeout(250);
    const r = await page.evaluate(MEASURE_IN, '#cpSheet');
    result('every word on the camera screen is readable [' + skin + '/' + theme + ']',
      r.bad.length === 0 && r.n >= 5, r.bad.length ? r.bad.join(' · ') : r.n + ' checked');
  }
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-skin', 'default');
    document.documentElement.setAttribute('data-theme', 'light');
  });

  // ── 5. Take one ──────────────────────────────────────────────────────
  const shot = await page.evaluate(async () => {
    document.getElementById('cpShoot').click();
    await new Promise(r => setTimeout(r, 2500));
    const img = document.getElementById('cpShot');
    return {
      showing: !!document.querySelector('.cp-view.shot'),
      hasSrc: !!(img && img.src && img.src.indexOf('blob:') === 0),
      facts: (document.getElementById('cpFacts') || {}).textContent || '',
      // The camera must be released once the frame is taken — a lit camera
      // behind a still picture is a battery drain and a privacy light nobody
      // can explain.
      stillStreaming: !!(document.getElementById('cpVideo').srcObject &&
        document.getElementById('cpVideo').srcObject.getVideoTracks()
          .some(t => t.readyState === 'live')),
      saveOn: !document.getElementById('cpSave').disabled,
    };
  });
  result('the shutter produces a picture on screen', shot.showing && shot.hasSrc);
  result('and the camera is let go of once the frame is taken', shot.stillStreaming === false);
  result('the card says how big it is and where it will live',
    /KB/.test(shot.facts) && /never|private|not in the gallery|no location/i.test(shot.facts),
    shot.facts.slice(0, 110));
  result('Save is only offered once there is something to save', shot.saveOn === true);

  // ── 6. Under 50 KB, and nothing but APP0 in the file ─────────────────
  const bytes = await page.evaluate(async () => {
    const img = document.getElementById('cpShot');
    const r = await fetch(img.src);
    const buf = new Uint8Array(await r.arrayBuffer());
    return Array.from(buf);
  });
  result('the photograph is under 50 KB', bytes.length <= 51200, bytes.length + ' bytes');
  const segs = appSegments(bytes);
  result('it carries NO Exif, XMP or IPTC block — there is nowhere for a GPS tag to be',
    segs.every(s => !CARRIERS.test(s)), segs.join(', ') || '(none)');
  result('the only blocks in the file are the header and the colour profile',
    segs.every(s => ALLOWED.test(s)), segs.join(', ') || '(none)');
  result('and no free-text comment segment either', segs.indexOf('COM') < 0);

  // ── 7. The worst case JPEG has: pure noise at 2000x1500 ──────────────
  const worst = await page.evaluate(async () => {
    const W = 2000, H = 1500;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    const d = cx.createImageData(W, H);
    // A deterministic pseudo-random fill: no two neighbouring pixels agree,
    // which is exactly what JPEG cannot compress.
    let s = 123456789;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d.data[i] = s & 255; d.data[i + 1] = (s >> 8) & 255; d.data[i + 2] = (s >> 16) & 255;
      d.data[i + 3] = 255;
    }
    cx.putImageData(d, 0, 0);
    const out = await window.HomattPhoto._encode(cv, W, H);
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    return { bytes: out.bytes, under: out.under, w: out.w, h: out.h, q: out.q, head: Array.from(buf.slice(0, 4096)) };
  });
  result('even 2000x1500 of pure noise comes under 50 KB',
    worst.under === true && worst.bytes <= 51200,
    worst.bytes + ' bytes at ' + worst.w + 'x' + worst.h + ', quality ' + worst.q);
  result('and it is still a readable size, not a thumbnail',
    Math.max(worst.w, worst.h) >= 512, worst.w + 'x' + worst.h);
  result('the noise file has no Exif block either',
    appSegments(worst.head).every(s => ALLOWED.test(s) && !CARRIERS.test(s)),
    appSegments(worst.head).join(', ') || '(none)');

  // ── 8. The note, and where it is kept ────────────────────────────────
  const noted = await page.evaluate(async () => {
    const ta = document.getElementById('clinical_findings_notes');
    const named = ta.getAttribute('name');
    ta.value = 'Left shin, 4cm, warm and spreading since Tuesday.';
    document.getElementById('cpSave').click();
    await new Promise(r => setTimeout(r, 1600));
    const rows = await window.HomattPhoto.listFor('visit-cam-1');
    return {
      named, n: rows.length,
      note: rows[0] ? rows[0].clinical_findings_notes : '',
      store: rows[0] ? rows[0].store : '',
      bytes: rows[0] ? rows[0].bytes : 0,
      visit: rows[0] ? rows[0].visit_id : '',
      thumbs: document.querySelectorAll('#cpStrip .cp-thumb').length,
      backLive: !!document.querySelector('.cp-view.live'),
    };
  });
  result('the notes box is the clinical_findings_notes field',
    noted.named === 'clinical_findings_notes', noted.named);
  result('saving keeps the picture and the words together on this visit',
    noted.n === 1 && /Left shin/.test(noted.note) && noted.visit === 'visit-cam-1',
    noted.n + ' saved · ' + noted.bytes + ' bytes · ' + noted.note.slice(0, 40));
  result('it is kept in the app\'s own private storage', noted.store === 'idb', noted.store);
  result('the saved photograph appears in the strip', noted.thumbs === 1, noted.thumbs + ' thumbnails');
  result('and the camera comes back ready for the next one', noted.backLive === true);

  // ── 9. Nothing was uploaded ──────────────────────────────────────────
  result('the photograph never left the phone', outbound.length === 0,
    outbound.slice(0, 2).join(' | ') || 'no image in the body of any request');

  /* …and the check above can actually SEE one, which is the half that is easy
   * to leave out. "No image was uploaded" is what a detector that inspects
   * nothing also reports, so post the very bytes that were just taken and
   * require the instrument to catch them. */
  await page.evaluate(async (sb) => {
    const rows = await window.HomattPhoto.listFor('visit-cam-1');
    const blob = await window.HomattPhoto.bytesOf(rows[0]);
    try { await fetch(sb + '/storage/v1/object/proof/x.jpg', { method: 'POST', body: blob }); }
    catch (e) {}
  }, SB);
  await page.waitForTimeout(400);
  result('and the check would have caught it if it had',
    outbound.length === 1 && /JPEG in the body/.test(outbound[0] || ''),
    outbound.join(' | ') || 'the detector saw nothing — it proves nothing');

  // ── 10. The count reaches the patient file ───────────────────────────
  const badge = await page.evaluate(async () => {
    window.HomattPhoto.close();
    await new Promise(r => setTimeout(r, 500));
    const el = document.querySelector('[data-role="photo-count"]');
    const btn = document.querySelector('[data-action="clinic-photo"]');
    return { shown: el ? getComputedStyle(el).display !== 'none' : false,
             text: el ? el.textContent : '', label: btn ? btn.getAttribute('aria-label') : '' };
  });
  result('the patient file shows that a photograph is on it',
    badge.shown === true && badge.text === '1', badge.text + ' · ' + badge.label);

  // ── 11. .nomedia goes in BEFORE the first photograph ─────────────────
  const nom = await page.evaluate(async () => {
    const calls = [], files = {};
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Filesystem: {
        mkdir: async (o) => { calls.push(['mkdir', o.path, o.directory]); },
        writeFile: async (o) => { calls.push(['write', o.path, o.directory]); files[o.path] = o.data; },
        readFile: async (o) => ({ data: files[o.path] || '' }),
        deleteFile: async (o) => { calls.push(['delete', o.path, o.directory]); delete files[o.path]; },
      } },
    };
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
    const cx = cv.getContext('2d'); cx.fillStyle = '#c33'; cx.fillRect(0, 0, 40, 30);
    const out = await window.HomattPhoto._encode(cv, 40, 30);
    const rec = await window.HomattPhoto._put({
      id: 'fs-test-1', visit_id: 'visit-cam-fs', taken_at: new Date().toISOString(),
      bytes: out.bytes, w: out.w, h: out.h, blob: out.blob, clinical_findings_notes: 'x',
    });
    return { calls, store: rec.store, path: rec.path, hasBlob: 'blob' in rec };
  });
  const order = nom.calls.map(c => c[0] + ' ' + c[1]);
  result('on a phone, the folder is made inside the app\'s own private storage',
    nom.calls.length > 0 && nom.calls.every(c => c[2] === 'DATA'),
    nom.calls.map(c => c[2]).join(','));
  result('a .nomedia marker is dropped in it', order.some(o => /\.nomedia$/.test(o)), order.join(' → '));
  result('and it is written BEFORE the first photograph lands there',
    order.findIndex(o => /\.nomedia$/.test(o)) < order.findIndex(o => /\.jpg$/.test(o)) &&
    order.findIndex(o => /\.jpg$/.test(o)) > -1, order.join(' → '));
  result('the photograph is filed under homatt_clinical/',
    nom.store === 'fs' && /^homatt_clinical\/.+\.jpg$/.test(nom.path || ''), nom.path);
  result('and the bytes are NOT also left in the database — one copy, one place',
    nom.hasBlob === false);

  // ── 12. Who may, and who may not ─────────────────────────────────────
  const roles = await page.evaluate(async (v) => {
    const out = {};
    for (const role of ['receptionist', 'salesperson', 'nurse', 'visiting_clinician']) {
      const s = JSON.parse(localStorage.getItem('clinic_session'));
      s.staffRole = role; localStorage.setItem('clinic_session', JSON.stringify(s));
      window._activeDetailContext = { current: v, history: [] };
      renderActiveDetailView();
      await new Promise(r => setTimeout(r, 120));
      out[role] = { may: window.HomattPhoto.may(),
                    btn: !!document.querySelector('[data-action="clinic-photo"]') };
    }
    return out;
  }, VISIT);
  result('a receptionist is not offered a camera for a patient',
    roles.receptionist.may === false && roles.receptionist.btn === false);
  result('nor is a drug-shop salesperson',
    roles.salesperson.may === false && roles.salesperson.btn === false);
  result('a nurse is — photographing a wound is clinical work',
    roles.nurse.may === true && roles.nurse.btn === true);
  result('and so is a visiting clinician', roles.visiting_clinician.may === true);

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
