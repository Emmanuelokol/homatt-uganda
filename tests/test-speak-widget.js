// The floating microphone, and the whole journey it starts.
//
// Tap it anywhere → it listens → it shows what it understood → the clinician
// taps a condition → the treatment opens, filled in, at the one-tap package.
//
// The thing this test is really guarding is that NOTHING along that path
// decides anything: the conditions are suggestions from the books with a match
// figure, a person taps one, and only then does anything get written.
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
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const ORIGIN='http://localhost:8959';

// The microphone, the recorder and the server, so the test exercises the
// wiring rather than the network. A real AudioContext feeds the level meter.
const FAKE_MIC = (said) => `
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  navigator.permissions = undefined;
  window.__ac = new AudioContext();
  const osc = window.__ac.createOscillator(), g = window.__ac.createGain();
  g.gain.value = 0.85; osc.frequency.value = 260;
  const dest = window.__ac.createMediaStreamDestination();
  osc.connect(g); g.connect(dest); osc.start();
  navigator.mediaDevices.getUserMedia = async () => dest.stream;
  function Rec() { this.state='recording'; this.mimeType='audio/webm';
    this.start=()=>{}; this.stop=()=>{ this.state='inactive';
      if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'],{type:'audio/webm'})});
      if(this.onstop) this.onstop(); }; }
  Rec.isTypeSupported = () => true;
  window.MediaRecorder = Rec;
  window._getClinicSupabase = () => ({ functions: { invoke: async (n) =>
    n === 'transcribe' ? { data: { text: ${JSON.stringify(said)} } }
                       : { error: new Error('no model') } } });
`;

(async () => {
  await new Promise(r => server.listen(8959, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:430,height:950}, hasTouch:true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort(); });

  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);

  // ── 1. It is there, on the screens a clinician is actually on ────────────
  const SAID = 'Her name is Grace Nakato, she is female, 40 years, complains of ' +
               'fever and headache for two days, no vomiting, known diabetic on ' +
               'metformin, temp 38.5';

  for (const pageName of ['dashboard', 'messages', 'new-order']) {
    await page.goto(`${ORIGIN}/clinic/${pageName}.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const there = await page.evaluate(() => {
      const f = document.getElementById('spFab');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      return { onScreen: r.width > 30 && r.height > 30,
               fixed: getComputedStyle(f).position === 'fixed',
               opacity: parseFloat(cs.opacity),
               z: parseInt(cs.zIndex, 10) || 0 };
    });
    result(`the microphone floats on ${pageName}`,
      there && there.onScreen && there.fixed,
      there ? JSON.stringify(there) : 'missing');
  }

  // ── 2. See-through at rest, solid while listening ───────────────────────
  const seeThrough = await page.evaluate(async () => {
    const f = document.getElementById('spFab');
    const settle = () => new Promise(r => setTimeout(r, 300));  // it transitions
    await settle();
    const rest = parseFloat(getComputedStyle(f).opacity);
    document.querySelector('.sp-root').classList.add('sp-hot');
    await settle();
    const hot = parseFloat(getComputedStyle(f).opacity);
    document.querySelector('.sp-root').classList.remove('sp-hot');
    await settle();
    return { rest, hot };
  });
  result('it is see-through at rest so the screen underneath can be read',
    seeThrough.rest < 0.95 && seeThrough.rest > 0.2,
    'rest ' + seeThrough.rest);
  result('and fully solid while it is listening, when you must see it is on',
    seeThrough.hot === 1, 'listening ' + seeThrough.hot);

  const adjustable = await page.evaluate(async () => {
    const settle = () => new Promise(r => setTimeout(r, 300));
    const read = () => parseFloat(getComputedStyle(document.getElementById('spFab')).opacity);
    localStorage.setItem('homatt_speak_opacity', '0.9');
    window.HomattSpeak.applyLook(); await settle();
    const a = read();
    localStorage.setItem('homatt_speak_opacity', '0.3');
    window.HomattSpeak.applyLook(); await settle();
    const b = read();
    localStorage.setItem('homatt_speak_opacity', '0.55');
    window.HomattSpeak.applyLook(); await settle();
    return { a, b };
  });
  result('the clinic can set how see-through it is',
    Math.abs(adjustable.a - 0.9) < 0.02 && Math.abs(adjustable.b - 0.3) < 0.02,
    JSON.stringify(adjustable));

  const switchedOff = await page.evaluate(() => {
    localStorage.setItem('homatt_speak_off', '1');
    window.HomattSpeak.applyLook();
    const hidden = document.querySelector('.sp-root').hidden;
    localStorage.setItem('homatt_speak_off', '');
    window.HomattSpeak.applyLook();
    return { hidden, backAgain: !document.querySelector('.sp-root').hidden };
  });
  result('and turn it off altogether — a floating thing must be dismissable',
    switchedOff.hidden === true && switchedOff.backAgain === true,
    JSON.stringify(switchedOff));

  // ── 3. Tapping it listens, visibly ──────────────────────────────────────
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(FAKE_MIC(SAID));

  const listening = await page.evaluate(async () => {
    document.getElementById('spFab').click();
    await new Promise(r => setTimeout(r, 1500));
    const bars = [...document.querySelectorAll('#spBars i')]
      .map(x => parseFloat((x.style.transform.match(/[\d.]+/) || [0])[0]));
    const hint = document.querySelector('.sp-hint');
    return {
      sheetOpen: !document.getElementById('spSheet').hidden,
      scrim: !document.getElementById('spScrim').hidden,
      hot: document.querySelector('.sp-root').classList.contains('sp-hot'),
      moved: bars.some(v => v > 0.2),
      time: (document.getElementById('spTime') || {}).textContent || '',
      hint: hint ? hint.textContent : '',
    };
  });
  result('tapping it opens a sheet and starts listening',
    listening.sheetOpen && listening.scrim && listening.hot,
    JSON.stringify({o:listening.sheetOpen,h:listening.hot}));
  result('the voice animation moves with the actual sound, not on a timer',
    listening.moved, 'bars moved: ' + listening.moved);
  result('and it says in words that it is hearing you',
    /hearing you/i.test(listening.hint) && /^\d+:\d\d$/.test(listening.time),
    listening.hint + ' · ' + listening.time);

  // ── 4. The summary ──────────────────────────────────────────────────────
  const summary = await page.evaluate(async () => {
    document.getElementById('spStop').click();
    await new Promise(r => setTimeout(r, 1200));
    const tiles = [...document.querySelectorAll('#spBody .sp-tile')].map(t => ({
      k: t.querySelector('.sp-k').textContent,
      v: t.querySelector('.sp-v').textContent,
      missing: t.classList.contains('missing'),
    }));
    return {
      title: document.getElementById('spTitle').textContent,
      tiles,
      neg: (document.querySelector('#spBody .sp-neg') || {}).textContent || '',
      heard: (document.getElementById('spHeardT') || {}).value || '',
      stillHot: document.querySelector('.sp-root').classList.contains('sp-hot'),
    };
  });
  const by = k => (summary.tiles.find(t => t.k === k) || {}).v || '';
  result('when you finish, it shows back what it understood',
    by('Name') === 'Grace Nakato' && by('Sex') === 'female' &&
    by('Age') === '40 years' && /fever/.test(by('Main complaint')),
    summary.tiles.map(t => t.k + '=' + t.v).join(' | ').slice(0, 130));
  result('the readings said out loud are in the summary too',
    /38\.5/.test(by('Vitals')), by('Vitals'));
  result('what the clinician denied is drawn to their eye',
    /no vomiting/i.test(summary.neg), summary.neg.slice(0, 60));

  // The background is what most changes what a complaint might be, and it is
  // what the suggestion below turns on — so it has to be checkable here.
  const back = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#spBody .sp-story')]
      .map(b => b.textContent);
    return { boxes, any: boxes.join(' | ') };
  });
  result('the background is in the summary, not silently swallowed',
    /Background/i.test(back.any) && /diabetic/i.test(back.any),
    back.any.slice(0, 110));

  // And when nothing was said, it says so rather than looking complete.
  const emptyBack = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#spBody .sp-story')]
      .find(x => /Background/i.test(x.textContent));
    return b ? { missing: b.classList.contains('missing') } : null;
  });
  result('a background that was given is not marked as missing',
    emptyBack && emptyBack.missing === false, JSON.stringify(emptyBack));
  result('the words are kept verbatim, and can be corrected',
    summary.heard.indexOf('Grace Nakato') >= 0, summary.heard.slice(0, 60));
  result('and the listening animation stops when listening stops',
    summary.stillHot === false);

  // ── 5. The suspected conditions, from the books ─────────────────────────
  await page.waitForFunction(
    () => document.querySelectorAll('#spDx .sp-dx-b').length > 0 ||
          /Nothing in the books|not on this screen|Could not/.test(
            (document.getElementById('spDx') || {}).textContent || ''),
    { timeout: 30000 }).catch(() => {});

  const dx = await page.evaluate(() => {
    const host = document.getElementById('spDx');
    return {
      note: (host.querySelector('.sp-dx-note') || {}).textContent || '',
      items: [...host.querySelectorAll('.sp-dx-b')].map(b => ({
        name: (b.querySelector('.sp-dx-name') || {}).textContent || '',
        pct: (b.querySelector('.sp-dx-pct') || {}).textContent || '',
        why: (b.querySelector('.sp-dx-why') || {}).textContent || '',
      })),
      raw: host.textContent.slice(0, 80),
    };
  });
  result('the books suggest conditions from what was said',
    dx.items.length > 0, dx.items.map(i => i.name + ' ' + i.pct).join(' · ') || dx.raw);
  result('each one shows the match strength and what in the record points to it',
    dx.items.length > 0 && /%/.test(dx.items[0].pct) && dx.items[0].why.length > 4,
    dx.items[0] ? dx.items[0].pct + ' — ' + dx.items[0].why.slice(0, 50) : 'none');
  result('and it says plainly that these are not a diagnosis',
    /not a diagnosis/i.test(dx.note) && /you decide/i.test(dx.note),
    dx.note.slice(0, 80));
  result('nothing is chosen for the clinician — every one needs a tap',
    dx.items.length > 0 &&
    !(await page.evaluate(() => !!document.querySelector('#spDx .sp-dx-b.chosen'))),
    'none preselected');

  // ── 6. Tapping one opens the treatment, filled in ───────────────────────
  const picked = dx.items.length ? dx.items[0].name : '';
  await page.evaluate(() => { document.querySelector('#spDx .sp-dx-b').click(); });
  await page.waitForURL('**/new-order.html?speak=1', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const landed = await page.evaluate(() => ({
    url: location.pathname + location.search,
    name: (document.getElementById('quickPatientName') || {}).value || '',
    chief: (document.getElementById('itChief') || {}).value || '',
    subj: (document.getElementById('itSubjective') || {}).value || '',
    temp: (document.getElementById('itTemp') || {}).value || '',
    age: (document.getElementById('itAge') || {}).value || '',
    sex: (document.querySelector('.it-sex-btn.on') || {}).dataset
         ? (document.querySelector('.it-sex-btn.on') || {}).dataset.sex : '',
    dx: (document.getElementById('confirmedDx') || {}).value || '',
    leftover: localStorage.getItem('homatt_speak_handoff'),
  }));
  result('tapping a condition drives you to the new treatment',
    /new-order\.html/.test(landed.url), landed.url);
  result('with who they are and what they came with already filled in',
    landed.name === 'Grace Nakato' && landed.sex === 'female' &&
    landed.age === '40' && /fever/.test(landed.chief) && landed.temp === '38.5',
    JSON.stringify({n:landed.name,s:landed.sex,a:landed.age,c:landed.chief,t:landed.temp}));
  result('and the condition they picked in the confirmed-diagnosis box',
    landed.dx === picked && landed.dx.length > 2,
    JSON.stringify(landed.dx) + ' (picked ' + JSON.stringify(picked) + ')');
  result('the handoff is consumed once, so a later visit is not haunted by it',
    landed.leftover === null, String(landed.leftover));

  // ── 7. …at the one-tap package ──────────────────────────────────────────
  await page.waitForFunction(() => {
    const o = document.getElementById('ucgOverlay');
    return o && getComputedStyle(o).display !== 'none';
  }, { timeout: 30000 }).catch(() => {});
  const pkg = await page.evaluate(() => {
    const o = document.getElementById('ucgOverlay');
    const ask = document.getElementById('ucgAsk');
    return {
      open: !!o && getComputedStyle(o).display !== 'none',
      asking: !!ask && getComputedStyle(ask).display !== 'none',
      askTitle: (document.getElementById('ucgAskTitle') || {}).textContent || '',
      title: (document.getElementById('ucgTitle') || {}).textContent || '',
      body: (document.getElementById('ucgBody') || {}).textContent.slice(0, 60) || '',
    };
  });
  // The journey ends in one of two right places, and which one depends on the
  // condition rather than on the widget: a title that names exactly one
  // section of the book opens its package, and a title that names more than
  // one ("Osteomyelitis" is also "Osteomyelitis of the Jaw") asks which.
  // Asserting only the first made this test depend on WHICH condition happened
  // to rank first, so a change in scoring broke it while the journey worked.
  result('the one-tap package opens on the condition that was picked, ' +
    'or asks which section of the book it is',
    pkg.open || (pkg.asking && /which one/i.test(pkg.askTitle)),
    'open=' + pkg.open + ' asking=' + pkg.asking +
    ' title="' + (pkg.open ? pkg.title : pkg.askTitle).slice(0, 40) + '"');

  // ── 8. It never overwrites a patient already being entered ──────────────
  const guarded = await page.evaluate(async () => {
    document.getElementById('quickPatientName').value = 'Someone Else';
    document.getElementById('quickPatientName')
      .dispatchEvent(new Event('input', { bubbles: true }));
    localStorage.setItem('homatt_speak_handoff', JSON.stringify({
      at: Date.now(), heard: 'x', dx: '', name: 'Grace Nakato',
      chief: 'cough', sex: 'female', age: '40', ageUnit: 'years', vitals: {},
    }));
    window._speakHandoff();
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById('quickPatientName').value;
  });
  result('a patient already half-entered is never overwritten by a dictation',
    guarded === 'Someone Else', JSON.stringify(guarded));

  // A stale handoff from an hour ago is not this patient.
  const stale = await page.evaluate(() => {
    localStorage.setItem('homatt_speak_handoff', JSON.stringify({
      at: Date.now() - 60 * 60 * 1000, name: 'Ghost Patient', chief: 'fever',
    }));
    const got = window.HomattSpeak.takeHandoff();
    return { got: got, cleared: localStorage.getItem('homatt_speak_handoff') };
  });
  result('and a dictation from an hour ago is dropped, not applied',
    stale.got === null && stale.cleared === null, JSON.stringify(stale.got));

  // ── 9. Readable, in all four looks ──────────────────────────────────────
  await page.evaluate(() => {
    document.querySelector('.sp-root').classList.add('sp-open');
    document.getElementById('spSheet').hidden = false;
    document.getElementById('spBody').innerHTML =
      '<div class="sp-grid"><div class="sp-tile"><span class="sp-k">Name</span>' +
      '<span class="sp-v">Grace Nakato</span></div>' +
      '<div class="sp-tile missing"><span class="sp-k">Sex</span>' +
      '<span class="sp-v">not said</span></div></div>' +
      '<div class="sp-story"><span class="sp-k">The story</span>two days</div>' +
      '<div class="sp-neg">You said: no vomiting</div>' +
      '<div class="sp-dx"><div class="sp-dx-note">not a diagnosis. You decide.</div>' +
      '<button class="sp-dx-b"><span class="sp-dx-name">Malaria</span>' +
      '<span class="sp-dx-pct">72%<i>match</i></span>' +
      '<span class="sp-dx-why">from what you said: <b>fever</b></span>' +
      '<span class="sp-dx-src">UCG p.101</span></button></div>' +
      '<div class="sp-acts"><button class="sp-go">Open</button>' +
      '<button class="sp-go ghost">Again</button></div>';
  });
  const bad = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
      }, [skin, theme]);
      await page.waitForTimeout(70);
      const low = await page.evaluate(() => {
        const rgb = c => { const m = (c||'').match(/[\d.]+/g); return m ? m.map(Number) : null; };
        const lum = c => { const m = rgb(c);
          const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        const bgOf = el => { let n = el; const layers = [];
          while (n && n !== document.documentElement) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (c) { const a = c.length > 3 ? c[3] : 1;
              if (a > 0) { layers.push([c[0],c[1],c[2],a]); if (a >= 1) break; } }
            n = n.parentElement; }
          const b = rgb(getComputedStyle(document.body).backgroundColor) || [255,255,255];
          let out = [b[0],b[1],b[2]];
          for (let i = layers.length-1; i >= 0; i--) { const [r,g,bl,a] = layers[i];
            out = [r*a+out[0]*(1-a), g*a+out[1]*(1-a), bl*a+out[2]*(1-a)]; }
          return 'rgb(' + out.join(', ') + ')'; };
        const out = {};
        const add = (k, sel) => { const e = document.querySelector(sel);
          if (!e || e.offsetParent === null) return;
          const a = lum(getComputedStyle(e).color), c = lum(bgOf(e));
          out[k] = (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05); };
        add('title', '#spTitle'); add('key', '.sp-k'); add('value', '.sp-v');
        add('missing', '.sp-tile.missing .sp-v'); add('story', '.sp-story');
        add('denial', '.sp-neg'); add('note', '.sp-dx-note');
        add('dxName', '.sp-dx-name'); add('dxPct', '.sp-dx-pct');
        add('dxWhy', '.sp-dx-why'); add('dxSrc', '.sp-dx-src');
        // the buttons carry their own fill
        const btn = document.querySelector('.sp-go');
        if (btn) { const cs = getComputedStyle(btn);
          const a = lum(cs.color), c = lum(cs.backgroundColor);
          out.button = (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05); }
        const fab = document.getElementById('spFab');
        if (fab) { const cs = getComputedStyle(fab);
          const a = lum(cs.color), c = lum(cs.backgroundColor);
          out.fab = (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05); }
        return out;
      });
      Object.entries(low).forEach(([k,v]) => {
        if (v < 4.5) bad.push(`${skin}/${theme} ${k}=${v.toFixed(2)}`);
      });
    }
  }
  result('every word of the widget is readable in all four looks',
    bad.length === 0, bad.slice(0, 5).join(' · '));

  // The app's own word is "treatment"; "consultation" is not shown to anyone.
  const words = await page.evaluate(() =>
    (document.querySelector('.sp-root') || {}).textContent || '');
  result('it uses the app\'s own words on screen',
    !/consultation/i.test(words), words.slice(0, 60));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
