// Two rules that change what the books are allowed to suggest, and the
// negation scoper underneath both of them.
//
//   • THE RIGIDITY GUARD — when the clinician writes that there is no
//     rigidity and no guarding, peritonitis and appendicitis go below 10%
//     and out of the list. Unless the patient is shocked, or under five, or
//     something else in the record says the belly is surgical anyway.
//   • REPRODUCTIVE PRIORITY — a woman with lower-quadrant pain plus vaginal
//     discharge or pain on passing urine is grouped toward the gynaecological
//     and urinary causes, and the bowel parasites are left out unless the
//     bowel is actually part of the story.
//
// The assertions that matter most are the ones about what must NOT happen:
// the conditions deliberately left OUT of the demotion list, the presentations
// where the rules must not fire at all, and the inputs that must not make the
// scoper hang.
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
const PORT = 8946, ORIGIN = 'http://localhost:' + PORT;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort());
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const up = await page.evaluate(async () => !!(window.Impression && await window.Impression.ready()));
  if (!up) { console.log('FAIL  the engine did not open'); await b.close(); server.close(); process.exit(1); }

  // Ask with a wide limit so a demoted condition can still be found and its
  // number read — with limit 3 "it is not in the list" and "it scored 8%" are
  // the same observation, and only one of them is what the rule promises.
  const ask = (input) => page.evaluate((i) => {
    const r = window.Impression.suggest(i, 500);
    const at = (t) => { const x = (r.items||[]).find(o => o.title === t); return x ? x.pct : null; };
    return { rules: r.rules, moved: r.moved, hidden: r.hidden, dropped: r.dropped,
             denied: r.denied, terms: r.terms,
             titles: (r.items||[]).map(o => o.title), top3: (r.items||[]).slice(0,3).map(o => o.title),
             flags: (r.flags||[]).map(f => ({ k: f.k, rule: f.rule, t: f.t, w: f.w })),
             pct: { peritonitis: at('Peritonitis'), appendicitis: at('Appendicitis'),
                    pancreatitis: at('Acute Pancreatitis'), ectopic: at('Ectopic Pregnancy'),
                    obstruction: at('Intestinal Obstruction') } };
  }, input);

  const V = { temp:'37.8', pulse:'88', sbp:'118', dbp:'76' };
  const base = { sex:'f', age:'26', ageUnit:'years', chief:'abdominal pain',
                 subjective:'', background:'', vitals: V };

  // ── The negation scoper ─────────────────────────────────────────────────
  const neg = await page.evaluate(() => {
    const d = window.Impression._denials;
    const go = (t) => { const s = Date.now(); const r = d(t); return { drop: r.drop, ms: Date.now()-s }; };
    return {
      guard:   go('lower abdominal pain, no rigidity, no guarding, no rebound tenderness'),
      clause:  go('no vomiting but has diarrhoea'),
      both:    go('pain in the lower abdomen, no pain on passing urine'),
      firm:    go('rigidity and guarding present'),
      never:   go('she has never had convulsions'),
      // Hostile: a cue with nothing after it used to be able to reset the
      // scan to zero and loop for ever, which on a phone is a frozen screen.
      cueEnd:  go('abdominal pain, no'),
      cueStop: go('no. Abdomen distended and tender'),
      cuesOnly:go('no no no not never'),
      empty:   go(''),
      soup:    go('.,;: no ... rigidity'),
    };
  });
  result('a denial stops being searched as evidence for itself',
    ['rigidity','guard','rebound'].every(t => neg.guard.drop.includes(t)),
    'dropped ' + JSON.stringify(neg.guard.drop));
  result('a denial stops at the clause boundary',
    neg.clause.drop.includes('vomit') && !neg.clause.drop.includes('diarrhoea'),
    JSON.stringify(neg.clause.drop));
  result('a word said plainly elsewhere survives being denied once',
    !neg.both.drop.includes('pain'), JSON.stringify(neg.both.drop));
  result('a sign that is PRESENT is never dropped',
    neg.firm.drop.length === 0, JSON.stringify(neg.firm.drop));
  result('"never had X" is a denial',
    neg.never.drop.includes('convulsion'), JSON.stringify(neg.never.drop));
  const hostile = [neg.cueEnd, neg.cueStop, neg.cuesOnly, neg.empty, neg.soup];
  result('a cue with nothing to deny cannot hang the phone',
    hostile.every(h => h.ms < 200) && neg.cueStop.drop.length === 0,
    'slowest ' + Math.max(...hostile.map(h => h.ms)) + 'ms');

  // ── Rule 1 — the rigidity guard ─────────────────────────────────────────
  const soft = await ask(Object.assign({}, base, {
    subjective: 'lower abdominal pain for two days, no rigidity, no guarding, no rebound tenderness' }));
  result('the rigidity guard fires on an explicit denial',
    soft.rules.includes('rigidity'), JSON.stringify(soft.rules));
  result('peritonitis is put below 10%',
    soft.pct.peritonitis !== null && soft.pct.peritonitis < 10, 'peritonitis ' + soft.pct.peritonitis + '%');
  result('appendicitis is put below 10%',
    soft.pct.appendicitis !== null && soft.pct.appendicitis < 10, 'appendicitis ' + soft.pct.appendicitis + '%');
  result('and they leave the three the clinician actually reads',
    !soft.top3.some(t => /peritonitis|appendicitis/i.test(t)), soft.top3.join(' · '));
  result('the demotion is named on screen, not done silently',
    soft.flags.some(f => f.rule === 'rigidity' && /moved to the bottom/.test(f.t)),
    JSON.stringify(soft.flags.map(f => f.t)));
  result('the screen quotes the words that caused it',
    soft.flags.some(f => f.rule === 'rigidity' && /rigidity/.test(f.w)), '');
  result('and says a soft belly does not rule it out',
    soft.flags.some(f => f.rule === 'rigidity' && /does not rule .*out/i.test(f.w)), '');

  // What must NOT be demoted. Each of these was on the first draft of the
  // list and came off for a reason worth keeping a test on.
  result('acute pancreatitis is NOT demoted — the book says it has no rigidity',
    soft.pct.pancreatitis === null || soft.pct.pancreatitis >= 10, 'pancreatitis ' + soft.pct.pancreatitis + '%');
  result('ectopic pregnancy is NOT demoted — an unruptured one has a soft belly',
    soft.pct.ectopic === null || soft.pct.ectopic >= 10, 'ectopic ' + soft.pct.ectopic + '%');
  result('intestinal obstruction is NOT demoted — it is distended and soft',
    soft.pct.obstruction === null || soft.pct.obstruction >= 10, 'obstruction ' + soft.pct.obstruction + '%');

  // The reason quoted has to be the denial that actually caused it.
  const manyDenials = await ask(Object.assign({}, base, {
    subjective: 'lower abdominal pain, no fever, no vomiting, no diarrhoea, no rigidity, no guarding' }));
  result('it quotes the denial that caused it, not the first one in the record',
    manyDenials.flags.some(f => f.rule === 'rigidity' &&
      /rigidity|guarding/.test(f.w) && !/"fever"/.test(f.w)),
    (manyDenials.flags.find(f => f.rule === 'rigidity') || {}).w || 'no rigidity flag');

  const firm = await ask(Object.assign({}, base, {
    subjective: 'lower abdominal pain for two days, rigidity, guarding and rebound tenderness' }));
  result('the same words WITHOUT a denial demote nothing',
    !firm.rules.includes('rigidity') && firm.moved.length === 0, JSON.stringify(firm.rules));

  const mixed = await ask(Object.assign({}, base, {
    subjective: 'abdominal pain with rigidity of the abdomen, no guarding' }));
  result('rigidity present plus "no guarding" is a contradiction, not a soft belly',
    !mixed.rules.includes('rigidity'), JSON.stringify(mixed.rules));

  const shocked = await ask({ sex:'m', age:'34', ageUnit:'years', chief:'abdominal pain',
    subjective:'severe abdominal pain, no rigidity, no guarding, vomiting', background:'',
    vitals: { temp:'39.4', pulse:'132', sbp:'82', dbp:'54' } });
  result('a shocked patient keeps the emergency however soft the belly',
    shocked.rules.includes('rigidity-held') && shocked.moved.length === 0, JSON.stringify(shocked.rules));
  result('and the screen says why, as a danger',
    shocked.flags.some(f => f.rule === 'rigidity-held' && f.k === 'danger'), '');

  // The shock index catches the young adult who is still compensating and
  // whom neither "systolic under 90" nor "pulse over 120" can see.
  const compensating = await ask({ sex:'f', age:'22', ageUnit:'years', chief:'abdominal pain',
    subjective:'abdominal pain since yesterday, no rigidity, no guarding', background:'',
    vitals: { temp:'38.0', pulse:'112', sbp:'115', dbp:'70' } });
  result('a pulse that has caught the systolic suspends the guard',
    compensating.rules.includes('rigidity-held'), JSON.stringify(compensating.rules));

  const infant = await ask({ sex:'f', age:'11', ageUnit:'months', chief:'abdominal pain',
    subjective:'crying and abdominal pain, no rigidity, no guarding', background:'',
    vitals: { temp:'38.4', pulse:'', sbp:'', dbp:'' } });
  result('under five, "no guarding" is not a finding that can be taken to order',
    infant.rules.includes('rigidity-held') && infant.moved.length === 0, JSON.stringify(infant.rules));

  const silent = await ask(Object.assign({}, base, {
    subjective:'abdominal pain, no rigidity, no guarding, abdomen distended, not passing stool or flatus' }));
  result('a distended silent belly suspends the guard even when it is soft',
    silent.rules.includes('rigidity-held'), JSON.stringify(silent.rules));

  // ── Rule 2 — reproductive priority ──────────────────────────────────────
  const pelvic = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'lower abdominal pain for one week with smelly vaginal discharge and painful urination',
    vitals: { temp:'38.2', pulse:'96', sbp:'112', dbp:'70' } }));
  result('a woman with lower pain plus discharge groups toward gynae and urinary',
    pelvic.rules.includes('pelvic'), JSON.stringify(pelvic.rules));
  result('and pelvic inflammatory disease comes first',
    /pelvic inflammatory/i.test(pelvic.top3[0] || ''), pelvic.top3.join(' · '));
  result('the bowel parasites are left out',
    !pelvic.titles.some(t => /amoebiasis|giardiasis|taeniasis|intestinal worms|helminth|^worms$/i.test(t))
      && pelvic.hidden.length > 0,
    'left out: ' + pelvic.hidden.join(', '));
  // Pinworm is deliberately NOT on the suppression list: in a girl it causes
  // vulvovaginitis and dysuria, so it is a real answer to this presentation
  // rather than a bowel parasite that has wandered in.
  result('pinworm is not suppressed — it genuinely presents this way',
    !pelvic.hidden.some(t => /pinworm/i.test(t)), 'left out: ' + pelvic.hidden.join(', '));
  result('and the screen says they were left out and how to get them back',
    pelvic.flags.some(f => f.rule === 'pelvic' && /diarrhoea/.test(f.w)), '');
  result('the screen calls the grouping an assumption, not a finding',
    pelvic.flags.some(f => f.rule === 'pelvic' && /assumption, not a finding/.test(f.w)), '');
  result('and names what it must not be allowed to hide',
    pelvic.flags.some(f => f.rule === 'pelvic' && /ectopic/.test(f.w) && /appendicitis/.test(f.w)), '');

  const withDiarr = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'lower abdominal pain with vaginal discharge, painful urination and bloody diarrhoea for three days',
    vitals: { temp:'38.2', pulse:'96', sbp:'112', dbp:'70' } }));
  result('say there is diarrhoea and the parasites come straight back',
    withDiarr.hidden.length === 0 && withDiarr.titles.some(t => /amoebiasis/i.test(t)),
    'hidden ' + JSON.stringify(withDiarr.hidden));

  const liver = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'lower abdominal pain and vaginal discharge, also pain in the right sub-costal area with weight loss and night sweats' }));
  result('an amoebic liver abscess has no diarrhoea, and is not hidden either',
    liver.hidden.length === 0, 'hidden ' + JSON.stringify(liver.hidden));

  const schisto = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'low abdominal pain with abnormal vaginal discharge and frequent painful urination, blood at the end of urination' }));
  result('schistosomiasis is a worm that presents exactly like this — it is never hidden',
    !schisto.hidden.some(t => /schisto/i.test(t)), 'hidden ' + JSON.stringify(schisto.hidden));

  const man = await ask({ sex:'m', age:'24', ageUnit:'years', chief:'lower abdominal pain',
    subjective:'lower abdominal pain and painful urination for one week', background:'',
    vitals: { temp:'38.2', pulse:'96', sbp:'112', dbp:'70' } });
  result('it does not fire for a man',
    !man.rules.includes('pelvic') && man.hidden.length === 0, JSON.stringify(man.rules));

  const upper = await ask(Object.assign({}, base, { chief:'upper abdominal pain',
    subjective:'upper abdominal pain and epigastric burning with vaginal discharge' }));
  result('it does not fire on upper abdominal pain',
    !upper.rules.includes('pelvic'), JSON.stringify(upper.rules));

  // "chest in-drawing" is rewritten to "lower chest wall indrawing", which
  // puts the word "lower" into a child's pneumonia. A rule that tested for
  // "lower" and "pain" would fire on it.
  const pneumonia = await ask({ sex:'f', age:'3', ageUnit:'years', chief:'cough',
    subjective:'fever, cough and chest in-drawing, chest pain when breathing', background:'has ear discharge',
    vitals: { temp:'39.1', pulse:'140', sbp:'', dbp:'' } });
  result('"chest in-drawing" injects the word "lower" and must not trigger it',
    !pneumonia.rules.includes('pelvic'), JSON.stringify(pneumonia.rules));
  result('an ear discharge is not a vaginal discharge',
    !pneumonia.rules.includes('pelvic'), '');

  const dischargedHome = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'lower abdominal pain since she was discharged from the hospital last week' }));
  result('"discharged from hospital" is not a discharge',
    !dischargedHome.rules.includes('pelvic'), JSON.stringify(dischargedHome.rules));

  // The denial scoper blanks denied words in place rather than joining the
  // survivors, so a comma still separates two ideas. Joining them turned
  // "pain, urine is dark" into "pain urine" and read it as dysuria.
  const darkUrine = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'pain in the lower abdomen, urine is dark, no discharge' }));
  result('a comma still separates two ideas after a denial is removed',
    !darkUrine.rules.includes('pelvic'), JSON.stringify(darkUrine.rules));

  const deniedDischarge = await ask(Object.assign({}, base, { chief:'lower abdominal pain',
    subjective:'lower abdominal pain, no vaginal discharge, no pain on passing urine' }));
  result('a DENIED discharge does not trigger it either',
    !deniedDischarge.rules.includes('pelvic'), JSON.stringify(deniedDischarge.rules));

  // ── Nothing else moved ──────────────────────────────────────────────────
  const child = await ask({ sex:'m', age:'3', ageUnit:'years', chief:'fever and cough',
    subjective:'fever for three days with cough and fast breathing', background:'',
    vitals: { temp:'39.1', pulse:'140', sbp:'', dbp:'' } });
  result('an ordinary case has no rule fire on it at all',
    child.rules.filter(r => r !== 'thin').length === 0 && child.hidden.length === 0 &&
      child.dropped.length === 0,
    JSON.stringify(child.rules));
  result('and still answers pneumonia', /pneumonia/i.test(child.top3[0] || ''), child.top3[0]);

  // A careful negative examination can leave almost nothing to search on, and
  // the top percentage is relative to the rest of the list rather than to the
  // disease — so a two-word query returns a confident-looking list of junk.
  const thin = await ask(Object.assign({}, base, {
    subjective: 'lower abdominal pain, no rigidity, no guarding, no rebound tenderness' }));
  result('a query left this thin says so instead of looking confident',
    thin.rules.includes('thin') &&
      thin.flags.some(f => f.rule === 'thin' && /close to a guess/.test(f.w)),
    'searched on: ' + thin.terms.join(', '));
  const full = await ask(Object.assign({}, base, {
    subjective: 'lower abdominal pain for two days with vomiting and fever, no rigidity, no guarding' }));
  result('an ordinary amount of detail does not', !full.rules.includes('thin'),
    'searched on: ' + full.terms.join(', '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
