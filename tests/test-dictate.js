// Dictating the vitals, in a real browser.
//
// Two halves, tested separately because they fail differently:
//   1. the parser — pure, exhaustive, no mic and no network
//   2. the screen — a mocked recorder and a mocked Edge Function, checking the
//      numbers reach the right boxes and that a bad transcript reaches none
//
// The parser is where the safety lives: it must refuse a bare number, refuse
// an impossible reading, and never guess which box a number belongs to.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const D = require(require('path').join(APP, 'clinic/js/clinic-dictate.js'));
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
const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));

// ── 1. The parser ─────────────────────────────────────────────────────────
const SPOKEN = [
  // said plainly
  ['temp 38.5, BP 120 over 80, pulse 96, weight 62',
   {sbp:'120',dbp:'80',temp:'38.5',pulse:'96',weight:'62'}],
  ['BP 120/80 pulse 96', {sbp:'120',dbp:'80',pulse:'96'}],
  ['she has a fever of 39.2', {temp:'39.2'}],
  // said in words, which is what a recogniser often writes down
  ['temperature thirty eight point five degrees', {temp:'38.5'}],
  ['blood pressure one hundred twenty over eighty', {sbp:'120',dbp:'80'}],
  ['BP one twenty over eighty', {sbp:'120',dbp:'80'}],
  ['BP two forty over one ten', {sbp:'240',dbp:'110'}],
  ['temp is 38 point 5 and weight 62 kg', {temp:'38.5',weight:'62'}],
  // the unit names the reading even when the label was not said
  ['the patient weighs 62 kilos and the pulse is 96 beats per minute',
   {pulse:'96',weight:'62'}],
  // NOTHING may be guessed
  ['38.5', {}],
  ['120 and 80', {}],
  ['he is 62 years old', {}],
  ['the child is 3 months old', {}],
  // impossible readings are refused, not stored
  ['temp 385', {}],
  ['weight 620 kg', {}],
  ['BP 80 over 120', {}],
  ['pulse 4', {}],
];
let ok = 0;
const bad = [];
for (const [said, want] of SPOKEN) {
  const got = D.parseVitals(said).vitals;
  if (JSON.stringify(got) === JSON.stringify(want)) ok++;
  else bad.push(said + ' -> ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
result('the parser reads the vitals however they are spoken',
  ok === SPOKEN.length, ok + '/' + SPOKEN.length + (bad.length ? '  ' + bad[0] : ''));

result('a bare number is never assigned to a box',
  Object.keys(D.parseVitals('38.5').vitals).length === 0 &&
  Object.keys(D.parseVitals('96').vitals).length === 0);

result('an age is not mistaken for a weight',
  Object.keys(D.parseVitals('he is 62 years old').vitals).length === 0);

const impossible = D.parseVitals('temp 385');
result('an impossible reading is refused, and says why',
  Object.keys(impossible.vitals).length === 0 && impossible.ignored.length === 1 &&
  /outside/.test(impossible.ignored[0].why), JSON.stringify(impossible.ignored));

result('half a blood pressure is not a blood pressure',
  D.parseVitals('BP 120 over').vitals.sbp === undefined);


// ── 1b. The complaint and the story ───────────────────────────────────────
// The invariant here is the opposite of the vitals one. There, nothing may be
// guessed; here, nothing may be LOST — a clinician who dictated "no chest
// pain" and cannot find it will assume it was recorded.
const STORIES = [
  ['Patient complains of fever and headache for two days, also vomiting, no diarrhoea, has taken panadol',
   'fever and headache'],
  ['She presents with abdominal pain since Monday, no vomiting', 'abdominal pain'],
  ['c/o burning urine and frequency for a week', 'burning urine and frequency'],
  ['fever for three days getting worse at night', 'fever'],
  ['complains of cough', 'cough'],
  // No complaint can be picked out — all of it belongs in the story, which is
  // the safe direction.
  ['the child has been unwell since yesterday and the mother says he is not feeding', ''],
  ['he says he is fine but the family brought him because he was confused', ''],
];
let sok = 0; const sbad = [];
for (const [said, want] of STORIES) {
  const r = D.parseStory(said);
  if (r.complaint === want) sok++;
  else sbad.push(JSON.stringify(said.slice(0,40)) + ' -> ' + JSON.stringify(r.complaint));
}
result('the complaint is taken only when the clinician marked it',
  sok === STORIES.length, sok + '/' + STORIES.length + (sbad.length ? '  ' + sbad[0] : ''));

// Every word must survive, across everything above plus some awkward ones.
const FUZZ = STORIES.map(s => s[0]).concat([
  '', 'fever', 'no', 'complains of', 'c/o',
  'presents with chest pain radiating to the left arm, sweating, no vomiting',
  'the patient came in with difficulty in breathing which began two hours ago',
  'she has been having on and off fever for a month and has taken several drugs',
]);
const lost = FUZZ.map(t => D.parseStory(t)).filter(r => r.lost);
result('nothing spoken is ever lost between the two boxes',
  lost.length === 0, lost.length ? 'LOST: ' + lost[0].lost : FUZZ.length + ' phrasings');

result('what the clinician denied is listed back to them',
  D.parseStory('fever for two days, no vomiting, denies chest pain').negations.length === 2,
  JSON.stringify(D.parseStory('fever for two days, no vomiting, denies chest pain').negations));


// ── 1c. Who the patient is ────────────────────────────────────────────────
const PEOPLE = [
  ['Her name is Jackline Marcy, a 32 year old female, complains of fever',
   {name:'Jackline Marcy', sex:'female', age:'32', ageUnit:'years'}],
  ['patient is Emmanuel Okol, 45 years, male, came with wounds',
   {name:'Emmanuel Okol', sex:'male', age:'45', ageUnit:'years'}],
  // the parent is the informant, not the patient
  ['the mother says he is not feeding, the baby is 3 months old',
   {name:'', sex:'male', age:'3', ageUnit:'months'}],
  ['a 28-year-old woman with abdominal pain',
   {name:'', sex:'female', age:'28', ageUnit:'years'}],
  ['she has a fever of 39.2 for two days',
   {name:'', sex:'female', age:'', ageUnit:''}],
  // nothing said about the person
  ['complains of fever for two days', {name:'', sex:'', age:'', ageUnit:''}],
];
let pok = 0; const pbad = [];
for (const [said, want] of PEOPLE) {
  const r = D.parsePerson(said);
  const got = { name:r.name, sex:r.sex, age:r.age, ageUnit:r.ageUnit };
  if (JSON.stringify(got) === JSON.stringify(want)) pok++;
  else pbad.push(JSON.stringify(said.slice(0,34)) + ' -> ' + JSON.stringify(got));
}
result('sex and age are read from how the clinician speaks',
  pok === PEOPLE.length, pok + '/' + PEOPLE.length + (pbad.length ? '  ' + pbad[0] : ''));

result('a parent is not mistaken for the patient',
  D.parsePerson('the mother says he is not feeding').sex === 'male');

result('a name is only taken when it was marked as one',
  D.parsePerson('Jackline Marcy came in with fever').name === '' &&
  D.parsePerson('her name is Jackline Marcy').name === 'Jackline Marcy');


result('background is separated from today\'s story',
  (() => { const r = D.parseStory('complains of fever for two days, known diabetic on metformin, no vomiting');
    return r.complaint === 'fever' && /two days/.test(r.history) &&
           /no vomiting/.test(r.history) && /diabetic/.test(r.background) && !r.lost; })(),
  JSON.stringify(D.parseStory('complains of fever for two days, known diabetic on metformin, no vomiting')));

result('moving background out still loses nothing',
  ['complains of fever for two days, known diabetic on metformin, no vomiting',
   'she presents with cough for a week, HIV positive on ART, lives in Kampala',
   'fever for two days, family history of asthma, smokes',
   'complains of headache since Monday',
  ].every(t => !D.parseStory(t).lost));

(async () => {
  await new Promise(r => server.listen(9031, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:9031')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    return r.abort();
  });

  await page.goto('http://localhost:9031/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
  }, [CID, UID]);

  await page.goto('http://localhost:9031/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#itTab2', { timeout: 15000 });

  // The button lives with the vitals, not on the complaint tab.
  const placed = await page.evaluate(() => {
    const btn = document.getElementById('itDictate');
    const pane = document.getElementById('itPane2');
    return { exists: !!btn, inVitals: !!(btn && pane && pane.contains(btn)),
             label: btn ? btn.textContent.replace(/\s+/g,' ').trim() : '' };
  });
  result('the dictate button sits with the vitals', placed.exists && placed.inVitals, placed.label);

  // Stand in for the microphone and for the server, so the test exercises the
  // wiring rather than the network. transcript is what "Whisper" returns.
  async function speak(transcript, opts) {
    return page.evaluate(async ([text, o]) => {
      window.__sent = null;
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state = 'recording';
        this.start = () => {};
        this.stop = () => { this.state = 'inactive';
          if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x']) });
          if (this.onstop) this.onstop(); };
      };
      window._getClinicSupabase = () => ({ functions: { invoke: async (name, req) => {
        window.__sent = name;
        if (o && o.fail) return { error: new Error('offline') };
        return { data: { text } };
      } } });
      document.getElementById('itTab2').click();
      if (o && o.clear) {
        ['itSbp','itDbp','itTemp','itWeight','itPulse'].forEach(id => {
          const e = document.getElementById(id);
          if (e) { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      }
      const btn = document.getElementById('itDictate');
      btn.click();                       // start
      await new Promise(r => setTimeout(r, 60));
      btn.click();                       // stop -> transcribe -> fill
      await new Promise(r => setTimeout(r, 400));
      const v = id => (document.getElementById(id) || {}).value || '';
      return { sent: window.__sent,
               said: (document.getElementById('itDictateSay') || {}).textContent || '',
               sbp:v('itSbp'), dbp:v('itDbp'), temp:v('itTemp'),
               weight:v('itWeight'), pulse:v('itPulse') };
    }, [transcript, opts || {}]);
  }

  const good = await speak('temp 38.5, BP 120 over 80, pulse 96, weight 62');
  result('speaking the readings fills the four boxes',
    good.temp === '38.5' && good.sbp === '120' && good.dbp === '80' &&
    good.pulse === '96' && good.weight === '62',
    JSON.stringify({t:good.temp,s:good.sbp,d:good.dbp,p:good.pulse,w:good.weight}));

  result('it goes through the Edge Function, not to OpenAI from the phone',
    good.sent === 'transcribe', String(good.sent));

  result('it says back what it heard', /Heard:/.test(good.said) && /38\.5/.test(good.said),
    good.said.slice(0, 90));

  // A reading outside the vitals turns red exactly as when typed.
  const painted = await page.evaluate(() =>
    (document.getElementById('itTemp') || {}).className || '');
  result('a dictated abnormal reading is coloured like a typed one',
    /out/.test(painted), painted);

  const junk = await speak('the patient is feeling much better today', { clear: true });
  result('a transcript with no reading in it fills nothing, and says so',
    junk.temp === '' && junk.sbp === '' && /no reading/i.test(junk.said),
    junk.said.slice(0, 90));

  const failed = await speak('temp 38.5', { fail: true });
  result('when the service cannot be reached it says to type instead',
    /type it in for now/i.test(failed.said), failed.said.slice(0, 90));

  const off = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    ['itTemp','itSbp','itDbp','itPulse','itWeight'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    document.getElementById('itDictate').click();
    await new Promise(r => setTimeout(r, 200));
    return (document.getElementById('itDictateSay') || {}).textContent || '';
  });
  result('offline, it says dictation needs a connection rather than failing quietly',
    /needs a connection/i.test(off), off.slice(0, 90));


  // ── The complaint and the story, on the screen ───────────────────────────
  const story = await page.evaluate(async () => {
    // The offline check above pinned navigator.onLine to false; put it back,
    // or every test after it is really just testing the offline message.
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    window.__mode = null;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    window.MediaRecorder = function () {
      this.state = 'recording';
      this.start = () => {};
      this.stop = () => { this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x']) });
        if (this.onstop) this.onstop(); };
    };
    window._getClinicSupabase = () => ({ functions: { invoke: async (name, req) => {
      try { window.__mode = req.body.get('mode'); } catch (e) {}
      return { data: { text: 'Patient complains of fever and headache for two days, no vomiting' } };
    } } });
    document.getElementById('itTab1').click();
    ['itChief','itSubjective'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 60));
    btn.click(); await new Promise(r => setTimeout(r, 400));
    return { mode: window.__mode,
             chief: document.getElementById('itChief').value,
             subj: document.getElementById('itSubjective').value,
             said: document.getElementById('itDictateStorySay').textContent };
  });
  result('the story button sends mode=story, so Whisper expects a history',
    story.mode === 'story', String(story.mode));
  result('the complaint and the story land in their own boxes',
    story.chief === 'fever and headache' && /two days/.test(story.subj) &&
    /no vomiting/.test(story.subj),
    JSON.stringify({ chief: story.chief, subj: story.subj.slice(0, 60) }));
  result('the transcript is shown back word for word',
    /Heard: “Patient complains of fever and headache for two days, no vomiting”/.test(story.said),
    story.said.slice(0, 80));
  result('a denial is drawn to the clinician\'s attention',
    /no vomiting — check that is right/.test(story.said), story.said.slice(-60));

  // Dictating again must ADD. Losing the first sentence is the fault that
  // matters most here, and it is the one a clinician would not notice.
  const again = await page.evaluate(async () => {
    window._getClinicSupabase = () => ({ functions: { invoke: async () =>
      ({ data: { text: 'also complains of joint pain, denies cough' } }) } });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 60));
    btn.click(); await new Promise(r => setTimeout(r, 400));
    return { chief: document.getElementById('itChief').value,
             subj: document.getElementById('itSubjective').value };
  });
  result('dictating a second time adds to the story, it does not wipe it',
    /two days/.test(again.subj) && /joint pain/.test(again.subj),
    JSON.stringify(again.subj).slice(0, 110));

  result('what was typed by hand survives a dictation', await page.evaluate(async () => {
    const c = document.getElementById('itChief');
    c.value = 'typed by hand'; c.dispatchEvent(new Event('input', { bubbles: true }));
    window._getClinicSupabase = () => ({ functions: { invoke: async () =>
      ({ data: { text: 'complains of headache' } }) } });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 60));
    btn.click(); await new Promise(r => setTimeout(r, 400));
    return /typed by hand/.test(document.getElementById('itChief').value);
  }));


  // ── The whole consultation, from one dictation ──────────────────────────
  // Rules own the numbers. The model may name the patient and improve the
  // prose. It may never set a vital and there is no field for a diagnosis.
  async function consult(transcript, fields, opts) {
    return page.evaluate(async ([text, f, o]) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state = 'recording'; this.start = () => {};
        this.stop = () => { this.state = 'inactive';
          if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x']) });
          if (this.onstop) this.onstop(); };
      };
      window.__calls = [];
      window._getClinicSupabase = () => ({ functions: { invoke: async (name, req) => {
        window.__calls.push(name);
        if (name === 'transcribe') return { data: { text } };
        if (name === 'structure') {
          if (o && o.structureFails) return { error: new Error('down') };
          return { data: { fields: f || {} } };
        }
        return { data: {} };
      } } });
      document.getElementById('itTab1').click();
      ['quickPatientName','itChief','itSubjective','itBackground','itAge',
       'itSbp','itDbp','itTemp','itWeight','itPulse'].forEach(id => {
        const e = document.getElementById(id);
        if (e) { e.value=''; e.dispatchEvent(new Event('input',{bubbles:true})); }
      });
      document.querySelectorAll('.it-sex-btn.on').forEach(b => b.click());
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 700));
      const v = id => (document.getElementById(id)||{}).value || '';
      const sexOn = document.querySelector('.it-sex-btn.on');
      return { calls: window.__calls,
               name:v('quickPatientName'), age:v('itAge'),
               sex: sexOn ? sexOn.dataset.sex : '',
               chief:v('itChief'), subj:v('itSubjective'), back:v('itBackground'),
               temp:v('itTemp'), sbp:v('itSbp'), pulse:v('itPulse'),
               said:(document.getElementById('itDictateStorySay')||{}).textContent||'' };
    }, [transcript, fields, opts || {}]);
  }

  const full = await consult(
    'Her name is Jackline Marcy, a 32 year old female, complains of fever and ' +
    'headache for two days, no vomiting, temp 38.5, BP 120 over 80, pulse 96',
    { name:'Jackline Marcy', sex:'female', age:'32', ageUnit:'years',
      complaint:'fever and headache',
      history:'for two days, no vomiting, temp 38.5, BP 120 over 80, pulse 96' });
  result('one dictation fills who they are, what they came with, and the readings',
    full.name === 'Jackline Marcy' && full.sex === 'female' && full.age === '32' &&
    /fever/.test(full.chief) && full.temp === '38.5' && full.sbp === '120' && full.pulse === '96',
    JSON.stringify({n:full.name,s:full.sex,a:full.age,c:full.chief,t:full.temp,bp:full.sbp}));
  result('it asks the server to transcribe, then to split the words up',
    full.calls.join(',') === 'transcribe,structure', full.calls.join(','));

  // The safety property that matters most.
  const hostile = await consult(
    'complains of fever for two days',
    { name:'Jackline Marcy', complaint:'fever',
      history:'for two days',
      // everything below is refused by the app, whatever the model returns
      diagnosis:'Malaria', disease:'Malaria', severity:'severe',
      temp:'41.9', sbp:'190', dbp:'120', pulse:'180', weight:'12',
      medicine:'artemether/lumefantrine', dose:'20/120mg' });
  result('a model cannot set a vital, however insistently it offers one',
    hostile.temp === '' && hostile.sbp === '' && hostile.pulse === '',
    JSON.stringify({temp:hostile.temp,sbp:hostile.sbp,pulse:hostile.pulse}));
  result('a model cannot put a diagnosis or a medicine anywhere on the screen',
    !/malaria/i.test(hostile.chief + hostile.subj + hostile.back) &&
    !/artemether/i.test(hostile.chief + hostile.subj + hostile.back),
    JSON.stringify({c:hostile.chief, s:hostile.subj.slice(0,50)}));

  // If the model drops words, its tidier split is refused and the rules stand.
  const dropped = await consult(
    'complains of fever and headache for two days, no vomiting, has taken panadol',
    { complaint:'fever', history:'for two days' });   // "no vomiting", "panadol" gone
  result('a model that loses words is overruled — nothing spoken disappears',
    /vomiting/.test(dropped.chief + dropped.subj) &&
    /panadol/i.test(dropped.chief + dropped.subj),
    JSON.stringify(dropped.subj).slice(0,110));

  // And with no model at all, the rules alone still do the job.
  // This is the last dictation in the file, so it is the one the panel below
  // is showing — the assertions there quote it.
  const LAST_SAID =
    'her name is Grace Nakato, 40 years old female, complains of cough for a week, temp 37.9';
  const offlineModel = await consult(LAST_SAID, null, { structureFails: true });
  result('when the model is unreachable the rules still fill what they can',
    offlineModel.sex === 'female' && offlineModel.age === '40' &&
    offlineModel.temp === '37.9' && /cough/.test(offlineModel.chief),
    JSON.stringify({s:offlineModel.sex,a:offlineModel.age,t:offlineModel.temp,c:offlineModel.chief}));

  result('a model cannot invent a name for a patient nobody named',
    hostile.name === '', JSON.stringify(hostile.name));

  result('the transcript is shown word for word whatever else happened',
    /Heard: “complains of fever for two days”/.test(hostile.said),
    hostile.said.slice(0, 70));

  // ── The clinician does not wait for the model ───────────────────────────
  // On a clinic connection the second round trip is the slow one. The rules
  // must have filled the boxes before it lands, and what it eventually says
  // must REPLACE their split rather than be appended after it.
  const race = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
    window.MediaRecorder = function () {
      this.state='recording'; this.start=()=>{};
      this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); };
    };
    const SAID = 'complains of fever and headache for two days, no vomiting';
    window._getClinicSupabase = () => ({ functions: { invoke: async (name) => {
      if (name === 'transcribe') return { data: { text: SAID } };
      // the slow one
      await new Promise(r => setTimeout(r, 1200));
      return { data: { fields: { complaint: 'fever and headache',
                                 history: 'for two days, no vomiting' } } };
    } } });
    document.getElementById('itTab1').click();
    ['quickPatientName','itChief','itSubjective','itBackground','itAge'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.value=''; e.dispatchEvent(new Event('input',{bubbles:true})); }
    });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 60));
    btn.click();
    await new Promise(r => setTimeout(r, 350));      // model still out there
    const early = { chief: document.getElementById('itChief').value,
                    subj: document.getElementById('itSubjective').value };
    await new Promise(r => setTimeout(r, 1400));     // model has landed
    const late = { chief: document.getElementById('itChief').value,
                   subj: document.getElementById('itSubjective').value };
    return { early, late };
  });
  result('the boxes are filled before the model answers, not after',
    /fever/.test(race.early.chief) && /two days/.test(race.early.subj),
    JSON.stringify(race.early).slice(0, 90));
  result('when the model does answer it replaces the split, it does not repeat it',
    (race.late.subj.match(/two days/g) || []).length === 1 &&
    (race.late.chief.match(/fever/g) || []).length === 1,
    JSON.stringify(race.late).slice(0, 100));

  // Typing while the model is still thinking must win.
  const typed = await page.evaluate(async () => {
    const SAID = 'complains of fever and headache for two days, no vomiting';
    window._getClinicSupabase = () => ({ functions: { invoke: async (name) => {
      if (name === 'transcribe') return { data: { text: SAID } };
      await new Promise(r => setTimeout(r, 900));
      return { data: { fields: { complaint: 'fever and headache',
                                 history: 'for two days, no vomiting' } } };
    } } });
    ['itChief','itSubjective'].forEach(id => {
      const e = document.getElementById(id);
      e.value=''; e.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const btn = document.getElementById('itDictateStory');
    btn.click(); await new Promise(r => setTimeout(r, 60));
    btn.click(); await new Promise(r => setTimeout(r, 250));
    const c = document.getElementById('itChief');
    c.value = 'what the nurse typed';
    c.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));
    return document.getElementById('itChief').value;
  });
  result('a box typed in while the model was thinking is left alone',
    typed === 'what the nurse typed', JSON.stringify(typed));

  // Put the panel back to a known dictation for the assertions below.
  await consult(LAST_SAID, null, { structureFails: true });


  // ── Check this: everything at the top, before anything is confirmed ─────
  const panel = await page.evaluate(() => {
    const el = document.getElementById('itCheck');
    const shown = el && getComputedStyle(el).display !== 'none';
    const tiles = [...el.querySelectorAll('.it-chk')].map(t => ({
      k: (t.querySelector('.it-chk-k')||{}).textContent || '',
      v: (t.querySelector('.it-chk-v')||{}).textContent || '',
      missing: t.classList.contains('missing'),
    }));
    // the panel must be ABOVE the tabs, not below the suggestions
    const y = id => { const e = document.getElementById(id);
      return e ? e.getBoundingClientRect().top + window.scrollY : 1e9; };
    return { shown, tiles, panelY: y('itCheck'), tabsY: y('itTab1'), impY: y('itImpression'),
             heard: (document.getElementById('itCheckHeardText')||{}).textContent || '' };
  });
  result('after dictating, one panel lists everything that was captured',
    panel.shown && panel.tiles.length === 7,
    panel.tiles.map(t => t.k + '=' + (t.missing ? '—' : t.v.slice(0,18))).join(' | ').slice(0,150));
  result('and it sits at the very top, above the form and the suggestions',
    panel.panelY < panel.tabsY && panel.panelY < panel.impY,
    'panel ' + Math.round(panel.panelY) + ' · tabs ' + Math.round(panel.tabsY) +
    ' · suggestions ' + Math.round(panel.impY));
  result('the words that were heard are kept with it, word for word',
    panel.heard.indexOf(LAST_SAID) >= 0, panel.heard.slice(0, 90));

  // A missing field is shown as missing, and tapping it goes to the box.
  const jump = await page.evaluate(async () => {
    const tiles = [...document.querySelectorAll('#itCheck .it-chk')];
    const bg = tiles.find(t => /Background/i.test(t.textContent));
    const wasMissing = bg.classList.contains('missing');
    bg.click();
    await new Promise(r => setTimeout(r, 400));
    const pane3 = document.getElementById('itPane3');
    return { wasMissing, onTab3: getComputedStyle(pane3).display !== 'none' };
  });
  result('a field nobody filled is marked, and tapping it opens that box',
    jump.wasMissing === true && jump.onTab3 === true, JSON.stringify(jump));

  const dismissed = await page.evaluate(async () => {
    document.getElementById('itCheckOk').click();
    await new Promise(r => setTimeout(r, 150));
    const el = document.getElementById('itCheck');
    return getComputedStyle(el).display === 'none';
  });
  result('"Looks right" puts it away — it never blocks the clinician', dismissed);

  // ── The service being cut off must not read as a bad signal ─────────────
  async function faultOf(kind, message) {
    return page.evaluate(async ([k, m]) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state='recording'; this.start=()=>{};
        this.stop=()=>{ this.state='inactive';
          if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
          if(this.onstop) this.onstop(); };
      };
      window._getClinicSupabase = () => ({ functions: { invoke: async () => ({
        error: { context: { json: async () => ({ error: m, kind: k }) } },
      }) } });
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 500));
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               stored: localStorage.getItem('homatt_dictation_fault') || '' };
    }, [kind, message]);
  }

  const credit = await faultOf('credit',
    'The dictation account is out of credit. Dictation will not work until it ' +
    'is topped up — type the readings for now.');
  result('running out of credit says so plainly, not "try again later"',
    /out of credit/i.test(credit.said) && /"kind":"credit"/.test(credit.stored),
    credit.said.slice(0, 80));

  const busy = await faultOf('busy', 'The dictation service is busy. Wait a moment and try again.');
  result('and being busy is told apart from being cut off',
    /busy/i.test(busy.said) && /"kind":"busy"/.test(busy.stored),
    busy.said.slice(0, 60));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
