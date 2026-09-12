/* Homatt Health — what might this be?
 *
 * WHAT THIS IS
 * ------------
 * The nurse writes what the patient complains of, measures a few vitals, and
 * this suggests — from the guideline books already on the phone — up to three
 * conditions worth considering, what in the record points to each, and which
 * tests would confirm it.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a diagnosis, and the number beside each suggestion is not a
 * probability of disease. Nothing here can know that. The figure is a MATCH
 * strength: how strongly the findings written down line up with how the
 * guideline describes that condition. The screen says so, every time, and the
 * clinician confirms the diagnosis — the app never does.
 *
 * WHERE THE ANSWERS COME FROM
 * ---------------------------
 *   1. The WHO pocket book's 44 "Differential diagnosis of X" tables — a
 *      clinician-written map from presenting complaint to candidate diagnoses,
 *      each with the findings that count in its favour. Shipped as a 256 KB
 *      index (impression_index.db), not the whole 3.3 MB book.
 *   2. The Uganda Clinical Guidelines 2023 — already open on this screen for
 *      the one-tap package, so it costs nothing more.
 * Every suggestion carries the book and page it came from.
 *
 * HOW WELL IT WORKS
 * -----------------
 * Measured, not assumed, against two benchmarks built from the books rather
 * than from examples chosen to flatter it:
 *   • 237/241 (98%) — given the findings the WHO book itself lists in favour
 *     of a diagnosis, that diagnosis is in the top 3.
 *   • 290/306 (94%) — given half of a UCG condition's clinical features, that
 *     condition is in the top 3, competing against all 535.
 * On twelve presentations written by hand it finds the expected condition in
 * nine; the three it misses it answers with a clinically adjacent one
 * (severe dehydration for a dehydrated child with diarrhoea, otitis externa
 * for otitis media). It runs entirely on the phone: no network, no server.
 */
(function () {
  'use strict';

  // ?v= must match DATA_VERSION in clinic-sw.js — see guidelines.js.
  var IDX_URL = 'data/impression_index.db?v=144';
  var idx = null, idxLoading = null;

  // ── Lay speech → the words the books use ────────────────────────────────
  // A nurse writes "shortness of breath"; without this it becomes the useless
  // words "short" and "breath" and anaemia loses to asthma. Kept small,
  // explicit and one-directional.
  var SAY_AS = [
    [/\bshort(?:ness)?\s+of\s+breath\b/g, 'breathlessness dyspnoea difficulty in breathing'],
    [/\bhard\s+to\s+breathe\b/g, 'difficulty in breathing'],
    [/\bneck\s+stiff(?:ness)?\b/g, 'stiff neck'],
    [/\brunning\s+stomach\b/g, 'diarrhoea'],
    [/\bloose\s+stools?\b/g, 'diarrhoea'],
    [/\bhot\s+body\b/g, 'fever'],
    [/\bbody\s+hotness\b/g, 'fever'],
    [/\bfeeling\s+cold\b/g, 'chills'],
    [/\bshivering\b/g, 'rigors chills'],
    [/\bpassing\s+urine\b/g, 'urination'],
    [/\bburning\s+urine\b/g, 'dysuria burning on urination'],
    [/\bpain(?:ful)?\s+urin\w*/g, 'dysuria'],
    [/\bthrowing\s+up\b/g, 'vomiting'],
    [/\bstomach\s+(?:pain|ache)\b/g, 'abdominal pain'],
    [/\bbelly\s+pain\b/g, 'abdominal pain'],
    [/\bchest\s+in-?drawing\b/g, 'lower chest wall indrawing'],
    [/\bfast\s+breath\w*/g, 'fast breathing'],
    [/\bweight\s+loss\b/g, 'loss of weight'],
    [/\bnight\s+sweat\w*/g, 'night sweats'],
    [/\bgeneral\s+body\s+weakness\b/g, 'weakness fatigue malaise'],
    [/\bfeeling\s+weak\b/g, 'weakness fatigue'],
    [/\btired(?:ness)?\b/g, 'fatigue tiredness'],
    [/\bdizz\w*/g, 'dizziness'],
    [/\bblood\s+in\s+stool\b/g, 'bloody diarrhoea'],
    [/\bwatery?\s+stool\w*/g, 'watery diarrhoea'],
    [/\bsunken\s+eyes?\b/g, 'sunken eyes dehydration'],
    [/\bnot\s+eating\b/g, 'poor feeding anorexia'],
    [/\brefus\w*\s+to\s+(?:eat|feed|breastfeed)\b/g, 'unable to feed poor feeding'],
    [/\bfits?\b/g, 'convulsions'],
    [/\bconvuls\w*/g, 'convulsions'],
    [/\bunconscious\w*/g, 'unconscious coma lethargy'],
  ];

  var STOP = {};
  ('the and for with without this that from have has had was were are is be been being ' +
   'you your they them their his her its our not but all any can may will would should could ' +
   'patient patients child children adult adults year years month months day days week weeks ' +
   'old age since ago also very much more less than then when where which who what how ' +
   'complains complaining complained presented presenting presents history reports reported ' +
   'says said feels feeling felt started begun began noticed seen about other others ' +
   'left right side both upper lower general normal abnormal past known case cases usually ' +
   'mild moderate severe severely acute chronic slight marked ' +
   'done taken take taking give given signs symptoms sign symptom favour episode episodes ' +
   'often sometimes may commonly rare common associated including such present ' +
   'one two three four five six seven eight nine ten').split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  var SUFFIX = /(ing|ness|edly|ed|ies|es|s|ly)$/;
  function stem(w) {
    if (w.length <= 4) return w;
    var m = SUFFIX.exec(w);
    if (m && w.length - m[0].length >= 4) {
      w = w.slice(0, w.length - m[0].length);
      if (w.charAt(w.length - 1) === 'i') w = w.slice(0, -1) + 'y';
    }
    return w;
  }
  function expand(t) {
    t = ' ' + String(t || '').toLowerCase() + ' ';
    for (var i = 0; i < SAY_AS.length; i++) t = t.replace(SAY_AS[i][0], ' ' + SAY_AS[i][1] + ' ');
    return t;
  }
  // uniq=false keeps repeats, which is what a term frequency is made of.
  function toks(t, uniq) {
    if (uniq === undefined) uniq = true;
    var out = [], m, rx = /[a-z]{3,}/g, s = expand(t);
    while ((m = rx.exec(s))) {
      if (STOP[m[0]]) continue;
      var k = stem(m[0]);
      if (uniq && out.indexOf(k) >= 0) continue;
      out.push(k);
    }
    return out;
  }

  // ── What the clinician said was NOT there ───────────────────────────────
  //
  // Until this existed, a denial was scored as evidence FOR the thing denied.
  // "no rigidity, no guarding, no rebound" tokenised to rigidity/guard/rebound
  // — three rare, high-IDF words — and put Peritonitis top at 79%, above the
  // score the same engine gave when those signs were actually PRESENT (57%).
  // Writing down a careful negative examination made the emergency look more
  // likely, not less. That is the fault the rigidity guard below is built on,
  // and it applies to every denial a clinician writes, not only these three.
  //
  // This is a small NegEx: find a cue, read forward a bounded distance, stop
  // at the first thing that ends the denial. It runs on the QUERY only. The
  // indexed documents are left exactly as the books wrote them — "in the
  // absence of peritonitis there is no rigidity" is Acute Pancreatitis's own
  // description of itself, and rewriting the book to match a phone would be a
  // far larger and worse change.
  var NEG_CUE = /^(?:no|not|denies|denied|denying|without|never|nil|none|nothing)$/;
  var NEG_CUE2 = { negative: 'for', free: 'of' };
  // A new clause ends the denial: "no vomiting BUT HAS diarrhoea".
  var NEG_STOP = /^(?:but|however|although|though|except|apart|yet|plus|with|has|have|had|is|was|were|are|been|being|complains|complaining|reports|presents|presented|states|says|said|tells|told|positive|present|noted|noticed|seen|found|shows|showing|started|since|now|only|still|when|while|which|who|because|after|before|during)$/;
  // ...but these keep a list of denied things running: "no fever or cough".
  var NEG_CARRY = /^(?:or|and|nor|any|of|the|a|an|to|on|in|per|new)$/;
  // "never HAD convulsions" — an auxiliary sitting directly on the cue is part
  // of the denial; the same word later in the sentence starts a new clause.
  var NEG_AUX = /^(?:had|has|have|is|was|were|been|being|got|gets)$/;
  // "no fever AND THE mother says…" — a determiner after a conjunction opens a
  // new noun phrase, so the list of denied things has ended.
  var NEG_NEW = /^(?:the|a|an|she|he|they|it|we|i|you|his|her|their|this|that|my)$/;
  var NEG_WINDOW = 4;

  function denials(text) {
    var s = expand(text);
    var words = [], rx = /([^a-z]*)([a-z]+)/g, m;
    while ((m = rx.exec(s))) {
      words.push({ w: m[2], gap: m[1], a: m.index + m[1].length, b: rx.lastIndex });
    }
    var inScope = {}, spans = [];
    for (var i = 0; i < words.length; i++) {
      var start = -1;
      if (NEG_CUE.test(words[i].w)) start = i + 1;
      else if (NEG_CUE2[words[i].w] && words[i + 1] &&
               words[i + 1].w === NEG_CUE2[words[i].w]) start = i + 2;
      if (start < 0 || start >= words.length) continue;
      var taken = 0, from = -1, to = -1;
      for (var j = start; j < words.length; j++) {
        var wd = words[j];
        if (/[.;:!?,()\/]/.test(wd.gap)) break;                 // punctuation ends it
        if (NEG_STOP.test(wd.w) && !(j === start && NEG_AUX.test(wd.w))) break;
        if (NEG_CUE.test(wd.w) || NEG_CUE2[wd.w]) break;        // the next denial ends it
        if (/^(?:and|or|nor)$/.test(wd.w) && words[j + 1] && NEG_NEW.test(words[j + 1].w)) break;
        if (from < 0) from = wd.a;
        to = wd.b;
        inScope[j] = 1;
        if (!NEG_CARRY.test(wd.w) && !STOP[wd.w]) { taken++; if (taken >= NEG_WINDOW) break; }
      }
      if (from >= 0) spans.push(s.slice(from, to).trim());
      // i only ever moves forward, so no input can make this loop for ever.
    }
    // What is left once the denied words are taken out. Built by blanking
    // those words where they stand rather than by joining the survivors,
    // because the punctuation has to stay: the predicates below use a comma
    // to tell "pain, urine is dark" from "pain on passing urine", and joining
    // words would turn the first into the second.
    var chars = s.split(''), denied = [];
    for (var k = 0; k < words.length; k++) {
      if (!inScope[k]) continue;
      denied.push(words[k].w);
      for (var c = words[k].a; c < words[k].b; c++) chars[c] = ' ';
    }
    var said = chars.join('');
    var affirmed = toks(said);
    // A word said plainly somewhere else is not denied. "pain in the lower
    // abdomen, no pain on passing urine" must not lose "pain" — so the tokens
    // to drop are the denied ones MINUS everything affirmed anywhere.
    var drop = toks(denied.join(' ')).filter(function (t) { return affirmed.indexOf(t) < 0; });
    return { drop: drop, spans: spans, said: ' ' + said + ' ', raw: s };
  }
  function deniedStem(neg, t) { return neg.drop.indexOf(t) >= 0; }

  // ── Vitals become the words the books use ───────────────────────────────
  // A temperature of 39.4 is not a word the guideline can match. "Fever" is.
  function vitalTerms(v) {
    var o = [];
    v = v || {};
    var t = parseFloat(v.temp), p = parseFloat(v.pulse),
        s = parseFloat(v.sbp), d = parseFloat(v.dbp);
    if (isFinite(t)) {
      if (t >= 40) o.push('hyperpyrexia', 'fever');
      else if (t >= 38) o.push('fever');
      else if (t < 35.5) o.push('hypothermia');
    }
    if (isFinite(p)) {
      if (p >= 120) o.push('tachycardia');
      else if (p > 0 && p < 50) o.push('bradycardia');
    }
    if (isFinite(s) && isFinite(d)) {
      if (s >= 140 || d >= 90) o.push('hypertension');
      else if (s > 0 && s < 90) o.push('shock', 'hypotension');
    }
    return o.map(stem);
  }

  // What the vitals themselves say, in plain words, shown to the nurse.
  function vitalFlags(v) {
    var out = [];
    v = v || {};
    var t = parseFloat(v.temp), p = parseFloat(v.pulse),
        s = parseFloat(v.sbp), d = parseFloat(v.dbp);
    if (isFinite(t)) {
      if (t >= 40) out.push({ k: 'danger', t: 'Very high fever (' + t + '°C)', w: 'Hyperpyrexia — bring the temperature down and look for a cause' });
      else if (t >= 38) out.push({ k: 'warn', t: 'Fever (' + t + '°C)', w: '' });
      else if (t < 35.5 && t > 25) out.push({ k: 'danger', t: 'Low temperature (' + t + '°C)', w: 'Hypothermia — keep warm, this is a danger sign' });
    }
    if (isFinite(p) && p > 0) {
      if (p >= 120) out.push({ k: 'warn', t: 'Fast pulse (' + p + '/min)', w: '' });
      else if (p < 50) out.push({ k: 'danger', t: 'Slow pulse (' + p + '/min)', w: '' });
    }
    if (isFinite(s) && isFinite(d) && s > 0) {
      if (s >= 140 || d >= 90) out.push({ k: 'warn', t: 'High blood pressure (' + s + '/' + d + ')', w: '' });
      else if (s < 90) out.push({ k: 'danger', t: 'Low blood pressure (' + s + '/' + d + ')', w: 'Check for shock' });
    }
    return out;
  }

  // ── Two rules, and the lists they act on ────────────────────────────────
  //
  // Both lists are explicit title_normalized values, checked one by one
  // against impression_index.db. They are NOT text matches, and that is the
  // whole point: a search of the documents for "peritonitis" or "rebound"
  // catches Typhoid Fever, Ectopic Pregnancy, PID, Acute Pancreatitis and
  // Peptic Ulcer Disease, because each of those describes peritonitis as a
  // complication of itself. A rule that demotes on a text match would suppress
  // the ruptured ectopic in the same breath as the peritonitis.

  // RULE 1 — demoted when rigidity and guarding are recorded as ABSENT.
  // Only conditions whose diagnosis genuinely turns on those two signs. The
  // list started at six and was cut to three on review; what came off, and
  // why, matters more than what stayed:
  //   • ectopic pregnancy   — an UNRUPTURED tubal pregnancy has a soft
  //                           abdomen. It is the one window in which the woman
  //                           can still be saved cheaply, and demoting it on a
  //                           soft belly closes exactly that window.
  //   • intestinal obstruction — distended, tympanitic and soft until it
  //                           strangulates; the book names no peritoneal sign.
  //   • intussusception     — in a screaming infant guarding cannot be
  //                           assessed at all, so "no guarding" in a
  //                           paediatric note is usually an artefact.
  //   • acute pancreatitis  — the book says, in as many words, "in the absence
  //                           of peritonitis there is no rigidity/rebound".
  //   • spontaneous bacterial peritonitis — carries the word, is not a
  //                           surgical abdomen, and has a soft belly by rule.
  var ACUTE_ABDOMEN = ['peritonitis', 'acute appendicitis', 'appendicitis'];

  // RULE 2 — moved up for a woman with lower-quadrant pain plus discharge or
  // dysuria. Ectopic pregnancy is deliberately IN this list. It shares the
  // trigger exactly — sexually active woman, lower abdominal pain, spotting,
  // urinary frequency — and treating a discharge as evidence for PID and
  // therefore against ectopic is the classic fatal error. It is boosted with
  // the rest, never in place of them.
  var GYNAE_URO = [
    'pelvic inflammatory disease', 'abnormal vaginal discharge syndrome',
    'vaginitis vulvovaginitis', 'candidiasis', 'trichomoniasis trichomonas vaginalis',
    'gonorrhoea neisseria gonorrhoeae vesicle s or ulcer s present', 'urethritis',
    'genital herpes', 'genital herpes herpes simplex virus 2', 'dysmenorrhoea',
    'ectopic pregnancy', 'vaginal bleeding in early pregnancy abortion',
    'puerperal fever sepsis',
    'acute cystitis', 'acute pyelonephritis', 'urinary tract infection',
    'urine tract infection', 'urinary tract infections in pregnancy',
    'prostatitis', 'epididymoorchitis', 'painful scrotal swelling',
    // Schistosomiasis is here, in the list that gets RAISED, and it is the
    // single most important entry on either list. Its own UCG text reads:
    // "In females: low abdominal pain and abnormal vaginal discharge" and
    // "Frequent and painful micturition". That is this rule's trigger, word
    // for word, produced by a worm — endemic around Victoria, Albert and the
    // Nile. Filed as a parasite it would have been suppressed by the very
    // presentation that should raise it, PID antibiotics would do nothing,
    // and untreated female genital schistosomiasis raises HIV risk.
    'schistosomiasis',
  ];

  // RULE 2 — hidden for that same presentation unless the bowel is part of the
  // story. Deliberately short. A condition only belongs here if bowel symptoms
  // are genuinely required for it to be the answer.
  var GI_PARASITE = ['amoebiasis', 'giardiasis', 'intestinal worms',
                     'taeniasis', 'worms', 'helminthes parasites'];

  function inList(list, norm) { return list.indexOf(norm) >= 0; }

  // ── Reading the presentation out of the prose ───────────────────────────
  // These run on the text, not the tokens, because "lower", "left", "right"
  // and "upper" are all STOP words and never survive toks().
  var PAIN = '(?:pain(?!less)\\w*|ache\\w*|aching|cramp\\w*|colic|discomfort|tender\\w*|hurt\\w*|sore\\w*)';
  var ABD = '(?:abdomen|abdomin\\w*|stomach\\w*|tummy|belly|bellie|pelvis|pelvic|womb|uterus|groin)';
  // The gap between two ideas is a list of function words, never \w+ — an
  // open gap turns "pain and normal urine" into dysuria.
  var GAP = '(?:\\s+(?:in|on|at|of|the|her|his|she|he|is|was|are|and|to|from|around|a|an|it|that|there|this|below|down|part|region|area|side|feels|feeling|felt|has|have|had|with|complains|some|bad|really|just)){0,4}\\s+';
  function near(a, b) { return new RegExp('(?:' + a + GAP + b + '|' + b + GAP + a + ')'); }

  // A. Pain in the lower quadrants. Never tests the word "lower" on its own:
  //    SAY_AS rewrites "chest in-drawing" to "lower chest wall indrawing", so
  //    a bare lower+pain test fires on a child with pneumonia.
  var LOW_SITE = '\\b(?:low|lower)\\s+(?:part\\s+(?:of\\s+)?(?:the\\s+|her\\s+)?)?' + ABD;
  var A_SITE = near(LOW_SITE, PAIN);
  var A_QUAD = /\b(?:left|right|l|r)?\s*lower\s+quadrant\b|\b[lr]\s*\.?\s*l\s*\.?\s*q\b|\b(?:left|right|l|r)\s*\.?\s*ilia?c\s+foss?a\b|\b[lr]\s*\.?\s*i\s*\.?\s*f\b/;
  var A_PUBIC = /\bsupra[\s-]*(?:pubic|public|pubis)\b|\babove\s+the\s+(?:pubis|pubic\s+bone)\b/;
  var A_PELVIC = new RegExp('\\bpelvi[cs]\\s+(?!inflammatory)(?:region\\s+|area\\s+)?' + PAIN +
                            '|' + PAIN + GAP + 'pelvi[cs]\\b(?!\\s+inflammatory)');
  var A_NAVEL = near(PAIN, '(?:below|under|beneath)\\s+(?:the\\s+|her\\s+)?(?:navel|naval|umbilicus|belly\\s*button)');
  function lowerPain(x) {
    return A_SITE.test(x) || A_QUAD.test(x) || A_PUBIC.test(x) ||
           A_PELVIC.test(x) || A_NAVEL.test(x);
  }

  // B. Vaginal discharge. "discharg(es|ing)" cannot match "discharged", which
  //    is what kills "discharged from hospital" at the word level.
  var VAG = '(?:vagin\\w*|vajin\\w*|birth\\s+canal|private\\s+part\\w*|p\\s*\\/?\\s*v)';
  var DIS = 'discharg(?:es?|ing)\\b';
  var B_CLEAR = new RegExp('\\b' + VAG + '(?:\\s+\\w+){0,2}\\s+' + DIS + '|\\b' + DIS +
                           '(?:\\s+\\w+){0,3}\\s+(?:from|per|through|out\\s+of|in)\\s+(?:the\\s+|her\\s+|a\\s+)?' + VAG);
  var B_BARE = new RegExp('\\b(?:has|had|having|with|noticed|passing|complains\\s+of|there\\s+is|some|her|a|the|' +
                          'smell\\w*|foul\\w*|offensive|itch\\w*|whit\\w*|yellow\\w*|green\\w*|creamy|curd\\w*|thick|watery|abnormal|bad|milky|brown\\w*)\\s+(?:\\w+\\s+){0,2}' + DIS);
  var B_ELSEWHERE = /\b(?:nasal|nose|nostril\w*|ear|ears|aural|eye|eyes|conjunctiv\w*|wound\w*|umbilical|umbilicus|navel|cord|nipple|breast\w*|throat|sinus\w*|skin|ulcer\w*|penile|penis|urethral|anal|anus|rectal)(?:\s+\w+){0,2}\s+discharg/;
  var B_HOSPITAL = /\bdischarg\w*(?:\s+\w+){0,2}\s+(?:from\s+)?(?:the\s+)?(?:hospital|ward|clinic|facility|health\s+centre)\b/;
  function vaginalDischarge(x) {
    if (B_CLEAR.test(x)) return true;               // said plainly — always counts
    if (B_ELSEWHERE.test(x) || B_HOSPITAL.test(x)) return false;
    return B_BARE.test(x);                          // "she has discharge", nothing else claiming it
  }

  // C. Painful urination. SAY_AS rewrites "passing urine" to "urination"
  //    BEFORE it rewrites "pain(ful) urin*" to "dysuria", so "pain when
  //    passing urine" arrives as "pain when urination" and never becomes
  //    dysuria. Without the second branch this predicate misses the commonest
  //    way a Ugandan patient says it.
  var C_WORD = /\bd[iy]s+ur[ei][ao]?\b/;
  var C_BURN = '(?:burn\\w*|scald\\w*|pain(?!less)\\w*|hurt\\w*|sting\\w*|hot|hotness|sharp)';
  var C_URINE = '(?:urinat\\w*|urination|urine|micturit\\w*|short\\s+call|peeing|pee)';
  var C_FILL = '(?:\\s+(?:when|whenever|while|during|on|upon|after|as|if|she|he|her|his|him|it|is|was|are|the|a|an|of|to|in|at|feel|feels|feeling|felt|sensation|passing|goes|going|there|that)){0,3}\\s+';
  var C_NEAR = new RegExp('(?:' + C_BURN + C_FILL + C_URINE + '|' + C_URINE + C_FILL + C_BURN + ')');
  function dysuria(x) { return C_WORD.test(x) || C_NEAR.test(x); }

  // D. Is the bowel part of the story? This is what lets a parasite back in.
  var D_DIARR = /\b(?:d[iy]a[rh]{1,4}[oe]{0,2}a|d[iy]s+ent[ae]?r[yi]\w*|d[iy]s+entry)\b/;
  var D_STOOL = /\b(?:bloody|blood[\s-]*stained|mucoid|muco?us|slim(?:y|e)|watery|loose|frequent)\s+(?:\w+\s+){0,1}(?:stool\w*|motions?)\b|\b(?:blood|mucus|slime)\s+in\s+(?:the\s+|her\s+|his\s+)?stool\w*|\bloose\s+motions?\b|\brunn(?:ing|y)\s+(?:stomach|tummy|belly)\b|\bpurging\b|\bstooling\b/;
  // Not diarrhoea, but still the bowel or the liver talking — and enough to
  // stop a parasite being hidden. Amoebiasis has five presentations in the
  // book and only ONE of them is dysentery: a liver abscess is right
  // sub-costal pain, fever, chills, sweating and weight loss with no diarrhoea
  // at all, and an amoeboma is a mass with constipation. Suppression keyed on
  // the absence of a symptom must never be applied to a condition whose worst
  // form does not have that symptom.
  var D_OTHER = /\btenesmus\b|\bworms?\s+(?:seen|passed|in\s+(?:the\s+)?stool)|\bpass\w*\s+worms?\b|\b(?:right\s+)?(?:sub[\s-]*costal|upper\s+quadrant|hypochondri\w*)\b|\bliver\b|\bhepatomegal\w*|\bloss\s+of\s+weight\b|\bnight\s+sweats?\b|\bmass\b|\bswelling\s+in\s+(?:the\s+)?abdomen\b|\bconstipat\w*/;
  function bowelInPlay(x) { return D_DIARR.test(x) || D_STOOL.test(x) || D_OTHER.test(x); }

  // ── When the rigidity guard must NOT fire ───────────────────────────────
  // A soft belly does not mean a safe belly. Peritonitis is present without
  // rigidity in advanced HIV, in the elderly, in the malnourished, on
  // steroids, and — the lethal one — in late decompensated disease, where the
  // abdomen goes from rigid to flaccid as the patient deteriorates. At the
  // point of maximum danger the guarding is gone. Late presentation is the
  // Ugandan norm.
  //
  // Nor can the parser tell "examined, and it was soft" from "not examined"
  // or "could not assess". The string is identical.
  //
  // So these suspend the demotion. Checked on the text as WRITTEN, not on the
  // denial-stripped text, because some of the worst signs are phrased as
  // negatives — "not passing stool", "no bowel sounds" — and stripping them as
  // denials would delete the danger sign along with the reassurance.
  var RED_SAID = /\bnot?\s+(?:passing|passed|opening|opened)\s+(?:any\s+)?(?:stool|flatus|gas|wind|urine|bowel)|\b(?:absent|no)\s+bowel\s+sounds?\b|\bnot?\s+(?:keep|keeping)\s+anything\s+down\b/;
  var RED_FOUND = /\b(?:board|boardlike|board[\s-]like|hard|rigid|woody)\s+(?:and\s+\w+\s+)?(?:abdomen|belly|tummy)\b|\babdomen\s+(?:is\s+)?(?:hard|board\w*|rigid|woody)\b|\brebound\b|\bdisten[sd]\w*|\bswollen\s+(?:abdomen|belly|tummy)\b|\bbilious\b|\bfaeculent\b|\bvomit\w*\s+(?:green|everything)\b|\bshoulder\s+tip\b|\bcollapse\w*|\bconfus\w*|\bdrowsi?\w*|\bunconscious\w*|\bcold\s+(?:and\s+)?clammy\b|\bhiv\b|\bar[vt]s?\b|\bsteroid\w*|\blaparotom\w*|\bmissed\s+(?:her\s+)?period\b/;

  function surgicalRedFlags(input, neg, band) {
    var why = [];
    var v = input.vitals || {};
    var t = parseFloat(v.temp), p = parseFloat(v.pulse),
        s = parseFloat(v.sbp), d = parseFloat(v.dbp);
    // Under five, guarding is not a sign that can be taken to order.
    if (band === 'paediatric') why.push('the patient is under five');
    // One reason from the circulation, not four names for the same collapse.
    // The shock index is the interesting one: it catches the compensating
    // 22-year-old at 110/115, whom neither "pulse over 120" nor "systolic
    // under 90" can see.
    var circ = '';
    if (isFinite(p) && isFinite(s) && s > 0 && p / s >= 0.9) {
      circ = 'the pulse (' + p + ') has caught up with the systolic (' + s + ')';
    } else if (isFinite(s) && s > 0 && s < 100) {
      circ = 'the systolic is ' + s;
    } else if (isFinite(p) && p >= 120) {
      circ = 'the pulse is ' + p;
    } else if (isFinite(d) && isFinite(s) && s > 0 && d > 0 && s - d <= 25) {
      circ = 'the pulse pressure is narrow (' + s + '/' + d + ')';
    }
    if (circ) why.push(circ);
    // Hypothermia in a belly is late sepsis. It must read as MORE dangerous
    // than a fever, never as the absence of infection.
    if (isFinite(t) && t > 25 && t < 36) why.push('temperature ' + t);
    if (RED_SAID.test(neg.raw) || RED_FOUND.test(neg.said)) why.push('what was written');
    return why;
  }

  // ── The index ───────────────────────────────────────────────────────────
  // 713 short documents: 241 rows from the WHO differential tables and 472
  // Uganda Clinical Guidelines conditions, each reduced to title, clinical
  // features and investigations.
  //
  // They are scored here in JavaScript rather than by SQLite, because the
  // SQLite build this app ships (sql.js) has no FTS5 module — every MATCH
  // query against it throws "no such module: fts5" and falls back silently to
  // a LIKE scan. At this size, scoring in JS is both honest and fast: the
  // index is built once in well under a second and a query takes milliseconds.
  var K1 = 1.2, B = 0.6;
  var FIELD_W = {
    diff:     [4.0, 1.0, 10.0],   // diagnosis · presenting symptom · in favour
    ucg_feat: [5.0, 14.0, 1.0],   // title · clinical features · investigations
    ucg_raw:  [5.0, 4.0, 1.0],    // same, but the features never parsed
  };
  var IX = null;

  function buildIndex(db) {
    var docs = [], df = {}, total = 0;
    var st = db.prepare('SELECT id,kind,title,title_normalized,page,src,cond_id,' +
                        'has_features,sex,age,f1,f2,f3 FROM docs');
    while (st.step()) {
      var r = st.getAsObject();
      var key = r.kind === 'diff' ? 'diff' : (r.has_features ? 'ucg_feat' : 'ucg_raw');
      var w = FIELD_W[key], tf = {}, dl = 0;
      [r.f1, r.f2, r.f3].forEach(function (field, i) {
        var list = toks(field, false);
        for (var j = 0; j < list.length; j++) {
          tf[list[j]] = (tf[list[j]] || 0) + w[i];
          dl += w[i];
        }
      });
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      total += dl;
      docs.push({ kind: r.kind, title: r.title, norm: r.title_normalized,
                  page: r.page, src: r.src, cid: r.cond_id, has: r.has_features,
                  sex: r.sex || null, age: r.age || null,
                  tf: tf, dl: dl,
                  text: ((r.f1 || '') + ' ' + (r.f2 || '') + ' ' + (r.f3 || '')).toLowerCase() });
    }
    st.free();
    var tests = {};
    var st2 = db.prepare('SELECT diagnosis_normalized k, tests, book, page, named FROM dx_tests ORDER BY named DESC');
    while (st2.step()) { var x = st2.getAsObject(); if (!tests[x.k]) tests[x.k] = x; }
    st2.free();
    return { docs: docs, df: df, N: docs.length,
             avgdl: docs.length ? total / docs.length : 1, tests: tests };
  }

  function openIdx() {
    if (idx) return Promise.resolve(idx);
    if (idxLoading) return idxLoading;
    idxLoading = (async function () {
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(IDX_URL);
      if (!res.ok) throw new Error('impression index not found (' + res.status + ')');
      idx = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      IX = buildIndex(idx);
      return idx;
    })();
    return idxLoading;
  }
  async function ready() {
    try { await openIdx(); } catch (e) { IX = null; }
    return !!IX;
  }

  // What this clinic has actually diagnosed before. The one-tap package already
  // records every condition it builds a standard for, so this is the clinic's
  // own history, not a guess about Ugandan epidemiology — which is not
  // something these two books could tell us, and not something worth inventing.
  function localHistory() {
    var out = {};
    try {
      var cid = JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId || 'local';
      var all = JSON.parse(localStorage.getItem('ucg_packages_' + cid) || '{}');
      Object.keys(all).forEach(function (k) {
        var p = all[k];
        if (!p || !p.title) return;
        var n = normTitle(p.title);
        out[n] = (out[n] || 0) + (Number(p.uses) || 1);
      });
    } catch (e) {}
    return out;
  }

  // Paediatric (<5), Child (5-12), Adult (>12). Months are accepted because a
  // Ugandan mother gives a baby's age in months, not in fractions of a year.
  function ageBand(age, unit) {
    var a = parseFloat(age);
    if (!isFinite(a) || a < 0) return '';
    var years = /month/i.test(String(unit || '')) ? a / 12 : a;
    if (years < 5) return 'paediatric';
    if (years <= 12) return 'child';
    return 'adult';
  }

  function idfOf(t) {
    var df = IX.df[t] || 0;
    return Math.log(1 + (IX.N - df + 0.5) / (df + 0.5));
  }
  function rxTerm(t) { return new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }

  // ── The suggestion itself ───────────────────────────────────────────────
  function suggest(input, limit) {
    limit = limit || 3;
    if (!IX) return { ready: false, items: [], flags: vitalFlags(input.vitals),
                      rules: [], moved: [], hidden: [], dropped: [], denied: [] };

    var terms = [];
    function push(list) {
      for (var i = 0; i < list.length; i++) if (terms.indexOf(list[i]) < 0) terms.push(list[i]);
    }
    // ── Which words get to do the searching ──────────────────────────────
    //
    // Only 22 terms are searched: BM25 over 713 documents with an unbounded
    // bag of words is both slower and noisier, because every extra common
    // word dilutes the ones that discriminate.
    //
    // The complaint and the vitals go in whole — between them that is rarely
    // more than eight words, and they are the two things the clinician is
    // most sure of. What is LEFT used to go to the story until it ran out,
    // and only then to the background. On a wordy dictation that meant the
    // background never reached the scorer at all: measured on four realistic
    // consultations, "known peptic ulcer disease" — the single fact that most
    // changes what abdominal pain might be — was cut off entirely.
    //
    // So the remainder is shared. The background is usually the shorter of
    // the two, so it is offered a third of what is left; whatever either does
    // not use goes to the other, and nothing is wasted.
    var MAX_TERMS = 22;

    // Everything the clinician said was absent, worked out once over the whole
    // record rather than field by field — "abdominal pain" in the complaint
    // has to be able to protect the word "pain" from "no pain on passing
    // urine" three lines down in the story.
    var neg = denials([input.chief, input.subjective, input.background].join('. '));
    function heard(list) {
      return list.filter(function (t) { return neg.drop.indexOf(t) < 0; });
    }

    push(heard(toks(input.chief)));
    push(vitalTerms(input.vitals));      // measured, never denied

    var story = heard(toks(input.subjective)).filter(function (t) { return terms.indexOf(t) < 0; });
    var back = heard(toks(input.background)).filter(function (t) { return terms.indexOf(t) < 0; });
    var room = Math.max(0, MAX_TERMS - terms.length);
    var backRoom = Math.min(back.length, Math.ceil(room / 3));
    push(story.slice(0, room - backRoom));
    push(back.slice(0, backRoom));
    if (terms.length < MAX_TERMS) push(back.slice(backRoom));    // story left room
    if (terms.length < MAX_TERMS) push(story.slice(room - backRoom));
    terms = terms.slice(0, MAX_TERMS);
    if (!terms.length) return { ready: true, items: [], flags: vitalFlags(input.vitals),
                                rules: [], moved: [], hidden: [],
                                dropped: neg.drop, denied: neg.spans };

    var idf = {}, totIdf = 0;
    terms.forEach(function (t) { idf[t] = idfOf(t); totIdf += idf[t]; });
    totIdf = totIdf || 1;

    // ── Who the patient is, before anything is scored ────────────────────
    //
    // Offering Ectopic Pregnancy for a man, or Benign Prostatic Hyperplasia
    // for a woman, destroys a clinician's trust in the whole list. 83 of the
    // conditions can only happen to one sex.
    //
    // When the sex has NOT been recorded, every one of those is held back and
    // the screen says how many and why — a blank field must not quietly widen
    // the differential.
    var sex = String(input.sex || '').toLowerCase().charAt(0);   // 'm' | 'f' | ''
    var band = ageBand(input.age, input.ageUnit);
    var blocked = 0;

    // BM25 over every document. 713 of them — a few milliseconds.
    var bykind = { diff: [], ucg: [] };
    for (var i = 0; i < IX.docs.length; i++) {
      var d = IX.docs[i], s = 0;
      if (d.sex && (!sex || d.sex !== sex)) { blocked++; continue; }
      for (var j = 0; j < terms.length; j++) {
        var f = d.tf[terms[j]];
        if (!f) continue;
        s += idf[terms[j]] * (f * (K1 + 1)) /
             (f + K1 * (1 - B + B * d.dl / IX.avgdl));
      }
      if (s > 0) bykind[d.kind === 'diff' ? 'diff' : 'ucg'].push({ d: d, s: s });
    }

    var cand = {};
    ['diff', 'ucg'].forEach(function (kind) {
      var lst = bykind[kind];
      if (!lst.length) return;
      var mx = 0;
      lst.forEach(function (x) { if (x.s > mx) mx = x.s; });
      mx = mx || 1;
      lst.forEach(function (x) {
        var d = x.d;
        var mult = d.kind === 'diff' ? 1.00 : (d.has ? 0.95 : 0.55);
        var sc = (x.s / mx) * mult;
        var e = cand[d.norm];
        if (!e) e = cand[d.norm] = { title: d.title, norm: d.norm, score: 0,
                                     srcs: [], text: '', cid: d.cid };
        if (sc > e.score) {
          e.score = sc; e.text = d.text; e.cid = d.cid;
          if (d.title.length < e.title.length) e.title = d.title;
        }
        var tag = d.src + (d.page ? ' p.' + d.page : '');
        if (e.srcs.indexOf(tag) < 0) e.srcs.push(tag);
      });
    });

    var out = [];
    var hist = localHistory();
    Object.keys(cand).forEach(function (k) { out.push(cand[k]); });
    out.forEach(function (o) {
      o.matched = terms.filter(function (t) { return rxTerm(t).test(o.text); });
      var got = 0;
      o.matched.forEach(function (t) { got += idf[t]; });
      // Show the findings that actually discriminate, strongest first. Listing
      // "last" and "treat" beside "stiff neck" makes the evidence look like a
      // word count instead of a reason.
      o.matched.sort(function (a, b) { return idf[b] - idf[a]; });
      o.cover = got / totIdf;
      o.rank = 0.62 * o.score + 0.38 * o.cover;
      o.seen = hist[o.norm] || 0;
      // A nudge, never a verdict: a condition this clinic sees often moves up
      // a little, but cannot overtake a much better match.
      if (o.seen) o.rank += Math.min(0.06, 0.02 * Math.log(1 + o.seen));
    });
    // ── The two rules ────────────────────────────────────────────────────
    // Applied to the ranks BEFORE the list is cut to three, so a demoted
    // condition actually leaves the list and something better takes the place,
    // rather than sitting in it with a small number beside it.
    var flags = vitalFlags(input.vitals);
    var rules = [], moved = [], hidden = [];

    // A percentage here is relative to the best match in the list, so the top
    // suggestion always carries a big-looking number even when there was
    // almost nothing to match on. That was survivable while a denial padded
    // the query with words; now that denials are removed, a careful negative
    // examination can leave two words standing — and two generic words return
    // a confident-looking list of nonsense. Say so.
    if (terms.length < 4) {
      flags.push({ k: 'warn', rule: 'thin',
        t: 'Only ' + terms.length + ' word' + (terms.length === 1 ? '' : 's') +
           ' to go on: ' + terms.join(', '),
        w: 'The percentages below are worked out against each other, not ' +
           'against the disease, so the top one always looks high. With this ' +
           'little written down it is close to a guess — add what else you ' +
           'found, or what they told you, before you use this list.' });
      rules.push('thin');
    }
    var DEMOTED = 0.09;      // ranks map to pct as round(100 * rank), so < 10%

    // RULE 1 — the rigidity guard.
    // Fires only when rigidity or guarding is written as absent AND neither
    // they nor rebound are affirmed anywhere else in the record. "Rigidity
    // present, no guarding" is a contradiction, not a soft belly.
    var saidSoft = deniedStem(neg, 'rigidity') || deniedStem(neg, 'rigid') ||
                   deniedStem(neg, 'guard');
    var stillFirm = /\b(?:rigid|guard|rebound)/.test(neg.said);
    if (saidSoft && !stillFirm) {
      var red = surgicalRedFlags(input, neg, band);
      if (red.length) {
        // The guard is suspended, and that is worth more words than the
        // demotion would have been.
        flags.push({ k: 'danger', rule: 'rigidity-held',
          t: 'A soft belly is not a safe belly here',
          w: 'You wrote that there is no rigidity or guarding — but ' +
             red.join(', ') + '. Peritonitis and appendicitis have been LEFT ' +
             'in the list on purpose. A late or exhausted abdomen goes soft, ' +
             'and that is when it is most dangerous.' });
        rules.push('rigidity-held');
      } else {
        out.forEach(function (o) {
          if (!inList(ACUTE_ABDOMEN, o.norm)) return;
          var was = o.rank;
          o.rank = Math.min(was, DEMOTED) * (0.9 + 0.1 * Math.min(1, was));
          o.demoted = true;
          moved.push(o.title);
        });
        if (moved.length) {
          // Quote the denials that actually caused this, not the first three
          // in the record — "no fever, no vomiting, no rigidity" must not tell
          // the clinician that the fever is why appendicitis moved.
          var why = neg.spans.filter(function (sp) { return /rigid|guard|rebound/.test(sp); });
          if (!why.length) why = neg.spans.slice(0, 2);
          flags.push({ k: 'warn', rule: 'rigidity',
            t: moved.join(', ') + ' moved to the bottom',
            w: 'Because you wrote "' + why.slice(0, 3).join('", "') +
               '". A soft belly does not rule a surgical abdomen out — in late ' +
               'disease, in advanced HIV and in the elderly the guarding is gone ' +
               'while the peritonitis is not. If you did not actually press on ' +
               'the belly and let go, delete those words. If it is distended or ' +
               'silent, or nothing is passing, refer now whatever this list says.' });
          rules.push('rigidity');
        }
      }
    }

    // RULE 2 — reproductive priority.
    if (sex === 'f' && lowerPain(neg.said) &&
        (vaginalDischarge(neg.said) || dysuria(neg.said))) {
      out.forEach(function (o) {
        if (inList(GYNAE_URO, o.norm)) { o.rank *= 1.30; o.grouped = true; }
      });
      if (!bowelInPlay(neg.said)) {
        out = out.filter(function (o) {
          if (!inList(GI_PARASITE, o.norm)) return true;
          hidden.push(o.title);
          return false;
        });
      }
      rules.push('pelvic');
      flags.push({ k: 'warn', rule: 'pelvic',
        t: 'Grouped toward the gynaecological and urinary causes' +
           (hidden.length ? ' — ' + hidden.join(', ') + ' left out' : ''),
        w: 'Lower abdominal pain in a woman with discharge or pain on passing ' +
           'urine. This is an assumption, not a finding' +
           (hidden.length ? ', and it is why the bowel parasites are not shown — ' +
             'say so if there is diarrhoea, dysentery, weight loss or a mass and ' +
             'they come back' : '') + '. Before you act on it: has she missed a ' +
           'period? Is the pain worse on the right? Is the temperature over 38? ' +
           'Those are ectopic, appendicitis and malaria, and a discharge is ' +
           'common enough in a well woman to be beside the point.' });
    }

    out.sort(function (a, b) { return b.rank - a.rank; });
    out = out.slice(0, limit);
    out.forEach(function (o) {
      // One number, and it is the one the list is ordered by — a nurse must
      // never see 52% sitting above 79%.
      o.pct = Math.max(5, Math.min(95, Math.round(100 * o.rank)));
      o.tests = testsFor(o);
    });
    return { ready: true, items: out, flags: flags, terms: terms,
             sexBlocked: sex ? 0 : blocked, band: band,
             // What the rules did, so a test — and the screen — can see it
             // rather than infer it from an ordering.
             rules: rules, moved: moved, hidden: hidden,
             dropped: neg.drop, denied: neg.spans };
  }

  // ── What would confirm it ───────────────────────────────────────────────
  // Two different things, kept apart on purpose:
  //   tests — NAMED tests this clinic can order, print and charge for. These
  //           are the only things ever added to the lab order.
  //   note  — what the guideline says about investigating it, in its own
  //           words. Readable, but not orderable: "Diagnosis is mainly by
  //           clinical features" is a sentence, not a test, and billing a
  //           patient for it would be indefensible.
  function testsFor(item) {
    var row = IX.tests[item.norm];
    if (!row) { item.note = ''; return []; }
    var lines = String(row.tests || '').split('\n').filter(Boolean);
    if (row.named) {                       // already the clinic's own test names
      item.note = '';
      return lines.slice(0, 5);
    }
    item.note = lines[0] || '';            // the guideline's words — to read, not to order
    return [];
  }

  window.Impression = {
    ready: ready,
    suggest: suggest,
    vitalFlags: vitalFlags,
    ageBand: ageBand,
    _toks: toks,          // exposed so the tests can check parity with the tuning
    _denials: denials,    // and so the negation scoper can be tested on its own
    _size: function () { return IX ? IX.N : 0; },
  };
})();
