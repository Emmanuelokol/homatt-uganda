// Speaking comes first, and the phone shows it is listening.
//
// Three things a clinician standing in front of a patient needs:
//   1. the button is the FIRST thing on the intake screen, before the name
//   2. while it is recording, something on screen MOVES with their voice — a
//      label alone looks identical on a dead microphone
//   3. when it will not work, the message names the actual fault and the way
//      round it. "Could not reach the dictation service" for a function that
//      was never deployed sends a clinic to look at their internet for a week.
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

(async () => {
  await new Promise(r => server.listen(8963, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:430,height:950}, hasTouch:true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('http://localhost:8963')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort(); });

  await page.goto('http://localhost:8963/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto('http://localhost:8963/clinic/new-order.html');
  await page.waitForSelector('#itDictateStory', { timeout: 20000 });

  // ── 1. First on the screen ───────────────────────────────────────────────
  const order = await page.evaluate(() => {
    const y = id => { const e = document.getElementById(id);
      if (!e || e.offsetParent === null && getComputedStyle(e).display === 'none') return null;
      return e.getBoundingClientRect().top + window.scrollY; };
    return { speak: y('itDictateStory'), name: y('quickPatientName'),
             chief: y('itChief'), tabs: y('itTab1'),
             inPane1: !!(document.getElementById('itPane1') || {})
               .contains?.(document.getElementById('itDictateStory')) };
  });
  result('the dictate button comes before the patient\'s name',
    order.speak !== null && order.name !== null && order.speak < order.name,
    'speak ' + Math.round(order.speak) + ' · name ' + Math.round(order.name));
  result('and before the complaint and the tabs, so it is the first thing done',
    order.speak < order.chief && order.speak < order.tabs,
    'chief ' + Math.round(order.chief) + ' · tabs ' + Math.round(order.tabs));
  result('it is no longer buried inside the complaint tab',
    order.inPane1 === false);

  // ── 2. It shows that it is listening, and the bars move with the sound ───
  const listening = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    // A real MediaStream from an oscillator, so the analyser has something to
    // read — a stubbed stream would let a broken meter pass.
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dest); osc.frequency.value = 220; osc.start();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    window.MediaRecorder = function () {
      this.state='recording'; this.start=()=>{};
      this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); };
    };
    window._getClinicSupabase = () => ({ functions: { invoke: async () =>
      ({ data: { text: 'complains of fever' } }) } });

    const btn = document.getElementById('itDictateStory');
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const live = document.getElementById('itDictateLive');
    const bars = [...document.querySelectorAll('#itDictateBars i')];
    const shown = live && !live.hidden && getComputedStyle(live).display !== 'none';
    const scales = () => bars.map(x => x.style.transform || '');
    const first = scales();
    await new Promise(r => setTimeout(r, 600));
    const second = scales();
    const time = (document.getElementById('itDictateTime') || {}).textContent || '';
    const btnOn = btn.classList.contains('on');
    // stop
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    const after = document.getElementById('itDictateLive');
    try { osc.stop(); ac.close(); } catch (e) {}
    return { shown, bars: bars.length, first, second, time, btnOn,
             hiddenAfter: !!after.hidden };
  });
  result('while it records, the screen says so and the button is lit',
    listening.shown && listening.btnOn,
    'shown=' + listening.shown + ' lit=' + listening.btnOn);
  result('a row of bars moves with the sound coming in, not on a timer',
    listening.bars >= 5 &&
    listening.first.some(s => /scaleY/.test(s)) &&
    listening.first.join('|') !== listening.second.join('|'),
    listening.first.slice(0, 3).join(' ') + '  →  ' + listening.second.slice(0, 3).join(' '));
  result('the seconds are counted so a long dictation is visible',
    /^\d+:\d\d$/.test(listening.time), listening.time);
  result('and all of it goes away the moment recording stops',
    listening.hiddenAfter === true);

  // ── 3. The microphone being refused says what to do about it ────────────
  async function micFails(name) {
    return page.evaluate(async (n) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.permissions = undefined;
      navigator.mediaDevices.getUserMedia = async () => {
        const e = new Error('nope'); e.name = n; throw e;
      };
      document.getElementById('itDictateStory').click();
      await new Promise(r => setTimeout(r, 300));
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               live: !!(document.getElementById('itDictateLive')||{}).hidden };
    }, name);
  }
  const refused = await micFails('NotAllowedError');
  result('a refused microphone says where to turn it back on',
    /Settings/.test(refused.said) && /Microphone/i.test(refused.said) &&
    refused.live === true,
    refused.said.slice(0, 95));

  const busy = await micFails('NotReadableError');
  result('a microphone another app is holding is told apart from a refusal',
    /used by something else|end the call/i.test(busy.said) &&
    !/Settings/.test(busy.said), busy.said.slice(0, 80));

  const none = await micFails('NotFoundError');
  result('a phone with no microphone says so instead of asking for permission',
    /no microphone/i.test(none.said), none.said.slice(0, 70));

  // ── 4. The server fault is named, not guessed ───────────────────────────
  async function serverSays(status, body) {
    return page.evaluate(async ([st, bd]) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state='recording'; this.start=()=>{};
        this.stop=()=>{ this.state='inactive';
          if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
          if(this.onstop) this.onstop(); };
      };
      window._getClinicSupabase = () => ({ functions: { invoke: async () => ({
        data: null,
        error: { context: { status: st, json: async () => {
          if (bd === null) throw new Error('no json'); return bd; } } },
      }) } });
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 450));
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               stored: localStorage.getItem('homatt_dictation_fault') || '' };
    }, [status, body]);
  }

  // This is the one in the screenshot: the Edge Function is not deployed.
  const notThere = await serverSays(404, { error: 'Requested function was not found' });
  result('a function that was never deployed says it is not set up, not "no network"',
    /not been switched on|not set up/i.test(notThere.said) &&
    !/Could not reach/i.test(notThere.said) &&
    /"kind":"unconfigured"/.test(notThere.stored),
    notThere.said.slice(0, 95));
  result('and it does not repeat the gateway\'s own words at a nurse',
    !/Requested function was not found/.test(notThere.said),
    notThere.said.slice(0, 60));

  const noKey = await serverSays(503, {
    error: 'Dictation is not configured on this server. Set DEEPGRAM_API_KEY or ' +
           'OPENAI_API_KEY in Supabase secrets.', kind: 'unconfigured' });
  result('a deployed function with no key says which secret is missing',
    /DEEPGRAM_API_KEY/.test(noKey.said), noKey.said.slice(0, 80));

  const signedOut = await serverSays(401, null);
  result('an expired session says to sign in, not that the account is empty',
    /signed out/i.test(signedOut.said) && !/credit/i.test(signedOut.said),
    signedOut.said.slice(0, 70));

  const brokeDown = await serverSays(500, null);
  result('a server fault at their end is not blamed on the clinic\'s connection',
    /at its end/i.test(brokeDown.said), brokeDown.said.slice(0, 70));

  // ── The case that actually happened, and was invisible ──────────────────
  // A function that was never deployed answers 404 from the gateway with no
  // CORS headers, so the browser hides it and fetch() just rejects — exactly
  // like a dead connection. The app has to tell them apart by asking whether
  // Supabase itself is reachable.
  async function noStatusWith(supabaseUp) {
    return page.evaluate(async (up) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state='recording'; this.start=()=>{};
        this.stop=()=>{ this.state='inactive';
          if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
          if(this.onstop) this.onstop(); };
      };
      // The CORS-blocked failure: an error with no readable status at all.
      window._getClinicSupabase = () => ({ functions: { invoke: async () => ({
        data: null, error: new TypeError('Failed to fetch'),
      }) } });
      // and whether a plain reachability check gets through
      const realFetch = window.fetch;
      window.__probed = null;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/auth/v1/health') >= 0) {
          window.__probed = String(u);
          return up ? Promise.resolve(new Response(null, { status: 200 }))
                    : Promise.reject(new TypeError('Failed to fetch'));
        }
        return realFetch.apply(this, arguments);
      };
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 600));
      window.fetch = realFetch;
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               stored: localStorage.getItem('homatt_dictation_fault') || '',
               probed: window.__probed };
    }, supabaseUp);
  }

  const serverUpFnMissing = await noStatusWith(true);
  result('a server that answers but has no transcribe function says exactly that',
    /not been switched on|never installed|not installed/i.test(serverUpFnMissing.said) &&
    !/Could not reach/i.test(serverUpFnMissing.said) &&
    /"kind":"unconfigured"/.test(serverUpFnMissing.stored),
    serverUpFnMissing.said.slice(0, 100));
  result('it works that out by asking whether Supabase answers at all',
    /\/auth\/v1\/health$/.test(serverUpFnMissing.probed || ''),
    String(serverUpFnMissing.probed));

  const genuinelyOffline = await noStatusWith(false);
  result('and a phone that truly cannot reach the server is still told so',
    /Could not reach/i.test(genuinelyOffline.said) &&
    /type it in/i.test(genuinelyOffline.said) &&
    /"kind":"unreachable"/.test(genuinelyOffline.stored),
    genuinelyOffline.said.slice(0, 70));

  const outOfCredit = await serverSays(402, {
    error: 'The dictation account is out of credit. Dictation will not work ' +
           'until it is topped up — type the readings for now.', kind: 'credit' });
  result('an empty account still says so plainly, as before',
    /out of credit/i.test(outOfCredit.said) && /"kind":"credit"/.test(outOfCredit.stored),
    outOfCredit.said.slice(0, 70));

  // ── 5. The recording itself ─────────────────────────────────────────────
  // What the phone actually produced has to be what the clip is labelled,
  // because that label is the Content-Type the recogniser is handed. A phone
  // that records MP4 and is announced as WebM asks it to decode a container
  // that is not there.
  async function recordOn(supported, produced) {
    return page.evaluate(async ([sup, prod]) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.permissions = undefined;
      window.__asked = [];
      window.__constraints = null;
      navigator.mediaDevices.getUserMedia = async (c) => {
        window.__constraints = JSON.parse(JSON.stringify(c));
        return { getTracks: () => [{ stop(){} }] };
      };
      function Rec(stream, opts) {
        this.state = 'recording';
        this.mimeType = (opts && opts.mimeType) || prod;
        this.start = () => {};
        this.stop = () => { this.state = 'inactive';
          if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x'], { type: this.mimeType }) });
          if (this.onstop) this.onstop(); };
      }
      Rec.isTypeSupported = (t) => { window.__asked.push(t); return sup.indexOf(t) >= 0; };
      window.MediaRecorder = Rec;
      window.__sentType = null;
      window._getClinicSupabase = () => ({ functions: { invoke: async (name, req) => {
        if (name === 'transcribe' && req && req.body && req.body.get) {
          const f = req.body.get('audio');
          window.__sentType = f && f.type;
        }
        return { data: { text: 'complains of fever' } };
      } } });
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 80));
      btn.click(); await new Promise(r => setTimeout(r, 500));
      return { asked: window.__asked, sentType: window.__sentType,
               constraints: window.__constraints };
    }, [supported, produced]);
  }

  const opus = await recordOn(['audio/webm;codecs=opus', 'audio/webm'], '');
  result('it asks for opus in webm first — best for the recogniser, smallest to upload',
    opus.asked[0] === 'audio/webm;codecs=opus' && /webm/.test(opus.sentType || ''),
    'first asked ' + opus.asked[0] + ' · sent ' + opus.sentType);

  // The Android WebViews that broke this: no webm at all, only MP4.
  const mp4 = await recordOn(['audio/mp4'], 'audio/mp4');
  result('a phone that can only record MP4 is labelled MP4, not WebM',
    mp4.sentType === 'audio/mp4',
    'sent ' + mp4.sentType + ' · asked ' + mp4.asked.length + ' types');

  result('it asks the microphone for one channel, with the noise handling on',
    !!(opus.constraints && opus.constraints.audio &&
       opus.constraints.audio.channelCount &&
       opus.constraints.audio.noiseSuppression),
    JSON.stringify(opus.constraints));

  // A phone too old to answer isTypeSupported must still record.
  const noNegotiation = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    function Rec() { this.state='recording'; this.mimeType='';
      this.start=()=>{}; this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); }; }
    window.MediaRecorder = Rec;                 // no isTypeSupported at all
    window.__sentType = null;
    window._getClinicSupabase = () => ({ functions: { invoke: async (n, req) => {
      if (n === 'transcribe' && req && req.body && req.body.get) {
        const f = req.body.get('audio'); window.__sentType = f && f.type;
      }
      return { data: { text: 'complains of fever' } };
    } } });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 80));
    btn.click(); await new Promise(r => setTimeout(r, 500));
    return { sent: window.__sentType,
             chief: document.getElementById('itChief').value };
  });
  result('an older phone that cannot say what it supports still records',
    !!noNegotiation.sent && /fever/.test(noNegotiation.chief),
    'sent ' + noNegotiation.sent);

  // A recorder that dies mid-sentence must not leave the button lit.
  const midFail = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    function Rec() { this.state='recording'; this.mimeType='audio/webm';
      this.start=() => { setTimeout(() => { if (this.onerror) this.onerror(new Event('error')); }, 80); };
      this.stop=()=>{}; }
    Rec.isTypeSupported = () => true;
    window.MediaRecorder = Rec;
    const btn = document.getElementById('itDictateStory');
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    return { lit: btn.classList.contains('on'),
             live: !!(document.getElementById('itDictateLive')||{}).hidden,
             said: (document.getElementById('itDictateStorySay')||{}).textContent || '' };
  });
  result('a recording that dies part way says so and puts the button back',
    midFail.lit === false && midFail.live === true && /stopped part way/i.test(midFail.said),
    midFail.said.slice(0, 70));

  // Silence is not the same as a failure, and it has a different fix.
  const silent = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    function Rec() { this.state='recording'; this.mimeType='audio/webm';
      this.start=()=>{}; this.stop=()=>{ this.state='inactive';
        if(this.onstop) this.onstop(); }; }        // no data at all
    Rec.isTypeSupported = () => true;
    window.MediaRecorder = Rec;
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 80));
    btn.click(); await new Promise(r => setTimeout(r, 350));
    return (document.getElementById('itDictateStorySay')||{}).textContent || '';
  });
  result('a recording with no sound in it says to check the microphone',
    /nothing came through|heard almost nothing/i.test(silent) &&
    /Microphone|covering/i.test(silent),
    silent.slice(0, 80));

  // ── 6. It must actually hear, and say so while there is still time ──────
  // The meter is the only thing that tells a clinician the microphone is
  // alive. A new AudioContext starts SUSPENDED under the autoplay policy, and
  // a suspended analyser returns silence for ever — every bar flat, on a
  // microphone working perfectly. That is the whole "it is not hearing me"
  // complaint, so this test drives a real tone through a real AudioContext.
  const heard = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    const ac = new AudioContext();
    const osc = ac.createOscillator(), gain = ac.createGain();
    gain.gain.value = 0.8; osc.frequency.value = 300;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dest); osc.start();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    function Rec() { this.state='recording'; this.mimeType='audio/webm';
      this.start=()=>{}; this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); }; }
    Rec.isTypeSupported = () => true;
    window.MediaRecorder = Rec;
    window._getClinicSupabase = () => ({ functions: { invoke: async () =>
      ({ data: { text: 'complains of fever for two days, no vomiting' } }) } });
    const btn = document.getElementById('itDictateStory');
    btn.click();
    await new Promise(r => setTimeout(r, 1600));
    const hint = document.querySelector('#itDictateLive .it-live-hint');
    const bars = [...document.querySelectorAll('#itDictateBars i')]
      .map(b => parseFloat((b.style.transform.match(/[\d.]+/) || [0])[0]));
    const state = { hintText: hint ? hint.textContent : '',
                    hintClass: hint ? hint.className : '',
                    moved: bars.some(v => v > 0.2), bars };
    btn.click();
    await new Promise(r => setTimeout(r, 600));
    try { osc.stop(); ac.close(); } catch (e) {}
    return { ...state,
             said: (document.getElementById('itDictateStorySay')||{}).textContent || '' };
  });
  result('with real sound going in, the bars actually move',
    heard.moved, JSON.stringify(heard.bars));
  result('and it says in words that it is hearing you, while you are still talking',
    /hearing you/i.test(heard.hintText) && / good\b/.test(heard.hintClass),
    heard.hintText);
  result('a recording with sound in it is sent, not refused as silent',
    !/nothing came through|barely moved/i.test(heard.said),
    heard.said.slice(0, 70));

  // Silence, on the other hand, must be named — and its likeliest cause given.
  const deaf = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();   // nothing connected: silence
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    function Rec() { this.state='recording'; this.mimeType='audio/webm';
      this.start=()=>{}; this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); }; }
    Rec.isTypeSupported = () => true;
    window.MediaRecorder = Rec;
    const btn = document.getElementById('itDictateStory');
    btn.click();
    await new Promise(r => setTimeout(r, 3000));
    const hint = document.querySelector('#itDictateLive .it-live-hint');
    const warned = { text: hint ? hint.textContent : '', cls: hint ? hint.className : '' };
    btn.click();
    await new Promise(r => setTimeout(r, 600));
    try { ac.close(); } catch (e) {}
    return { warned,
             said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
             stored: localStorage.getItem('homatt_dictation_fault') || '' };
  });
  result('a dead microphone is called out DURING the recording, not after it',
    /not hearing anything/i.test(deaf.warned.text) && / bad\b/.test(deaf.warned.cls),
    deaf.warned.text.slice(0, 70));
  result('and afterwards it names the likeliest cause instead of shrugging',
    /permission|microphone/i.test(deaf.said) && /"kind":"mic-silent"/.test(deaf.stored),
    deaf.said.slice(0, 100));

  // ── 7. The words, shown back and correctable ────────────────────────────
  const words = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.permissions = undefined;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    function Rec() { this.state='recording'; this.mimeType='audio/webm';
      this.start=()=>{}; this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); }; }
    Rec.isTypeSupported = () => true;
    window.MediaRecorder = Rec;
    ['itChief','itSubjective','itBackground'].forEach(id => {
      const e = document.getElementById(id);
      e.value=''; e.dispatchEvent(new Event('input',{bubbles:true}));
    });
    // The transcript with the dangerous kind of mistake in it: a dropped "no".
    window._getClinicSupabase = () => ({ functions: { invoke: async (n) =>
      n === 'transcribe'
        ? { data: { text: 'complains of fever for two days, chest pain' } }
        : { error: new Error('no model') } } });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 80));
    btn.click(); await new Promise(r => setTimeout(r, 600));
    const box = document.getElementById('itHeardBox');
    const ta = document.getElementById('itHeardText');
    return { shown: box && !box.hidden, text: ta ? ta.value : '',
             subjBefore: document.getElementById('itSubjective').value };
  });
  result('after dictating, the words are shown back in a box you can edit',
    words.shown === true && /chest pain/.test(words.text),
    JSON.stringify(words.text).slice(0, 80));

  const corrected = await page.evaluate(async () => {
    const ta = document.getElementById('itHeardText');
    ta.value = 'complains of fever for two days, no chest pain';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('itHeardUse').click();
    await new Promise(r => setTimeout(r, 700));
    return { chief: document.getElementById('itChief').value,
             subj: document.getElementById('itSubjective').value,
             boxGone: !!(document.getElementById('itHeardBox')||{}).hidden,
             said: (document.getElementById('itDictateStorySay')||{}).textContent || '' };
  });
  result('correcting a word re-fills the form from the corrected sentence',
    /no chest pain/.test(corrected.subj), JSON.stringify(corrected.subj).slice(0, 90));
  result('and the old wrong version is gone, not sitting there twice',
    (corrected.subj.match(/two days/g) || []).length === 1 &&
    !/^(?!.*no ).*chest pain/.test(corrected.subj.replace(/no chest pain/g, '')),
    JSON.stringify(corrected.subj).slice(0, 90));
  result('the box puts itself away once the words are used',
    corrected.boxGone === true && /corrected/i.test(corrected.said),
    corrected.said.slice(0, 60));

  // ── 8. Readable, in all four looks ──────────────────────────────────────
  const contrast = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
        const l = document.getElementById('itDictateLive');
        if (l) l.hidden = false;               // measure it as it appears
      }, [skin, theme]);
      await page.waitForTimeout(70);
      const bad = await page.evaluate(() => {
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number);
          const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        // Composite every translucent layer over the one behind it, the way
        // the browser actually paints. Taking rgba(255,255,255,.06) at face
        // value reports a perfectly readable box as unreadable — the dark
        // inputs are a 6% white wash over a dark card, not white.
        const rgb = c => { const m = (c || '').match(/[\d.]+/g); return m ? m.map(Number) : null; };
        const bgOf = el => {
          let n = el; const layers = [];
          while (n && n !== document.documentElement) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (c) { const a = c.length > 3 ? c[3] : 1;
              if (a > 0) { layers.push([c[0], c[1], c[2], a]); if (a >= 1) break; } }
            n = n.parentElement;
          }
          const base = rgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
          let out = [base[0], base[1], base[2]];
          for (let i = layers.length - 1; i >= 0; i--) {
            const [r, g, b, a] = layers[i];
            out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
          }
          return 'rgb(' + out.join(', ') + ')';
        };
        const ratio = el => { const a = lum(getComputedStyle(el).color), c = lum(bgOf(el));
          return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05); };
        const out = {};
        const add = (k, sel) => { const e = document.querySelector(sel);
          if (e && e.offsetParent !== null) out[k] = ratio(e); };
        add('title', '.it-speak-h b');
        add('sub', '.it-speak-h i');
        add('button', '#itDictateStory');
        add('time', '#itDictateTime');
        add('hint', '.it-live-hint');
        add('say', '#itDictateStorySay');
        const hb = document.getElementById('itHeardBox');
        if (hb) hb.hidden = false;
        add('heardTitle', '.it-heard-h b');
        add('heardNote', '.it-heard-note');
        add('heardText', '#itHeardText');
        add('heardUse', '#itHeardUse');
        add('heardAgain', '#itHeardAgain');
        return out;
      });
      Object.entries(bad).forEach(([k,v]) => {
        if (v < 4.5) contrast.push(`${skin}/${theme} ${k}=${v.toFixed(2)}`);
      });
    }
  }
  result('every word of the speak panel is readable in all four looks',
    contrast.length === 0, contrast.slice(0, 5).join(' · '));

  // The lit button is a different colour again — measure that too.
  const litOk = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      const v = await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
        const btn = document.getElementById('itDictateStory');
        btn.classList.add('on');
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number);
          const f = x => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        const cs = getComputedStyle(btn);
        const a = lum(cs.color), c = lum(cs.backgroundColor);
        btn.classList.remove('on');
        return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05);
      }, [skin, theme]);
      if (v < 4.5) litOk.push(`${skin}/${theme}=${v.toFixed(2)}`);
    }
  }
  result('and the lit "listening" button is readable too',
    litOk.length === 0, litOk.join(' · '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
