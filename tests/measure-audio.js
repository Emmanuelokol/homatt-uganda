// Does the app actually make a quiet voice loud enough to transcribe?
//
// This is the one part of dictation accuracy that can be measured here without
// a microphone or a recogniser: put a signal of a known level through the real
// conditioning graph and read what comes out the other end. If a quiet input
// does not come out louder, nothing else in the chain matters.
//
// Level is RMS, 0…1, the same measure the app uses to decide whether it heard
// anything at all (below 0.012 it refuses the recording).
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
const ORIGIN='http://localhost:8949';

(async () => {
  await new Promise(r => server.listen(8949, r));
  const b = await chromium.launch({ executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext()).newPage();
  await page.route('**/*', r => r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort());
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const rows = await page.evaluate(async () => {
    // Rebuild the app's graph exactly as clinic-dictate.js builds it, offline
    // and at 200x speed, so the numbers are arithmetic rather than a stopwatch.
    async function through(amp, conditioned) {
      const LEN = 3;                       // seconds
      const SR = 48000;
      const ctx = new OfflineAudioContext(1, SR * LEN, SR);
      // Something speech-shaped rather than a pure tone: a 140 Hz "voice" with
      // harmonics, gated into syllables, which is what a compressor reacts to.
      const src = ctx.createOscillator();
      src.type = 'sawtooth';
      src.frequency.value = 140;
      const syll = ctx.createGain();
      syll.gain.setValueAtTime(0, 0);
      for (let t = 0; t < LEN; t += 0.4) {
        syll.gain.setValueAtTime(0, t);
        syll.gain.linearRampToValueAtTime(1, t + 0.05);
        syll.gain.setValueAtTime(1, t + 0.25);
        syll.gain.linearRampToValueAtTime(0, t + 0.32);
      }
      const level = ctx.createGain();
      level.gain.value = amp;

      src.connect(syll); syll.connect(level);

      let tail = level;
      if (conditioned) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 85;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -34; comp.knee.value = 24; comp.ratio.value = 6;
        comp.attack.value = 0.003; comp.release.value = 0.25;
        const makeup = ctx.createGain();
        makeup.gain.value = 2.4;
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
        lim.attack.value = 0.001; lim.release.value = 0.08;
        level.connect(hp); hp.connect(comp); comp.connect(makeup);
        makeup.connect(lim);
        tail = lim;
      }
      tail.connect(ctx.destination);
      src.start(0);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let sum = 0, peak = 0;
      for (let i = 0; i < d.length; i++) {
        sum += d[i] * d[i];
        const a = Math.abs(d[i]); if (a > peak) peak = a;
      }
      return { rms: Math.sqrt(sum / d.length), peak };
    }

    const out = [];
    // 0.010 ≈ someone speaking softly at arm's length; 0.25 ≈ leaning in.
    for (const [name, amp] of [['very quiet', 0.010], ['quiet', 0.030],
                               ['normal', 0.100], ['loud', 0.250]]) {
      const raw = await through(amp, false);
      const con = await through(amp, true);
      out.push({ name, amp, raw, con });
    }
    return out;
  });

  console.log('what the recogniser actually receives\n');
  console.log('  speaker        raw RMS   conditioned   lift    clipping');
  rows.forEach(r => {
    const lift = r.con.rms / (r.raw.rms || 1e-9);
    const clip = r.con.peak >= 0.999 ? 'CLIPPED' : '—';
    console.log('  ' + r.name.padEnd(14) +
      r.raw.rms.toFixed(4).padStart(7) + '   ' +
      r.con.rms.toFixed(4).padStart(9) + '   ' +
      (lift.toFixed(1) + '×').padStart(6) + '   ' + clip);
  });
  const floor = 0.012;                       // below this the app refuses it
  const rescued = rows.filter(r => r.raw.rms < floor && r.con.rms >= floor);
  console.log(`\n  the app refuses anything under ${floor} RMS as silence.`);
  console.log(`  quiet recordings rescued from that by the conditioning: ` +
              `${rescued.length}/${rows.filter(r => r.raw.rms < floor).length}`);
  const clipped = rows.filter(r => r.con.peak >= 0.999);
  console.log(`  loud recordings driven into clipping by it: ${clipped.length}/${rows.length}`);

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
