// One address to send a clinic — and the check that stopped hiding the app.
//
// THE FAULT THIS ROUND STARTED FROM, in the owner's own words: "the app on my
// phone that I downloaded from the link .../clinic/ it show that is a web app,
// and yet it is on my android phone, and that is the link I send to client."
//
// He had never installed an APK. Neither had anybody he sent that link to.
// They had all added a web page to a home screen, which looks exactly like an
// install from the outside — and the sign-in page's own offer of the Android
// app was hidden from precisely them, because it tested
//
//     display-mode: standalone  ->  "already installed, say nothing"
//
// and `standalone` is true of any icon on a home screen. The one state where
// somebody most needs to be told there is a real app was the one state that
// was told nothing. Only the Capacitor bridge answers "is this the installed
// app", because only the installed app has one.
//
// So this file asserts three things that have to stay true together:
//   1. get.html offers both, works with nothing fetched from anywhere, and is
//      readable in light and in dark on a 360px phone;
//   2. the APK address on it is the one the BUILD WORKFLOW actually publishes,
//      and the same one the two in-app screens carry — asserted against the
//      workflow rather than against a copy of the string, because a test that
//      repeats a constant cannot see that constant go stale;
//   3. the sign-in page offers the Android app to a browser AND to a
//      home-screen web app, and to the installed app offers nothing.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + got)); }
}

const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http');
const APP = path.join(__dirname, '..', 'app');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.db': 'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const PORT = 8974, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const read = (p) => fs.readFileSync(p, 'utf8');

// ── What the build actually publishes ────────────────────────────────────
// The APK link is only as good as the release it points at, and nothing on a
// page can know that. The workflow is what DEFINES both halves of the address:
// the release tag it publishes under, and the filename it renames the APK to.
const wf = read(path.join(ROOT, '.github', 'workflows', 'build-android-apk.yml'));
const tag = (wf.match(/tag_name:\s*(\S+)/) || [])[1];
const file = (wf.match(/cp\s+\S+\s+(\S+\.apk)/) || [])[1];
const WANT_APK = 'https://github.com/Emmanuelokol/homatt-uganda/releases/download/' +
  tag + '/' + file;

// The same contrast measurement the rest of the suite uses: composite every
// translucent layer, never assert on a colour by name.
const MEASURE = () => {
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
  var bad=[],n=0,all=document.body.querySelectorAll('*');
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
    if(got<need)bad.push(text.slice(0,30).replace(/\s+/g,' ')+' ('+Math.round(got*100)/100+':1)');
  }
  return {n:n,bad:bad};
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  // ══ 1. The page itself ═══════════════════════════════════════════════
  {
    // The narrowest phone this is used on. A 16px gutter and no sideways
    // scroll, or the install button is half off the screen of whoever has the
    // smallest one — which in this market is most people.
    const ctx = await b.newContext({ viewport: { width: 360, height: 740 },
      serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e.message)));

    // Everything off this origin is REFUSED rather than mocked. The whole
    // claim of this page is that it needs nothing — it is what somebody opens
    // on a bad connection in order to get the thing that works without one —
    // and a mock would let a stylesheet or a font creep in unnoticed.
    const offsite = [];
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      offsite.push(u);
      return r.abort();
    });

    await page.goto(ORIGIN + '/get.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);

    ok('the install page loads with no error', errors.length === 0, errors[0]);
    ok('it fetches nothing from anywhere else', offsite.length === 0, offsite.join(', '));

    const seen = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].map(x => ({
        href: x.getAttribute('href'), text: (x.textContent || '').replace(/\s+/g, ' ').trim(),
        h: Math.round(x.getBoundingClientRect().height),
      }));
      return {
        title: document.title,
        links: a,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        text: (document.body.innerText || '').replace(/\s+/g, ' '),
      };
    });

    const apk = seen.links.filter(l => /\.apk$/i.test(l.href || ''));
    const web = seen.links.filter(l => /clinic\/?$/.test(l.href || ''));
    ok('it offers the Android app', apk.length === 1, JSON.stringify(apk));
    ok('...at the address the build workflow actually publishes',
      apk.length === 1 && apk[0].href === WANT_APK, (apk[0] || {}).href + ' vs ' + WANT_APK);
    ok('it offers the browser version too, as a real answer rather than a footnote',
      web.length === 1, JSON.stringify(web));
    ok('...and the browser link is relative, so a branch preview points at itself',
      web.length === 1 && web[0].href === 'clinic/', (web[0] || {}).href);

    // A person on a phone taps these. 44px is the floor everybody agrees on.
    ok('both are big enough to tap on a phone',
      apk.concat(web).every(l => l.h >= 44),
      apk.concat(web).map(l => l.h).join('/'));

    ok('the page is named for what it is, not for the tool that made it',
      /homatt/i.test(seen.title), seen.title);

    // The difference between the two IS the page. A page that offers both and
    // does not say which is which recreates the confusion it exists to end.
    ok('it says the widget belongs to the Android app', /widget/i.test(seen.text));
    ok('it says the Android app works with no internet', /no internet/i.test(seen.text));
    ok('it warns that Android will ask permission to install a file',
      /allow/i.test(seen.text) && /install/i.test(seen.text));
    ok('it says installing over an older copy keeps what is recorded',
      /keeps everything already recorded/i.test(seen.text));

    /* A clinic reported "the download doesn't finish" over a download that
     * had finished — 12.75 MB of 12.75 MB, with Chrome still showing it as
     * busy, which is what Android does with APKs. The finished file sat in
     * Downloads untapped. The guidance has to be ON THIS PAGE, because this
     * is the page they are looking at when it happens.
     *
     * Asserted on the <details> element rather than on the words, so it
     * cannot pass on the phrase appearing somewhere else in the prose. */
    const stuck = await page.evaluate(() => {
      const d = document.querySelector('details.stuck');
      if (!d) return null;
      const s = d.querySelector('summary');
      d.open = true;                 // it must be openable with no script
      return {
        summary: (s && s.textContent || '').trim(),
        body: (d.textContent || '').replace(/\s+/g, ' '),
        openedH: Math.round(d.getBoundingClientRect().height),
      };
    });
    ok('a download that looks stuck is explained, where it happens',
      !!stuck, 'no details.stuck on the page');
    ok('...and it says the same number both sides means finished',
      !!stuck && /same number on both sides/i.test(stuck.body),
      (stuck || {}).body);
    ok('...and names where to go and tap it',
      !!stuck && /downloads/i.test(stuck.body) && /\.apk/i.test(stuck.body));
    ok('...and tells apart a download that really DID stop',
      !!stuck && /resume/i.test(stuck.body));
    ok('...and it opens, on a page with no script at all',
      !!stuck && stuck.openedH > 60, String((stuck || {}).openedH));

    ok('nothing runs off the side at 360px',
      seen.scrollW <= seen.clientW + 1, seen.scrollW + ' in ' + seen.clientW);

    // Light and dark. Four skins do not apply here — this page ships its own
    // colours precisely so it cannot depend on clinic.css — but it must still
    // be readable in both, and that is where a borrowed colour goes wrong.
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(120);
      const m = await page.evaluate(MEASURE);
      ok('every word is readable in ' + scheme + ' (' + m.n + ' measured)',
        m.bad.length === 0, m.bad.join(' · '));
    }
    await ctx.close();
  }

  // ══ 2. The two in-app screens carry the same address ══════════════════
  {
    const settings = read(path.join(APP, 'clinic', 'settings.html'));
    const signin = read(path.join(APP, 'clinic', 'index.html'));
    const getpage = read(path.join(APP, 'get.html'));
    // settings.html writes the address as two joined string literals, so the
    // file is put back together before it is compared — asserting on half of
    // a URL would pass on a URL that was broken in the other half.
    const joined = (src) => src.replace(/'\s*\+\s*[\r\n\s]*'/g, '');
    ok('Settings offers the same APK the workflow publishes',
      joined(settings).indexOf(WANT_APK) >= 0, 'settings.html');
    ok('the sign-in page offers the same one', signin.indexOf(WANT_APK) >= 0);
    ok('and the install page does too', getpage.indexOf(WANT_APK) >= 0);
  }

  // ══ 3. Who gets offered the Android app ══════════════════════════════
  //
  // The three states, driven for real. `standalone` is the one that was wrong,
  // and it is wrong in the direction that makes the feature invisible.
  const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  async function signinState({ standalone, native }) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 },
      userAgent: ANDROID, serviceWorkers: 'block' });
    // addInitScript, not evaluate: the sign-in page can replace itself, and a
    // stub installed after load would be gone by the time it is consulted.
    await ctx.addInitScript(([sa, na]) => {
      if (sa) {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
          ? { matches: true, media: q, addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {} }
          : real(q));
      }
      if (na) window.Capacitor = { isNative: true, platform: 'android',
        isNativePlatform: () => true, Plugins: {} };
    }, [standalone, native]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const out = await page.evaluate(() => {
      const a = document.getElementById('apkDownload');
      const h = document.getElementById('apkHint');
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
      return { link: vis(a), hint: vis(h), hintText: (h && h.textContent || '').replace(/\s+/g, ' ').trim() };
    });
    await ctx.close();
    return out;
  }

  const browser = await signinState({ standalone: false, native: false });
  ok('an Android browser is offered the app', browser.link && browser.hint);

  const pwa = await signinState({ standalone: true, native: false });
  ok('AN ICON ON A HOME SCREEN IS STILL OFFERED THE APP', pwa.link && pwa.hint,
    'link=' + pwa.link + ' hint=' + pwa.hint);
  ok('...and is told plainly that what they have is not the Android app',
    /not the android app/i.test(pwa.hintText), pwa.hintText.slice(0, 90));
  ok('...and is told it keeps what is already recorded, which is the fear',
    /keeps everything already recorded/i.test(pwa.hintText));

  const installed = await signinState({ standalone: true, native: true });
  ok('the installed app is offered nothing, because it already has it',
    !installed.link && !installed.hint,
    'link=' + installed.link + ' hint=' + installed.hint);

  // ══ 4. Settings names the address to SEND, which is a different one ═══
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 },
      serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      return r.abort();
    });
    // Seed the session on the UNGUARDED page. settings.html redirects a
    // signed-out visitor, and the redirect destroys the execution context
    // before anything can be written into it.
    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([cid, uid]) => {
      localStorage.clear();
      localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
        clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
      localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
        token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
    }, [CID, UID]);
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    const s = await page.evaluate(() => {
      const t = document.getElementById('shareUrlText');
      const note = document.getElementById('shareNote');
      const btn = document.getElementById('copyShareBtn');
      const vis = (el) => !!el && el.offsetParent !== null;
      return {
        url: t && t.textContent.trim(),
        noteText: (note && note.textContent || '').replace(/\s+/g, ' ').trim(),
        hasBtn: vis(btn),
        apk: (document.getElementById('apkUrlText') || {}).textContent,
      };
    });

    ok('settings loads with no error', errors.length === 0, errors[0]);
    // Served from localhost, which is this machine and nobody else's — so the
    // published home is the only truthful answer, and that is the branch the
    // installed app takes too, where the origin is https://localhost.
    ok('the address to send is the published one, not this device',
      s.url === 'https://emmanuelokol.github.io/homatt-uganda/get.html', s.url);
    ok('...and it is NOT the portal link that caused all this',
      !/\/clinic\/?$/.test(s.url || ''), s.url);
    ok('...and it is not the APK either, which is useless on a laptop',
      s.url !== s.apk, s.url);
    ok('it says to send this one rather than the one you are signed in on',
      /not the one you are signed in on/i.test(s.noteText), s.noteText.slice(0, 80));
    ok('there is a copy button, because nobody retypes a URL by hand', s.hasBtn);
    await ctx.close();
  }

  await b.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
