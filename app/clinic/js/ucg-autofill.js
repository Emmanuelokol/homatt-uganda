/* Homatt Health — One-tap standard package (UCG 2023 auto-fill)
 *
 * The clinician confirms a diagnosis and taps ONE button. This opens a
 * worksheet pre-filled from the Uganda Clinical Guidelines 2023: the
 * investigations to run, the medicines with dose/frequency/duration/quantity,
 * the follow-up interval, and the charges. Everything is editable, every row
 * has an [×], and a [+] adds another test, drug or condition.
 *
 * It LEARNS: when the clinician changes a package, the app asks before saving
 * it as the clinic's standard for that condition+severity. Next time the same
 * case comes up it auto-fills the learned version — including the money.
 *
 * Fully offline: the guideline database and SQLite engine are bundled, and the
 * learned packages live in local storage (mirrored to the sync outbox so they
 * follow the clinic to other devices).
 */
(function () {
  'use strict';

  var DB_URL = 'data/uganda_clinical_guidelines_2023.db';
  var EM_URL = 'data/emhslu_2023.db';       // national essential medicines list
  var db = null, loading = null;
  var emdb = null, emLoading = null;
  var state = null;              // the wizard's state object
  var pkg = null;                // the package being edited
  var srcPkg = null;             // what was auto-filled (to detect edits)
  var ctx = { conditionId: null, title: '', severity: '', page: null, learned: false };
  // What the clinician actually typed for THIS condition. Kept apart from ctx,
  // which is rebuilt every time a package opens, so the words that go into the
  // record are the clinician's own ("Malaria"), not the book's chapter heading
  // ("Uncomplicated Malaria").
  var dxTerm = '';

  var LEVELS = ['HC1', 'HC2', 'HC3', 'HC4', 'H', 'RR', 'NR'];

  // How the visit was settled. Mirrors the chips on the wizard's second screen
  // so the money can be closed off without leaving the package.
  var PAY_OPTS = [
    { k: 'paid',    label: 'Paid',    icon: '\u2713', hint: 'Money received in full — goes into Money In today.' },
    { k: 'pending', label: 'Pending', icon: '\u23F3', hint: 'Not paid yet — shows under Pending Payments.' },
    { k: 'credit',  label: 'Credit',  icon: '\uD83D\uDCCB', hint: 'On credit — shows under Pending Payments until paid.' },
    { k: 'waived',  label: 'Waived',  icon: '\uD83E\uDD1D', hint: 'No charge — nothing owed, nothing collected.' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }

  // ── Database (lazy: only opened when the clinician asks for a package) ────
  function openDb() {
    if (db) return Promise.resolve(db);
    if (loading) return loading;
    loading = (async function () {
      if (typeof initSqlJs !== 'function') throw new Error('SQLite engine not loaded');
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(DB_URL);
      if (!res.ok) throw new Error('guideline database not found');
      db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      return db;
    })();
    return loading;
  }
  // The Essential Medicines & Health Supplies List for Uganda (EMHSLU 2023) is
  // the national formulary: official name, form, strength, the LEVEL of facility
  // allowed to stock it, and its VEN class (Vital/Essential/Necessary).
  function openEm() {
    if (emdb) return Promise.resolve(emdb);
    if (emLoading) return emLoading;
    emLoading = (async function () {
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(EM_URL);
      if (!res.ok) throw new Error('EMHSLU database not found');
      emdb = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      return emdb;
    })();
    return emLoading;
  }
  function emRows(sql, params) {
    if (!emdb) return [];
    var st = emdb.prepare(sql), out = [];
    try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); }
    finally { st.free(); }
    return out;
  }
  // What level is this clinic? Used to flag drugs above the facility's level.
  function myLevel() {
    try {
      var s = JSON.parse(localStorage.getItem('clinic_session') || '{}');
      return (s.level || s.facilityLevel || '').toUpperCase() || null;
    } catch (e) { return null; }
  }

  function rows(sql, params) {
    if (!db) return [];
    var st = db.prepare(sql), out = [];
    try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); }
    finally { st.free(); }
    return out;
  }

  // ── Learned packages (offline-first) ─────────────────────────────────────
  function clinicId() {
    try { return (JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId) || 'local'; }
    catch (e) { return 'local'; }
  }
  function storeKey() { return 'ucg_packages_' + clinicId(); }
  function allLearned() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || '{}'); } catch (e) { return {}; }
  }
  function learnKey(condId, sev) {
    // Free-text conditions (not in the guidelines) are keyed by their name so
    // the clinic's own package is found again next time.
    var base = condId ? String(condId) : 'free:' + String(ctx.title || '').toLowerCase().trim();
    return base + '|' + (sev || 'any');
  }
  function getLearned(condId, sev) {
    var all = allLearned();
    return all[learnKey(condId, sev)] || all[learnKey(condId, 'any')] || null;
  }
  function saveLearned(condId, sev, p) {
    var all = allLearned();
    var k = learnKey(condId, sev);
    var prev = all[k];
    all[k] = {
      title: ctx.title, severity: sev || 'any',
      tests: p.tests.slice(),
      // The standard is what this clinic actually gives — so save the ticked
      // medicines, not the whole menu of alternatives the guideline offers.
      drugs: JSON.parse(JSON.stringify(p.drugs.filter(function (d) {
        return d.selected && (d.group || 'treatment') !== 'other';
      }))),
      fees: { consult: p.fees.consult, lab: p.fees.lab, meds: p.fees.meds },
      followUpDays: p.followUpDays,
      uses: (prev && prev.uses || 0) + 1,
      updated: new Date().toISOString(),
    };
    try { localStorage.setItem(storeKey(), JSON.stringify(all)); } catch (e) {}
    // Mirror to the clinic's other devices when a sync path exists.
    try {
      var CO = window.ClinicOffline;
      if (CO && CO.enqueue) {
        CO.enqueue('table_upsert', {
          table: 'clinic_care_packages',
          rows: [{
            clinic_id: clinicId(), condition_id: String(condId), severity: sev || 'any',
            title: ctx.title, package: all[k],
          }],
          onConflict: 'clinic_id,condition_id,severity',
        });
      }
    } catch (e) {}
  }

  // ── Build a package from the guideline ───────────────────────────────────
  // ── Lab tests, as opposed to the investigations text ──────────────────────
  // These are two different things and were being confused. "Investigations" is
  // what the guideline SAYS — prose, several sentences, worth reading. A lab
  // test is a NAMED thing you order, print on a form and charge for.
  //
  // The old code took any line of the prose that happened to contain a word
  // like "blood" and offered it as a test, which is how chips reading "A blood
  // slide for microscopy is specifically recommended over" ended up on screen —
  // half a sentence, ordered as a test. Now the prose is searched for the tests
  // the clinic actually runs, and the test's own proper name is what appears.
  // The prose itself is kept, in the guideline notes, where it belongs.
  var LAB_MAP = [
    [/\bm?RDT\b|rapid diagnostic test/i,                                   'Malaria RDT'],
    [/malaria pcr/i,                                                       'Malaria PCR'],
    [/thin (blood )?(film|smear)|speciation/i,                             'Thin Blood Smear'],
    [/blood slide|thick (blood )?(film|smear)|blood smear|blood film|malaria microscopy/i, 'Thick Blood Smear'],
    [/\b(CBC|FBC)\b|complete blood count|full blood count|haemogram|blood count|white cell count|platelet count/i, 'Full Blood Count (FBC)'],
    [/\bESR\b|erythrocyte sedimentation/i,                                 'ESR'],
    [/\bCRP\b|c-?reactive protein/i,                                       'CRP'],
    [/blood group|grouping and cross|cross-?match|rhesus/i,                'Blood Group & Rhesus'],
    [/hba1c|glycated h/i,                                                  'HbA1c'],
    [/fasting blood (sugar|glucose)|\bFBS\b/i,                             'Fasting Blood Sugar'],
    [/random blood (sugar|glucose)|\bRBS\b/i,                              'Blood Sugar (Random)'],
    [/blood (sugar|glucose)|hypoglyca?emia|glucometer/i,                   'Blood Glucose (POC)'],
    [/liver function|\bLFTs?\b|transaminase|\bALT\b|\bAST\b|bilirubin/i,   'Liver Function Tests (LFTs)'],
    [/renal function|kidney function|\bRFTs?\b|creatinine|\burea\b/i,      'Kidney Function (Creatinine)'],
    [/electrolytes?|serum sodium|serum potassium/i,                        'Serum Electrolytes'],
    [/blood culture/i,                                                     'Blood Culture & Sensitivity'],
    [/urine culture/i,                                                     'Urine Culture & Sensitivity'],
    [/urine microscopy/i,                                                  'Urine Microscopy'],
    [/urinalysis|urine dipstick|dipstick|urine for/i,                      'Urinalysis (Dipstick)'],
    [/stool culture/i,                                                     'Stool Culture & Sensitivity'],
    [/h\.? ?pylori/i,                                                      'H. Pylori (Stool Antigen)'],
    [/stool (microscopy|examination|analysis)|ova and parasites|stool for/i, 'Stool Microscopy (Ova & Parasites)'],
    [/\bCD4\b/i,                                                           'CD4 Count'],
    [/\bHIV\b[^.]{0,30}(test|serology|screen|status)|test(ing)? for HIV/i, 'HIV Rapid Test'],
    [/hepatitis b|hbsag/i,                                                 'Hepatitis B (HBsAg)'],
    [/hepatitis c|\bHCV\b/i,                                               'Hepatitis C (HCV)'],
    [/\bVDRL\b|\bRPR\b|syphilis|treponem/i,                                'Syphilis (VDRL/RPR)'],
    [/widal/i,                                                             'Widal (Typhoid)'],
    [/brucella/i,                                                          'Brucella Agglutination'],
    [/gene ?xpert|\bXpert\b|MTB\/RIF/i,                                    'TB GeneXpert'],
    [/sputum[^.]{0,30}(AFB|smear|microscopy|ZN)|acid.?fast|ziehl/i,        'TB Sputum AFB Smear'],
    [/chest x-?ray|\bCXR\b/i,                                              'Chest X-Ray'],
    [/x-?ray|radiograph/i,                                                 'X-Ray'],
    [/ultra-? ?sound|\bUSS\b/i,                                            'Ultrasound'],
    [/\bECG\b|electrocardio/i,                                             'ECG'],
    [/pregnancy test|\bhCG\b|\bUPT\b/i,                                    'Pregnancy Test (uHCG)'],
    [/pulse ?oxim|\bSpO2\b|oxygen saturation/i,                            'Pulse Oximetry (SpO2)'],
    [/lumbar puncture|\bCSF\b|cerebrospinal/i,                             'Lumbar Puncture (CSF)'],
    [/sickling|sickle cell (test|screen)|haemoglobin electrophoresis/i,    'Sickling Test'],
    [/ha?emoglobin (level|estimation|concentration)|\bHb\b/i,              'Haemoglobin (Hb)'],
    [/gram stain/i,                                                        'Gram Stain & Microscopy'],
    [/high vaginal swab|\bHVS\b|wet (prep|mount|preparation)/i,            'Wet Prep / HVS'],
    [/blood pressure|\bBP\b/i,                                             'BP Measurement'],
  ];

  function extractTests(investigations, fullText) {
    var src = investigations || '';
    if (!src && fullText) {
      var m = /investigations?\s*[:\n]([\s\S]{0,700})/i.exec(fullText);
      src = m ? m[1] : '';
    }
    if (!src.trim()) return [];
    // Where in the text each test is first named, so they come out in the
    // order the guideline mentions them rather than the order of this table.
    var found = [];
    LAB_MAP.forEach(function (pair) {
      var hit = pair[0].exec(src);
      if (!hit) return;
      if (found.some(function (f) { return f.name === pair[1]; })) return;
      found.push({ name: pair[1], at: hit.index });
    });
    found.sort(function (a, b) { return a.at - b.at; });
    return found.map(function (f) { return f.name; }).slice(0, 10);
  }

  // ── Which of the guideline's lines are really medicines ───────────────────
  // The medicines were lifted out of the same PDF as everything else, so beside
  // the real drugs the list carries pieces of the sentences they were printed
  // in — "Re-assure patient", "Increase if necessary to", "Alternatives". Those
  // are not medicines and must not be offered as ones. Everything that IS a
  // medicine has to be shown, though: severe malaria carries thirteen, and only
  // the first six were ever reaching the screen.

  // A line that opens with an instruction is a sentence, not a drug.
  var MED_VERB = /^(give|apply|treat|increase|decrease|reduce|start|continue|stop|repeat|re-?assure|prevent|relieve|followed?|transfuse|de-?worm|assess|monitor|refer|admit|add|use|take|check|avoid|consider|maintain|slowly|manage|correct|control|administer|ensure|advise|encourage|observe|review|do|if|for|in|with|and|or|the|a|an|about|when|where|after|before|then|also|may|can|should|switch|change|one|two|three)\b/i;
  // Bare labels off the page that are never the name of a medicine.
  var MED_NOISE = /^(alternatives?|maintenance dose|toxic dose|doses?|about|elderly|initially|combination|adults?|children|infants?|neonates?|daily fluid requirements?|basic total fluid|oliguria|anuria|fibrosis|varices present|notes?|cautions?|others?|regimens?|(first|second|third) line( medicine| alternative)?|dosage|treatment|management|prevention|prophylaxis|indications?|contraindications?|(one |a )?single dose( of)?|one single dose of|oral|iv|im|sc|po|topical|inhaled|inhalation|rectal|nasal|infusion|drip|route)$/i;

  // Fluids and rehydration — the drips. They were being dropped along with
  // everything else past the sixth medicine.
  var MED_FLUID = /(dextrose|glucose\s*\d|sodium chloride|normal saline|\bsaline\b|ringer|hartmann|darrow|water for injection|oral rehydration|\bORS\b|resomal|sodium bicarbonate|packed cells|packed red|whole blood|blood transfusion|fresh frozen|plasma|platelet|cryoprecipitat|albumin|haemaccel|gelofus|dextran)/i;

  function isMedicineName(name) {
    var n = String(name || '').trim();
    if (n.length < 3 || n.length > 60) return false;
    if (MED_NOISE.test(n)) return false;
    if (MED_VERB.test(n)) return false;
    // A drug name is short. Anything running on is a sentence that lost its verb.
    var words = n.split(/\s+/);
    if (words.length > 4) return false;
    // …and it has to contain a real word, not just numbers and symbols.
    return /[A-Za-z]{4}/.test(n);
  }

  // The guideline usually prints supportive treatment as "<what for> Give <drug>"
  // — "Convulsions Give diazepam 0.2 mg/kg". That prefix is the single most
  // useful thing on the row, so pull it out and show it.
  function medReason(sourceLine) {
    var s = String(sourceLine || '').trim();
    var m = /^(?:If\s+)?([A-Z][^.:]{2,44}?)\s*[:]\s*Give\b/.exec(s) ||
            /^(?:If\s+)?([A-Z][A-Za-z\s\-/]{2,44}?)\s+Give\b/.exec(s) ||
            /^If\s+([^.:]{3,44})[:.]/.exec(s);
    if (!m) return '';
    var r = m[1].trim().replace(/\s+/g, ' ');
    if (!r || MED_VERB.test(r)) return '';
    return r.charAt(0).toUpperCase() + r.slice(1);
  }

  // ── First line, alternative, second line ──────────────────────────────────
  // The guideline never just lists medicines — it ranks them. "First line
  // medicine … First line alternative … Second line medicine … Pre-referral
  // treatment". Flattened into a list that ranking disappears, and a clinician
  // is left choosing between six drugs with nothing to say which the book
  // actually wants first. These read the ranking back out of the text.
  var RANK_MARKS = [
    [/first[- ]?line\s+alternatives?/gi, 'alt'],
    [/second[- ]?line/gi,                'second'],
    [/third[- ]?line/gi,                 'third'],
    [/pre-?referral/gi,                  'prereferral'],
    [/if not available|if unavailable|where not available/gi, 'alt'],
    [/\balternatives?\b/gi,              'alt'],
    [/first[- ]?line/gi,                 'first'],
  ];
  var RANK_INFO = {
    first:       { label: 'FIRST LINE',   order: 1 },
    alt:         { label: 'ALTERNATIVE',  order: 2 },
    second:      { label: 'SECOND LINE',  order: 3 },
    third:       { label: 'THIRD LINE',   order: 4 },
    prereferral: { label: 'PRE-REFERRAL', order: 5 },
  };

  // Every ranking word in the text, with where it sits. Overlapping matches
  // keep the longer one, so "first line alternative" is not read as "first
  // line" followed by nothing.
  // "Alternative in pregnancy" says more than "alternative", so the badge keeps
  // the book's own words where they add something.
  function markLabel(raw, tail) {
    var base = String(raw).replace(/\s+/g, ' ').trim()
      .replace(/\b(medicines?|treatments?|regimens?|drugs?|therapy)\b/gi, '')
      .replace(/\s+/g, ' ').trim();
    var q = /^[\s:—-]*((?:in|for)\s+[A-Za-z][A-Za-z\s>\d-]{2,20}?)(?:\s*$|[,.:;\n])/.exec(tail || '');
    return (base + (q ? ' ' + q[1].trim() : '')).toUpperCase().slice(0, 28);
  }

  function rankMarkers(text) {
    var t = String(text || ''), marks = [];
    RANK_MARKS.forEach(function (pair) {
      var re = new RegExp(pair[0].source, 'gi'), m;
      while ((m = re.exec(t))) {
        var end = m.index + m[0].length;
        marks.push({ at: m.index, end: end, key: pair[1], len: m[0].length,
                     label: markLabel(m[0], t.slice(end, end + 34)) });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    marks.sort(function (a, b) { return a.at - b.at || b.len - a.len; });
    var out = [];
    marks.forEach(function (m) {
      var prev = out[out.length - 1];
      if (prev && m.at < prev.end) return;      // swallowed by a longer marker
      out.push(m);
    });
    return out;
  }

  // The rank of a drug is the ranking word most recently printed before it.
  // A drug named more than once — artesunate is the alternative for
  // uncomplicated malaria and first line for severe — keeps its best rank.
  // How far after a ranking word a drug can still belong to it. The book prints
  // the heading and the medicine within a line or two of each other; anything
  // further away is a different part of the page and gets no rank at all,
  // rather than inheriting one that was never meant for it.
  var RANK_REACH = 120;
  // …and it must be within a line or two on the page. Distance in characters
  // alone was not enough: for typhoid the heading "Alternative in pregnancy"
  // sits above amoxicillin, and four lines further down comes doxycycline —
  // which must NEVER be labelled an alternative in pregnancy, because it is
  // contraindicated in pregnancy. Counting the line breaks stops that.
  var RANK_LINES = 2;

  function rankOf(drugName, text, marks) {
    var key = stockKey(drugName).split(' ')[0];
    if (!key || key.length < 4) return '';
    var re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var t = String(text || ''), m, best = null;
    while ((m = re.exec(t))) {
      var here = null;
      for (var i = 0; i < marks.length; i++) {
        if (marks[i].at < m.index) here = marks[i]; else break;
      }
      if (!here || (m.index - here.end) > RANK_REACH) continue;
      var gap = t.slice(here.end, m.index);
      if ((gap.match(/\n/g) || []).length > RANK_LINES) continue;
      if (!best || RANK_INFO[here.key].order < RANK_INFO[best.key].order) best = here;
    }
    return best || null;
  }

  function medGroup(name, sourceLine, reason) {
    if (MED_FLUID.test(name)) return 'fluid';
    if (reason) return 'supportive';
    return 'treatment';
  }

  // ── Medicines the extractor missed altogether ─────────────────────────────
  // Severe malaria names Dihydroartemisinin/Piperaquine as the second line
  // medicine and Sulfadoxine/Pyrimethamine for prevention in pregnancy, and
  // NEITHER was pulled into the medicines table — they are only in the prose.
  // So the prose is read again, against the national medicines list that ships
  // with the app (EMHSLU 2023), and any real drug named there but missing from
  // the list is put back.
  //
  // Spelling differs between the two books (Sulfadoxine / Sulphadoxine) and the
  // PDF drops letters (Dihydroartemisin), so names are compared with ph→f and
  // by prefix.
  function drugKey(s) {
    return String(s || '').toLowerCase()
      .replace(/ph/g, 'f').replace(/ae|oe/g, 'e').replace(/[^a-z]/g, '');
  }

  var emLexicon = null;
  function emDrugWords() {
    if (emLexicon) return emLexicon;
    var byKey = {};
    try {
      emRows("SELECT name, strength FROM emhslu_items WHERE item_type='medicine'", []).forEach(function (r) {
        var full = String(r.name || '').replace(/\s+/g, ' ').trim();
        if (!full) return;
        var strength = String(r.strength || '').replace(/\s+/g, ' ').trim();
        // A combination keeps its whole name — "Dihydroartemisinin + piperaquine"
        // is one medicine, not two — but either half may be what the guideline
        // wrote, so both are searchable keys pointing at the same medicine.
        full.split(/[+/,()]/).forEach(function (part) {
          var w = part.trim();
          if (w.length < 7 || w.split(/\s+/).length > 2) return;
          var k = drugKey(w);
          // When the guideline writes "adrenaline", the medicine meant is
          // Adrenaline — not "Lignocaine + adrenaline". Shortest name wins.
          if (!byKey[k] || full.length < byKey[k].name.length) byKey[k] = { name: full, strength: strength };
        });
      });
    } catch (e) { byKey = {}; }
    emLexicon = Object.keys(byKey).map(function (k) {
      var name = byKey[k].name, strength = byKey[k].strength;
      // "Lignocaine + epinephrine" is a combination; "Glucose (Dextrose)" is one
      // medicine under two names. Only the first needs both halves named.
      var parts = /[+/]/.test(name)
        ? name.split(/[+/]/).map(function (x) { return drugKey(x.replace(/\(.*?\)/g, '')); })
              .filter(function (x) { return x.length >= 7; })
        : [];
      return { key: k, name: name, strength: strength, parts: parts };
    });
    emLexicon.sort(function (a, b) { return b.key.length - a.key.length; });
    // Never remember an EMPTY list. This is built the first time a medicine
    // name has to be recognised, which can happen a moment before the national
    // medicines list has finished loading — and remembering the empty answer
    // would have switched off drug recovery for the rest of the session.
    if (!emLexicon.length) { var empty = emLexicon; emLexicon = null; return empty; }
    return emLexicon;
  }

  // A drug name appearing SOMEWHERE in the prose is not enough — the page also
  // mentions drugs to avoid, drugs for other conditions, and cross-references.
  // A scan that loose put back a thousand medicines across the book, which is
  // guessing, not accuracy. So a recovered medicine must be printed the way the
  // book prints something it is telling you to give: either right under one of
  // its ranking headings ("Second line medicine / Dihydroartemisin/
  // Piperaquine"), or on a line that carries a dose.
  var DOSE_ON_LINE = /\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units?|%)\b/i;
  // …or the line is plainly an instruction to give it, which is how the book
  // prints preventive treatment: "Sulfadoxine/Pyrimethamine (SP) for IPT.
  // Start at 13 weeks and give monthly till delivery".
  var GIVE_ON_LINE = /\b(give|start|administer|prescribe|treat with)\b/i;
  // …but never off a line that is telling you NOT to. The guideline says "Do
  // not give SP in HIV patients on cotrimoxazole"; reading that as a
  // prescription would be the worst kind of mistake this code could make.
  var NOT_A_PRESCRIPTION = /\b(do not|don'?t|never|avoid|avoided|contraindicat\w*|not recommended|not required|not indicated|instead of|rather than|except)\b/i;

  // The programme abbreviations the book uses instead of a name. "Adults:
  // TDF+3TC+ATV/r" is the whole PEP regimen and the only place those medicines
  // are named on the page, so without this the HIV pages list no medicine at all.
  var MED_ABBREV = [
    ['TDF',   'Tenofovir'],
    ['3TC',   'Lamivudine'],
    ['FTC',   'Emtricitabine'],
    ['ABC',   'Abacavir'],
    ['AZT',   'Zidovudine'],
    ['ZDV',   'Zidovudine'],
    ['DTG',   'Dolutegravir'],
    ['EFV',   'Efavirenz'],
    ['NVP',   'Nevirapine'],
    ['ATV/r', 'Atazanavir/ritonavir'],
    ['LPV/r', 'Lopinavir/ritonavir'],
    ['DRV/r', 'Darunavir/ritonavir'],
    ['RAL',   'Raltegravir'],
    ['CTX',   'Cotrimoxazole'],
    ['ORS',   'Oral rehydration salts (ORS)'],
    ['SP',    'Sulfadoxine/Pyrimethamine (SP)'],
  ];

  function lineAround(text, at) {
    var a = text.lastIndexOf('\n', at); a = a < 0 ? 0 : a + 1;
    var b = text.indexOf('\n', at); if (b < 0) b = text.length;
    return { start: a, text: text.slice(a, b) };
  }

  function prescribedHere(text, at, marks) {
    var ln = lineAround(text, at);
    if (NOT_A_PRESCRIPTION.test(ln.text)) return false;
    if (DOSE_ON_LINE.test(ln.text) || GIVE_ON_LINE.test(ln.text)) return true;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].end > at) break;
      var gap = text.slice(marks[i].end, at);
      if ((gap.match(/\n/g) || []).length <= RANK_LINES && (at - marks[i].end) <= RANK_REACH) return true;
    }
    return false;
  }

  function findMissingDrugs(text, already, marks) {
    var lex = emDrugWords();
    if (!lex.length) return [];
    var t = String(text || '');
    var haveKeys = already.map(function (n) { return drugKey(n); }).join(' ');
    var usedKey = {}, usedName = {}, usedNameKeys = [], out = [];
    var re = /[A-Za-z][A-Za-z-]{6,}/g, m;
    while ((m = re.exec(t))) {
      var k = drugKey(m[0]);
      if (k.length < 7 || usedKey[k]) continue;
      if (haveKeys.indexOf(k) >= 0) continue;          // already on the list
      // The medicine whose own name is this word, if there is one; otherwise
      // the closest longer name it is the start of.
      var pick = null;
      for (var i = 0; i < lex.length; i++) {
        if (lex[i].key === k) { pick = lex[i]; break; }
      }
      if (!pick) {
        for (var j = 0; j < lex.length; j++) {
          var e = lex[j];
          if ((k.length >= 8 && e.key.indexOf(k) === 0) ||
              (e.key.length >= 8 && k.indexOf(e.key) === 0)) {
            if (!pick || e.name.length < pick.name.length) pick = e;
          }
        }
      }
      if (!pick) continue;
      if (usedName[pick.name] || haveKeys.indexOf(pick.key) >= 0) { usedKey[k] = 1; continue; }
      // A combination is only proposed when the guideline names both halves —
      // the text saying "epinephrine" does not mean "lignocaine + epinephrine".
      if (pick.parts.length > 1) {
        var whole = drugKey(t);
        var allThere = pick.parts.every(function (pk) { return whole.indexOf(pk) >= 0; });
        if (!allThere) { usedKey[k] = 1; continue; }
      }
      if (!prescribedHere(t, m.index, marks || [])) continue;
      // "Glucose (Dextrose)" and "Dextrose" are the same thing under two
      // names; whichever the guideline printed first is the one kept.
      var nk = drugKey(pick.name);
      if (usedNameKeys.some(function (u) { return u.indexOf(nk) >= 0 || nk.indexOf(u) >= 0; })) {
        usedKey[k] = 1; continue;
      }
      usedKey[k] = 1; usedName[pick.name] = 1; usedNameKeys.push(nk);
      out.push({ name: pick.name, strength: pick.strength, found: m[0] });
    }

    // Now the abbreviations, which the word scan above cannot see.
    MED_ABBREV.forEach(function (pair) {
      var abbr = pair[0], name = pair[1], nk2 = drugKey(name);
      if (usedName[name] || haveKeys.indexOf(drugKey(abbr)) >= 0) return;
      if (usedNameKeys.some(function (u) { return u.indexOf(nk2) >= 0 || nk2.indexOf(u) >= 0; })) return;
      if (haveKeys.indexOf(nk2) >= 0) return;
      // Plain indexOf with the boundaries checked by hand: a lookbehind would
      // throw outright on the older Android WebViews this app still runs on.
      var from = 0, at2;
      while ((at2 = t.indexOf(abbr, from)) >= 0) {
        from = at2 + abbr.length;
        var before = at2 > 0 ? t.charAt(at2 - 1) : ' ';
        var after = t.charAt(at2 + abbr.length) || ' ';
        if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
        var mm = { index: at2 };
        var ln2 = lineAround(t, mm.index).text;
        if (NOT_A_PRESCRIPTION.test(ln2)) continue;
        // Either it is written as part of a regimen (TDF+3TC+ATV/r), or the
        // line is plainly telling you to give it.
        var isRegimen = /[A-Za-z0-9\/]\s*\+\s*[A-Za-z0-9]/.test(ln2);
        if (!isRegimen && !prescribedHere(t, mm.index, marks || [])) continue;
        usedName[name] = 1; usedNameKeys.push(nk2);
        var full = null;
        for (var q = 0; q < lex.length; q++) { if (lex[q].name === name) { full = lex[q]; break; } }
        out.push({ name: name, strength: full ? full.strength : '', found: abbr });
        break;
      }
    });
    return out;
  }

  // frequency text → times/day (so quantity can be computed)
  function freqPerDay(f) {
    var s = String(f || '').toLowerCase();
    if (/once|\bod\b|daily(?!.*\d)/.test(s) && !/twice|three|thrice/.test(s)) return 1;
    if (/twice|\bbd\b|12\s*hourly|every\s*12/.test(s)) return 2;
    if (/thrice|three times|\btds\b|8\s*hourly|every\s*8/.test(s)) return 3;
    if (/four times|\bqid\b|6\s*hourly|every\s*6/.test(s)) return 4;
    var m = /(\d+)\s*(?:times|x)\s*(?:a|per)?\s*day/.exec(s);
    if (m) return Math.min(6, Number(m[1]) || 2);
    return 2;
  }
  function durDays(d) {
    var m = /(\d+)/.exec(String(d || ''));
    return m ? Math.min(90, Number(m[1])) : 5;
  }

  function buildFromGuideline(condId, sev) {
    var c = rows('SELECT id,title,page,causes,clinical_features,differential,investigations,' +
      'management,complications,prevention,notes,full_text FROM conditions WHERE id=? LIMIT 1', [condId])[0];
    if (!c) return null;
    ctx.info = {
      causes: c.causes, clinical_features: c.clinical_features, differential: c.differential,
      investigations: c.investigations, management: c.management, complications: c.complications,
      prevention: c.prevention, notes: c.notes, full_text: c.full_text,
    };
    // EVERY medicine the guideline lists for this condition — no cap. The old
    // "LIMIT 12 … slice(0,6)" silently threw away the rest, which is why the
    // drips and the treatment of complications were never on screen.
    var meds = rows('SELECT name,dose,unit,route,frequency,duration,source_line ' +
                    'FROM medicines WHERE condition_id=? ORDER BY id', [condId]);
    var drugs = meds.map(function (m) {
      var tpd = freqPerDay(m.frequency), dd = durDays(m.duration);
      var reason = medReason(m.source_line);
      // Not a drug name but a piece of the sentence it was printed in. It is
      // still something the guideline says, so it is kept and shown as the line
      // it came from — never dropped, never offered as a medicine to dispense.
      if (!isMedicineName(m.name)) {
        var line = String(m.source_line || m.name || '').trim().replace(/\s+/g, ' ');
        return { drug: m.name, text: line, group: 'other', selected: false, from: 'guideline' };
      }
      return {
        drug: m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : ''),
        dosage: (m.dose ? m.dose + (m.unit || '') : '') + (m.route ? ' ' + m.route : ''),
        timesPerDay: tpd, durationDays: dd,
        qty: tpd * dd,
        from: 'guideline',
        reason: reason,
        group: medGroup(m.name, m.source_line, reason),
      };
    }).filter(function (d, i, a) {
      var k = (d.group === 'other' ? d.text : d.drug).toLowerCase();
      return a.findIndex(function (x) {
        return (x.group === 'other' ? x.text : x.drug).toLowerCase() === k;
      }) === i;
    }).filter(function (d) {
      return d.group !== 'other' || (d.text && d.text.length >= 6);
    });

    // Anything the guideline names that never made it into the medicines table
    // at all. No dose is invented for these — the guideline's own words are
    // shown instead, and the clinician sets the dose if they give it.
    var prose = [c.management, c.prevention, c.notes].filter(Boolean).join('\n');
    var known = drugs.map(function (d) { return d.drug || d.text || ''; });
    var marks = rankMarkers(prose);
    findMissingDrugs(prose, known, marks).forEach(function (mm) {
      drugs.push({
        drug: mm.name,
        // The word the guideline actually printed, which is what to look for
        // when working out the ranking — the book writes "Dihydroartemisin"
        // where the medicines list says "Dihydroartemisinin".
        asWritten: mm.found,
        // The strength as published in the national medicines list. Leaving it
        // blank is what produced the red "Medicine 8 is incomplete" alarm: the
        // app added a medicine and then refused to save the consultation
        // because that medicine had no dose. This is a real published figure,
        // not one the app made up — and it is editable like any other.
        dosage: mm.strength || '',
        // A blanket "2 x 5 = 10" was applied to everything here, which is how
        // a 500 ml bag of Dextrose ended up as ten of something. Whatever runs
        // into a vein starts at ONE — one bag, one ampoule — and the clinician
        // sets the real number.
        timesPerDay: 2, durationDays: 5, qty: 10,
        from: 'guideline-text',
        group: 'treatment',
        selected: false,
      });
    });

    // Put the book's ranking back on: which is first line, which is the
    // alternative, which is second line, which is only for pre-referral.
    drugs.forEach(function (d) {
      // Only the treatment options are ranked. A drip or something given for
      // convulsions is not "second line" anything.
      if (d.group !== 'treatment') return;
      var r = rankOf(d.asWritten || d.drug, prose, marks);
      if (!r) return;
      d.rank = r.key;
      d.rankLabel = r.label || RANK_INFO[r.key].label;
    });
    // The order is the book's own. An earlier version sorted the ranked ones to
    // the top, which was worse: the guideline prints the treatment of choice
    // FIRST and the alternatives after it, so for typhoid that hoisted
    // "Alternative in pregnancy" above the ciprofloxacin everyone gets. The
    // badges say which is which; the order stays as printed.

    // ── What comes through ready to give ─────────────────────────────────
    // Everything the guideline lists arrives included, with its dose, days and
    // quantity filled in. The clinician takes out what this patient is not
    // getting — one tap on the × — rather than tapping thirteen medicines in
    // to build the same list by hand.
    //
    // The only rows that stay out are the ones under "Also in the guideline":
    // those are lines of the book's text, not medicines, and there is nothing
    // to prescribe or deduct for them.
    drugs.forEach(function (d) { d.selected = (d.group || 'treatment') !== 'other'; });

    return {
      tests: extractTests(c.investigations, c.full_text),
      drugs: drugs,
      fees: { consult: 0, lab: 0, meds: 0 },
      paymentStatus: 'pending',
      followUpDays: 7,
      page: c.page, title: c.title,
    };
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function ensurePanel() {
    if (document.getElementById('ucgPanel')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#ucgOverlay{display:none;position:fixed;inset:0;background:rgba(10,20,16,.55);z-index:900;align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}',
      '#ucgPanel{background:var(--bg);width:100%;max-width:640px;max-height:94vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;overflow:hidden}',
      '.ucg-top{background:linear-gradient(140deg,#0B3D2E,#10855F 60%,#17A46F);color:#fff;padding:16px 18px;flex:none}',
      '.ucg-top .k{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.85}',
      '.ucg-top h3{font-size:19px;font-weight:800;margin:2px 0 8px;letter-spacing:-.02em}',
      '.ucg-tags{display:flex;flex-wrap:wrap;gap:6px}',
      '.ucg-tag{font-size:10.5px;font-weight:700;background:rgba(255,255,255,.18);padding:3px 9px;border-radius:999px}',
      '.ucg-tag.learn{background:#FFE0B2;color:#7A4F01}',
      '.ucg-body{overflow-y:auto;padding:14px;flex:1;-webkit-overflow-scrolling:touch}',
      '.ucg-block{background:var(--surface);border-radius:16px;box-shadow:var(--shadow);margin-bottom:12px;overflow:hidden}',
      '.ucg-bh{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--border)}',
      '.ucg-step{width:24px;height:24px;border-radius:8px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;font-size:12px;font-weight:800;display:grid;place-items:center;flex:none}',
      '.ucg-bh h4{font-size:13.5px;font-weight:800;flex:1;color:var(--text)}',
      '.ucg-count{font-size:11px;font-weight:700;color:var(--text-lt)}',
      '.ucg-rows{padding:10px 12px}',
      '.ucg-chip{display:inline-flex;align-items:center;gap:7px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;border-radius:999px;padding:7px 8px 7px 13px;font-size:12.5px;font-weight:700;margin:0 6px 6px 0}',
      '.ucg-x{border:none;background:rgba(0,0,0,.10);color:inherit;width:19px;height:19px;border-radius:50%;font-size:13px;line-height:1;cursor:pointer;display:grid;place-items:center;flex:none;font-family:inherit}',
      '.ucg-x:hover{background:#E0454B;color:#fff}',
      // Each kind of medicine under its own heading, so it is clear what is a
      // choice of treatment and what is there for a complication.
      '.ucg-mg{margin-bottom:12px}',
      '.ucg-mgh{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#0B6B4F;text-transform:uppercase;letter-spacing:.5px;margin:2px 0 3px}',
      '.ucg-mgh span{background:var(--brand-tint,#DBF4EA);color:#0A5C43;border-radius:999px;padding:0 7px;font-size:10px;letter-spacing:0}',
      '.ucg-mgi{font-size:11px;color:var(--text-lt);line-height:1.4;margin-bottom:7px}',
      '.ucg-from{display:flex;gap:8px;align-items:flex-start;background:rgba(11,92,138,.12);color:#0B5C8A;' +
        'border-radius:11px;padding:9px 11px;margin:0 0 11px;font-size:12px;line-height:1.45}',
      '.ucg-from .material-icons-outlined{font-size:17px;flex:none;margin-top:1px}',
      'html[data-theme="dark"] .ucg-from{color:#8FCBEC;background:rgba(11,92,138,.20)}',
      '.ucg-note{font-size:12px;color:var(--text-lt);line-height:1.5;padding:7px 11px;border-left:2px solid var(--border);margin-bottom:6px}',
      '.ucg-pick{display:flex;gap:8px;align-items:flex-start;background:rgba(230,124,15,.14);color:#8A4B04;' +
        'border-radius:11px;padding:9px 11px;margin-bottom:11px;font-size:12px;line-height:1.45;font-weight:600}',
      '.ucg-pick .material-icons-outlined{font-size:17px;flex:none;margin-top:1px}',
      '.ucg-pick.ok{background:rgba(14,124,90,.13);color:#0B6B4F}',
      'html[data-theme="dark"] .ucg-pick.ok{color:#7FD9B4;background:rgba(14,124,90,.20)}',
      'html[data-theme="dark"] .ucg-pick{color:#F5C089;background:rgba(230,124,15,.18)}',
      'html[data-theme="dark"] .ucg-mgh{color:#5FD3A8}',
      // The tick is what says "this one is being given" — untapped rows are
      // shown but nothing is prescribed or taken off the shelf for them.
      '.ucg-tick{grid-column:1;grid-row:1;align-self:start;width:26px;height:26px;border-radius:9px;border:1.5px solid var(--border);' +
        'background:var(--surface);color:var(--text-lt);display:grid;place-items:center;cursor:pointer;font-family:inherit;flex:none;margin-right:2px}',
      '.ucg-tick .material-icons-outlined{font-size:16px}',
      '.ucg-tick.on{background:#0E7C5A;border-color:#0E7C5A;color:#fff}',
      '.ucg-drug{display:grid;grid-template-columns:auto 1fr auto;gap:8px 9px;padding:11px;border-radius:12px;background:var(--bg);margin-bottom:8px;opacity:.72}',
      '.ucg-drug.on{opacity:1;background:var(--brand-tint,#EAF7F1)}',
      'html[data-theme="dark"] .ucg-drug.on{background:rgba(14,124,90,.20)}',
      '.ucg-drug .nm{grid-column:2;grid-row:1;min-width:0}',
      '.ucg-drug .nm b{font-size:13.5px;font-weight:800;color:var(--text);display:block;line-height:1.3;overflow-wrap:anywhere}',
      '.ucg-drug .nm span{font-size:11px;color:var(--text-lt);display:block;margin-top:1px}',
      '.ucg-drug .nm .ucg-rank,.ucg-drug .nm .ucg-stk{display:inline-block;width:auto}',
      '.ucg-rank{display:inline-block;margin:2px 0 0;font-size:9.5px;font-weight:800;letter-spacing:.5px;' +
        'padding:1px 7px;border-radius:9px;background:var(--bg);color:var(--text-lt);line-height:1.7}',
      '.ucg-rank.r-first{background:rgba(14,124,90,.16);color:#0B6B4F}',
      '.ucg-rank.r-alt{background:rgba(11,92,138,.14);color:#0B5C8A}',
      '.ucg-rank.r-second,.ucg-rank.r-third{background:rgba(138,90,6,.14);color:#8A5A06}',
      '.ucg-rank.r-prereferral{background:rgba(179,38,30,.13);color:#B3261E}',
      'html[data-theme="dark"] .ucg-rank.r-first{color:#5FD3A8}',
      'html[data-theme="dark"] .ucg-rank.r-alt{color:#79C4EE}',
      'html[data-theme="dark"] .ucg-rank.r-second,html[data-theme="dark"] .ucg-rank.r-third{color:#E5B463}',
      'html[data-theme="dark"] .ucg-rank.r-prereferral{color:#FF9E93}',
      '.ucg-stk{display:inline-block;margin-top:3px;font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;line-height:1.6}',
      '.ucg-stk.ok{background:rgba(46,125,50,.14);color:#2E7D32}',
      '.ucg-stk.no{background:rgba(230,124,15,.16);color:#B35309}',
      // Dark mode needs the lighter end of both colours to stay readable.
      'html[data-theme="dark"] .ucg-stk.ok{color:#8FD79B}',
      'html[data-theme="dark"] .ucg-stk.no{color:#F5B160}',
      '.ucg-drug .fields{grid-column:1 / -1;grid-row:2;display:flex;gap:9px;align-items:end}',
      '.ucg-drug .fields > div{flex:0 0 auto}',
      '.ucg-drug .ucg-x{grid-column:3;grid-row:1;align-self:start}',
      '.ucg-num{width:44px;text-align:center;border:1.5px solid var(--border);border-radius:9px;padding:6px 2px;font:inherit;font-size:13px;font-weight:700;background:var(--surface);color:var(--text)}',
      '.ucg-lbl{font-size:9.5px;font-weight:700;color:var(--text-lt);text-transform:uppercase;letter-spacing:.4px;text-align:center;display:block;margin-bottom:2px}',
      // A drip is hung here, not carried home — said plainly on the row.
      '.fields-here{grid-template-columns:1fr auto !important;align-items:center}',
      '.ucg-here{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#0E7C5A;line-height:1.3}',
      // The common drips, one tap each — on every condition, not just the few
      // the book happens to name a fluid for.
      '.ucg-qf{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 12px}',
      '.ucg-qfb{padding:6px 11px;border-radius:20px;border:1.5px dashed var(--border,#D7E4D9);background:transparent;color:#0E7C5A;font:inherit;font-size:12px;font-weight:700;cursor:pointer;touch-action:manipulation}',
      '.ucg-qfb:active{background:rgba(14,124,90,.10)}',
      'html[data-theme="dark"] .ucg-qfb{border-color:#3A4A40;color:#7BC98A}',
      '.ucg-here .material-icons-outlined{font-size:15px}',
      'html[data-theme="dark"] .ucg-here{color:#7BC98A}',
      '.ucg-add{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;background:linear-gradient(135deg,#7C6CF0,#5B49D6);color:#fff;border-radius:13px;padding:12px 18px;font:inherit;font-size:13.5px;font-weight:800;cursor:pointer;margin-top:8px;box-shadow:0 6px 14px rgba(108,92,231,.30);touch-action:manipulation}',
      '.ucg-add:active{transform:scale(.98)}',
      '.ucg-money{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;padding:12px}',
      '.ucg-money label{font-size:10px;font-weight:800;color:var(--text-lt);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:4px}',
      '.ucg-money input{width:100%;border:1.5px solid var(--border);border-radius:11px;padding:10px;font:inherit;font-size:15px;font-weight:700;background:var(--surface);color:var(--text);text-align:right}',
      '.ucg-total{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;border-top:1px solid var(--border);font-size:13px;font-weight:800;color:var(--text)}',
      '.ucg-total b{font-size:18px;color:#0E7C5A;letter-spacing:-.02em}',
      '.ucg-foot{flex:none;padding:12px 14px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:9px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}',
      '.ucg-btn{flex:1;border:none;border-radius:14px;padding:14px;font:inherit;font-size:14.5px;font-weight:800;cursor:pointer}',
      '.ucg-btn.ghost{background:var(--bg);color:var(--text-lt);flex:0 0 34%}',
      '.ucg-btn.go{background:linear-gradient(135deg,#17936B,#0C6A4C);color:#fff;box-shadow:0 8px 18px rgba(14,124,90,.3)}',
      '.ucg-src{font-size:11px;color:var(--text-lt);padding:2px 2px 10px}',
      '#ucgSearchWrap{padding:0 12px 12px}',
      '#ucgSearchWrap input{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:11px 13px;font:inherit;font-size:15px;background:var(--surface);color:var(--text)}',
      '#ucgSearchRes,#ucgTestRes{background:var(--surface);border-radius:12px;box-shadow:var(--shadow);max-height:260px;overflow-y:auto;display:none;margin-top:8px;border:1.5px solid var(--brand-tint,#DBF4EA)}',
      '#ucgSearchRes div,#ucgTestRes div{padding:11px 13px;font-size:13.5px;cursor:pointer;border-bottom:1px solid var(--border)}',
      '#ucgSearchRes div:hover,#ucgTestRes div:hover{background:var(--brand-tint,#DBF4EA)}',
      '.ucg-ask{position:fixed;inset:0;background:rgba(10,20,16,.6);z-index:950;display:none;align-items:center;justify-content:center;padding:20px}',
      '.ucg-ask-card{background:var(--surface);border-radius:20px;max-width:420px;width:100%;padding:20px;box-shadow:var(--shadow-lg)}',
      '.ucg-ask-card h4{font-size:16px;font-weight:800;margin-bottom:6px;color:var(--text)}',
      '.ucg-ask-card p{font-size:13px;color:var(--text-lt);line-height:1.5;margin-bottom:10px}',
      '.ucg-diff{background:var(--bg);border-radius:12px;padding:10px 12px;font-size:12.5px;color:var(--text);margin-bottom:14px;max-height:180px;overflow-y:auto}',
      '.ucg-diff div{padding:2px 0}',
      '.em-tag{display:inline-block;margin-left:6px;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;vertical-align:1px}',
      '.em-tag.warn{background:#FCEFCF;color:#8A5A06}',
      '.em-tag.ven-V{background:#FBE1DE;color:#B3261E}',
      '.em-tag.ven-E{background:#DBEFFB;color:#0B5C8A}',
      '.em-tag.ven-N{background:var(--bg);color:var(--text-lt)}',
      '.ucg-paylbl{margin:14px 0 7px;font-size:10.5px;font-weight:800;color:var(--text-lt);letter-spacing:.6px;text-transform:uppercase}',
      '.ucg-pay{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.ucg-paychip{padding:12px 8px;border:1.5px solid var(--border);border-radius:14px;background:var(--surface,#fff);'
        + 'font:inherit;font-size:13.5px;font-weight:700;color:var(--text);cursor:pointer;text-align:center}',
      '.ucg-paychip.on{border-color:#0E7C5A;background:var(--brand-tint,#DBF4EA);color:#0A5C43;box-shadow:0 0 0 3px rgba(14,124,90,.10)}',
      '.ucg-payhint{margin-top:8px;font-size:12px;line-height:1.45;color:var(--text-lt)}',
      '.em-src{float:right;font-size:9.5px;font-weight:800;color:var(--text-lt);letter-spacing:.06em;margin-top:3px}',
      '.ucg-det{border-radius:12px;background:var(--bg);margin-bottom:7px;overflow:hidden}',
      '.ucg-det summary{display:flex;align-items:center;gap:9px;padding:12px 13px;cursor:pointer;list-style:none;font-size:13px;font-weight:700;color:var(--text)}',
      '.ucg-det summary::-webkit-details-marker{display:none}',
      '.ucg-det summary .material-icons-outlined{font-size:18px;color:#0E7C5A;flex:none}',
      '.ucg-det summary .chev{margin-left:auto;color:var(--text-lt);transition:transform .18s}',
      '.ucg-det[open] summary .chev{transform:rotate(180deg)}',
      // The notes are real markup now (headings, paragraphs, bullets), not a
      // pre-formatted dump, so pre-line would fight the layout.
      '.ucg-det-b{padding:0 13px 13px;font-size:13px;line-height:1.55;color:var(--text);max-height:52vh;overflow-y:auto}',
      // A heading is separated from what came before by a rule, so it is
      // obvious where one point stops and the next begins.
      '.gl-h{font-size:12.5px;font-weight:800;color:#0B6B4F;margin:15px 0 7px;padding-top:12px;border-top:1px solid var(--border);line-height:1.35}',
      '.gl-h:first-child{margin-top:0;padding-top:0;border-top:none}',
      '.gl-p{margin:0 0 9px;line-height:1.55}',
      '.gl-frag{margin:0 0 9px;color:var(--text-lt);font-style:italic}',
      '.gl-ul{margin:0 0 11px;padding:0;list-style:none}',
      '.gl-ul li{position:relative;padding-left:17px;margin-bottom:6px;line-height:1.5}',
      '.gl-ul li:before{content:"";position:absolute;left:4px;top:8px;width:5px;height:5px;border-radius:50%;background:#0E7C5A}',
      '.gl-warn{display:flex;gap:8px;align-items:flex-start;background:rgba(198,40,40,.10);color:#B3261E;' +
        'border-radius:10px;padding:9px 11px;margin:0 0 10px;font-weight:700;line-height:1.45}',
      '.gl-warn .material-icons-outlined{font-size:17px;flex:none;margin-top:1px}',
      'html[data-theme="dark"] .gl-h{color:#5FD3A8}',
      'html[data-theme="dark"] .gl-warn{color:#FFA79C;background:rgba(255,138,128,.13)}',
      'html[data-theme="dark"] .gl-ul li:before{background:#5FD3A8}',
    ].join('\n');
    document.head.appendChild(css);

    var ov = document.createElement('div');
    ov.id = 'ucgOverlay';
    ov.innerHTML =
      '<div id="ucgPanel">' +
        '<div class="ucg-top">' +
          '<div class="k" id="ucgKicker">Standard package</div>' +
          '<h3 id="ucgTitle">—</h3>' +
          '<div class="ucg-tags" id="ucgTags"></div>' +
        '</div>' +
        '<div class="ucg-body" id="ucgBody"></div>' +
        '<div class="ucg-foot" style="flex-wrap:wrap">' +
          '<button class="ucg-btn ghost" id="ucgCancel" style="flex:0 0 auto;padding-left:16px;padding-right:16px">Cancel</button>' +
          '<button class="ucg-btn ghost" id="ucgApply" style="flex:1 1 40%">Apply &amp; review</button>' +
          '<button class="ucg-btn go" id="ucgSave" style="flex:1 1 100%">Save treatment</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var ask = document.createElement('div');
    ask.className = 'ucg-ask'; ask.id = 'ucgAsk';
    ask.innerHTML =
      '<div class="ucg-ask-card">' +
        '<h4 id="ucgAskTitle">Save as your clinic standard?</h4>' +
        '<p id="ucgAskText"></p>' +
        '<div class="ucg-diff" id="ucgAskDiff"></div>' +
        '<div style="display:flex;gap:9px">' +
          '<button class="ucg-btn ghost" id="ucgAskNo" style="flex:1">Not now</button>' +
          '<button class="ucg-btn go" id="ucgAskYes" style="flex:1">Save standard</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ask);

    document.getElementById('ucgCancel').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('ucgApply').onclick = apply;
    document.getElementById('ucgSave').onclick = applyAndSave;
  }

  // "Save consultation" — the whole point of a one-tap package. Apply it and
  // record the consultation, full stop.
  //
  // The phone number is OPTIONAL: a walk-in is identified by the case number
  // (#001M2208O) from the moment they are seen, and the name and contact are
  // filled in afterwards. This used to divert to the phone box, which defeated
  // the entire one-tap idea.
  function applyAndSave() {
    applyToWizard();
    close();
    // The clinic still gets asked whether to learn the changes — but the
    // consultation is saved either way, so the question can never swallow it.
    var changes = changeSummary();
    if (!changes.length) { _finishSave(); return; }
    askToLearn(changes, _finishSave);
  }

  function _finishSave() {
    try { if (window._showStep) window._showStep(2); } catch (e) {}
    var btn = document.getElementById('submitBtn');
    if (!btn) { toast('Could not find the save button — press Send below.', 'error'); return; }
    try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    setTimeout(function () { try { btn.click(); } catch (e) {} }, 250);
  }

  // The learn prompt, shared by "Apply & review" and "Save consultation".
  // `then` runs after either answer.
  function askToLearn(changes, then) {
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent =
      ctx.learned ? 'Update your clinic standard?' : 'Save as your clinic standard?';
    document.getElementById('ucgAskText').textContent =
      'You changed this package for ' + ctx.title +
      (ctx.severity ? ' (' + ctx.severity + ')' : '') +
      '. Should the app auto-fill it this way next time?';
    document.getElementById('ucgAskDiff').innerHTML =
      changes.map(function (c) { return '<div>' + esc(c) + '</div>'; }).join('');
    document.getElementById('ucgAskYes').textContent = ctx.learned ? 'Update standard' : 'Save standard';
    ask.style.display = 'flex';
    document.getElementById('ucgAskNo').onclick = function () {
      ask.style.display = 'none';
      if (then) then();
    };
    document.getElementById('ucgAskYes').onclick = function () {
      saveLearned(ctx.conditionId, ctx.severity, pkg);
      ask.style.display = 'none';
      toast('Saved — this is now your standard for ' + ctx.title, 'success');
      if (then) then();
    };
  }

  function close() { var o = document.getElementById('ucgOverlay'); if (o) o.style.display = 'none'; }

  // The guideline's medicines, laid out the way the book means them: the
  // treatment (usually a CHOICE, not a course), the supportive treatment for
  // complications, the drips, and — kept, not thrown away — the lines that are
  // not a medicine at all but that the guideline still says.
  var MED_GROUPS = [
    { key: 'treatment',  title: 'Treatment',
      hint: 'The guideline ranks these — first line, then the alternative, then second line. Remove the ones you are not giving.' },
    { key: 'supportive', title: 'Supportive treatment',
      hint: 'For complications — remove any the patient does not have.' },
    // ALWAYS shown, on every condition. The book only names a drip on 23 of
    // its 340 treatable conditions, so on the other 93% there was nowhere to
    // put one — yet whether a patient needs fluids is a bedside decision, not
    // something the chapter can know in advance. The section stands empty and
    // waiting rather than absent.
    { key: 'fluid',      title: 'Drips, fluids &amp; blood', always: true,
      hint: 'IV fluids, rehydration and blood — remove any not being run.',
      empty: 'The guideline does not name a drip for this condition. If you are running one, add it here.' },
    { key: 'other',      title: 'Also in the guideline',
      hint: 'The guideline says this, but it is not a medicine the app can add for you — use the search below.' },
  ];

  // ── Things run into a vein, not handed over a counter ────────────────────
  // A drip, an infusion or an IV ampoule is administered AT THE CLINIC. The
  // "×/day for N days" model belongs to tablets and does not describe it: one
  // bag of Dextrose 5% is hung once. Treating it as a tablet is what produced
  // "QTY 10" and a shelf reading "-30 tabs" of a 500 ml bottle.
  function isGivenHere(d) {
    if ((d.group || '') === 'fluid') return true;
    var t = (String(d.drug || '') + ' ' + String(d.dosage || '')).toLowerCase();
    return /\biv\b|\bim\b|infusion|injection|inject|ampoule|\bamp\b|drip/.test(t);
  }
  // The word for one of them, taken from what the clinic actually stocks where
  // that is known, and from the blueprint otherwise. Never "tabs" for a drip.
  function givenUnit(d) {
    // What the clinic already stocks it as is the truth.
    try {
      var row = matchStockRow(d.drug, d.dosage);
      if (row && row.unit && !/^tabs?$/i.test(row.unit)) return String(row.unit);
    } catch (e) {}
    // Not stocked yet — work it out from the form. The dosage text carries it
    // ("125 mg/5 ml Oral suspension"), and so sometimes does the name itself
    // ("Amoxicillin syrup"). Passing the name alone found no form at all, so
    // every unstocked syrup came back as a plain count.
    try {
      if (window.StockBlueprint) {
        var hint = String(d.dosage || '') + ' ' + String(d.drug || '');
        var u = window.StockBlueprint.blueprintFor({
          name: d.drug, form: hint, itemType: 'medicine',
        }).unit;
        if (u && !/^tabs?$/i.test(u)) return u;
      }
    } catch (e) {}
    return 'units';
  }

  // Anything given here starts at ONE — one bag, one ampoule. The tablet
  // arithmetic (times a day × days) does not describe a drip, and applying it
  // put ten of a 500 ml bottle on the prescription and took ten off the shelf.
  // The clinician still sets the real number; this only fixes the start point.
  function normaliseGivenHere(p) {
    if (!p || !p.drugs) return;
    p.drugs.forEach(function (d) {
      if (isGivenHere(d)) {
        d.givenHere = true;
        d.timesPerDay = 1;
        d.durationDays = 1;
        // Keep a small figure the book actually stated; replace a tablet-shaped
        // multiple with one.
        var q = Number(d.qty) || 0;
        d.qty = (q > 0 && q <= 6) ? q : 1;
        return;
      }
      // A syrup, cream, inhaler or drops: the times-a-day and the days are the
      // patient's real instructions and are kept, but what comes OFF THE SHELF
      // is containers. One bottle covers the course unless the clinician says
      // otherwise — it was taking one bottle per dose.
      if (isWholeContainer(d)) {
        var qc = Number(d.qty) || 0;
        var doses = (Number(d.timesPerDay) || 1) * (Number(d.durationDays) || 1);
        if (qc === doses || qc > 6 || qc === 0) d.qty = 1;
      }
    });
  }

  // Tablets are dispensed one dose at a time, so "3 a day for 5 days" really
  // is 15 tablets off the shelf. A syrup, a cream, an inhaler or eye drops are
  // not: the patient takes 5 ml three times a day out of ONE bottle. Counting
  // those in doses took 15 bottles off the shelf for a single child's course —
  // 88 medicines in the national list are containers like this, 37 of them
  // named in the guideline, so the stock was wrong every time one was given.
  function isWholeContainer(d) {
    if (isGivenHere(d)) return false;          // drips are handled on their own
    var u = String(givenUnit(d) || '').toLowerCase();
    return /bottle|tube|inhaler|tub\b|jar|sachet|pessar|supposit|piece|roll/.test(u);
  }
  // The label over the quantity box: the unit the shelf actually counts in, so
  // it is never a bare "QTY" that could mean doses or bottles.
  function qtyLabel(d) {
    if (!isWholeContainer(d)) return 'Qty';
    return String(givenUnit(d) || 'units');
  }

  function drugRowHtml(d, i) {
    if (d.group === 'other') {
      return '<div class="ucg-note">' + esc(d.text || d.drug) + '</div>';
    }
    var on = !!d.selected;
    return '<div class="ucg-drug' + (on ? ' on' : '') + '">' +
      '<button class="ucg-tick' + (on ? ' on' : '') + '" data-tick="' + i + '" ' +
        'aria-pressed="' + on + '" title="' + (on ? 'Giving this' : 'Tap to give this') + '">' +
        '<span class="material-icons-outlined">' + (on ? 'check' : 'add') + '</span></button>' +
      '<div class="nm"><b>' + esc(d.drug) + '</b>' +
        (d.rank ? '<span class="ucg-rank r-' + d.rank + '">' + esc(d.rankLabel || RANK_INFO[d.rank].label) + '</span>' : '') +
        '<span>' + esc(d.dosage || '') +
        (d.reason ? ' · for ' + esc(d.reason.toLowerCase()) : '') +
        (d.from === 'learned' ? ' · your standard' : '') +
        (d.from === 'guideline-text' ? ' · named in the guideline · strength from the national list' : '') +
        '</span>' + (on ? stockNote(d) : '') + '</div>' +
      '<button class="ucg-x" data-rmdrug="' + i + '" title="Remove">×</button>' +
      (on ? (isGivenHere(d)
        // A drip is hung here and now. It is not taken twice a day for five
        // days, and it is not carried home — so it is counted the way it is
        // actually used: how many bags or ampoules were run, given at the
        // clinic. Asking for ×/day and Days here produced 10 "tabs" of
        // Dextrose 5% off the shelf, which is not a real thing.
        ? '<div class="fields fields-here">' +
            '<div class="ucg-here">' +
              '<span class="material-icons-outlined">vaccines</span>' +
              'Given here at the clinic — not taken home' +
            '</div>' +
            '<div><span class="ucg-lbl">' + esc(givenUnit(d)) + '</span>' +
              '<input class="ucg-num" type="number" min="0" max="99" value="' +
              (Number(d.qty) > 0 ? Number(d.qty) : 1) + '" data-qt="' + i + '"></div>' +
          '</div>'
        : '<div class="fields">' +
            '<div><span class="ucg-lbl">×/day</span>' +
              '<input class="ucg-num" type="number" min="1" max="6" value="' + (d.timesPerDay || 2) + '" data-fd="' + i + '"></div>' +
            '<div><span class="ucg-lbl">Days</span>' +
              '<input class="ucg-num" type="number" min="1" max="90" value="' + (d.durationDays || 5) + '" data-dd="' + i + '"></div>' +
            '<div><span class="ucg-lbl">' + esc(qtyLabel(d)) + '</span>' +
              '<input class="ucg-num" type="number" min="0" value="' + (d.qty || 0) + '" data-qt="' + i + '"></div>' +
          '</div>') : '') +
    '</div>';
  }

  // The fluids a Ugandan clinic actually hangs, offered as one tap each so a
  // drip can be started on any condition without hunting through a search box.
  // The clinician still sets the amount.
  var QUICK_FLUIDS = [
    { name: 'Sodium chloride 0.9%',  label: 'Normal saline 0.9%' },
    { name: "Ringer's Lactate",      label: "Ringer's Lactate" },
    { name: 'Dextrose 5%',           label: 'Dextrose 5%' },
    { name: 'Dextrose 10%',          label: 'Dextrose 10%' },
    { name: 'Dextrose 50%',          label: 'Dextrose 50%' },
    { name: 'Half strength Darrow',  label: "Half-strength Darrow's" },
    { name: 'Whole blood',           label: 'Whole blood' },
    { name: 'Water for injection',   label: 'Water for injection' },
  ];

  function quickFluidsHtml() {
    return '<div class="ucg-qf">' +
      QUICK_FLUIDS.map(function (f, i) {
        return '<button type="button" class="ucg-qfb" data-qf="' + i + '">+ ' +
               esc(f.label) + '</button>';
      }).join('') + '</div>';
  }

  function drugGroupsHtml() {
    return MED_GROUPS.map(function (g) {
      var rows = pkg.drugs.map(function (d, i) { return { d: d, i: i }; })
        .filter(function (r) { return (r.d.group || 'treatment') === g.key; });
      if (!rows.length && !g.always) return '';
      return '<div class="ucg-mg"><div class="ucg-mgh">' + g.title +
             '<span>' + rows.length + '</span></div>' +
             '<div class="ucg-mgi">' + (rows.length ? g.hint : (g.empty || g.hint)) + '</div>' +
             rows.map(function (r) { return drugRowHtml(r.d, r.i); }).join('') +
             (g.key === 'fluid' ? quickFluidsHtml() : '') + '</div>';
    }).join('');
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    var b = document.getElementById('ucgBody');
    var giveable = pkg.drugs.filter(function (d) { return (d.group || 'treatment') !== 'other'; });
    var nGiveable = giveable.length;
    var nSel = giveable.filter(function (d) { return d.selected; }).length;
    var firstSel = (giveable.filter(function (d) { return d.selected; })[0] || {}).drug || '';
    var totalQty = pkg.drugs.reduce(function (s, d) {
      return s + (d.selected ? (Number(d.qty) || 0) : 0);
    }, 0);
    b.innerHTML =
      '<div class="ucg-src">From the Uganda Clinical Guidelines 2023' +
        (ctx.page ? ' · p.' + esc(ctx.page) : '') +
        '. Everything below is editable — remove with ×, add with +.</div>' +
      // The book prints some conditions' treatment on another page. Say which,
      // so nobody has to wonder where this package came from.
      (ctx.borrowedFrom ? '<div class="ucg-from">' +
        '<span class="material-icons-outlined">menu_book</span>' +
        '<span>The guidelines print the treatment for <b>' + esc(ctx.title) + '</b> on the ' +
        '<b>' + esc(ctx.borrowedFrom.title) + '</b> page' +
        (ctx.borrowedFrom.page ? ' (p.' + esc(ctx.borrowedFrom.page) + ')' : '') +
        ' — the two are covered together. This is that page\'s package.</span></div>' : '') +

      // ① Investigations
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">1</span>' +
        '<h4>Lab tests to order</h4><span class="ucg-count">' + pkg.tests.length + '</span></div>' +
        '<div class="ucg-rows" id="ucgTests">' +
          (pkg.tests.length ? pkg.tests.map(function (t, i) {
            return '<span class="ucg-chip">' + esc(t) +
              '<button class="ucg-x" data-rmtest="' + i + '" title="Remove">×</button></span>';
          }).join('') : '<div style="font-size:12.5px;color:var(--text-lt);padding:2px 0 6px">No tests suggested — add one.</div>') +
          '<div><button class="ucg-add" id="ucgAddTest">+ Add test</button></div>' +
        '</div></div>' +

      // ② Medicines
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">2</span>' +
        '<h4>Medicines &amp; dosage</h4><span class="ucg-count">' + nSel +
        ' of ' + nGiveable + ' · ' + totalQty + ' units</span></div>' +
        '<div class="ucg-rows" id="ucgDrugs">' +
          // Say plainly what is ticked and what is not — a consultation saved
          // with the wrong medicine, or with none, is easy to do silently.
          (nGiveable && !nSel
            ? '<div class="ucg-pick" id="ucgPick">' +
              '<span class="material-icons-outlined">touch_app</span>' +
              '<span>Nothing included. Tap <b>+</b> on each medicine you are giving — ' +
              'nothing is prescribed, and nothing leaves the shelf, until you do.</span></div>'
            : (nSel ? '<div class="ucg-pick ok" id="ucgPick">' +
              '<span class="material-icons-outlined">check_circle</span>' +
              '<span><b>All ' + nSel + '</b> ' + (nSel === 1 ? 'medicine is' : 'medicines are') +
              ' ready to give, with doses filled in. Take out what this patient is not ' +
              'getting with <b>×</b> — only what is left is prescribed and comes off the shelf.' +
              '</span></div>' : '')) +
          (pkg.drugs.length ? drugGroupsHtml() :
            '<div style="font-size:12.5px;color:var(--text-lt);padding:2px 0 6px">No medicines suggested — add one.</div>') +
        '</div>' +
        '<div id="ucgSearchWrap">' +
          '<input id="ucgDrugSearch" placeholder="Search a drug to add — type e.g. amo…" autocomplete="off">' +
          '<div id="ucgSearchRes"></div>' +
        '</div></div>' +

      // ③ Charges
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">3</span>' +
        '<h4>Charges (UGX)</h4><span class="ucg-count">you enter</span></div>' +
        '<div class="ucg-money">' +
          '<div><label>Treatment</label><input type="number" min="0" id="ucgFeeC" value="' + (pkg.fees.consult || 0) + '"></div>' +
          '<div><label>Lab</label><input type="number" min="0" id="ucgFeeL" value="' + (pkg.fees.lab || 0) + '"></div>' +
          '<div><label>Medicines</label><input type="number" min="0" id="ucgFeeM" value="' + (pkg.fees.meds || 0) + '"></div>' +
        '</div>' +
        '<div class="ucg-total"><span>Total charged</span><b id="ucgTotal">UGX ' +
          ((pkg.fees.consult || 0) + (pkg.fees.lab || 0) + (pkg.fees.meds || 0)).toLocaleString('en-UG') + '</b></div>' +
        // Saving straight from here means the money has to be settled here too.
        // "Paid" writes to the payments ledger, so it shows in Money In at once.
        '<div class="ucg-paylbl">Payment</div>' +
        '<div class="ucg-pay" id="ucgPay">' +
          PAY_OPTS.map(function (o) {
            return '<button type="button" class="ucg-paychip' +
              (pkg.paymentStatus === o.k ? ' on' : '') + '" data-pay="' + o.k + '">' +
              o.icon + ' ' + o.label + '</button>';
          }).join('') +
        '</div>' +
        '<div class="ucg-payhint" id="ucgPayHint"></div>' +
        '</div>' +

      // ④ Clinical guidance from the guideline — tap to open
      (ctx.info ? '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">4</span>' +
        '<h4>Guideline notes for this condition</h4><span class="ucg-count">tap to open</span></div>' +
        '<div class="ucg-rows">' + guidanceHtml() + '</div></div>' : '') +

      // ⑤ Follow-up + another condition
      '<div class="ucg-block"><div class="ucg-bh"><span class="ucg-step">' + (ctx.info ? '5' : '4') + '</span>' +
        '<h4>Review &amp; next visit</h4></div>' +
        '<div class="ucg-rows" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:13px;color:var(--text)">Return in</span>' +
          '<input class="ucg-num" style="width:56px" type="number" min="0" max="120" id="ucgFollow" value="' + (pkg.followUpDays || 7) + '">' +
          '<span style="font-size:13px;color:var(--text)">days</span>' +
          '<button class="ucg-add" id="ucgAddCond" style="margin-left:auto">+ Add another condition</button>' +
        '</div></div>';

    wireRows();
  }

  // ── Making the guideline readable ─────────────────────────────────────────
  // The UCG is a printed book. What we hold is the text lifted out of its PDF,
  // and it carries all the marks of the page it came off: headings shouted in
  // capitals, sentences chopped wherever the column ended, bullet glyphs that
  // came through as "~", printer's rules left behind as rows of dashes, and the
  // running page header repeated in the middle of the text. Shown as-is it is a
  // wall of lines with no way to tell a heading from a sentence, or to see
  // where one point ends and the next begins.
  //
  // These three functions rebuild it: throw away the page furniture, stitch the
  // broken sentences back together, then mark what is a heading, what is a
  // bullet, and what is a warning.

  // Page furniture — never clinical content, always safe to drop.
  var GL_DROP = [
    /^uganda clinical guidelines\s*\d{0,4}$/i,   // running header
    /^chapter\s+\d+\s*:.{0,44}$/i,               // running header
    /^[-—–_=|\s.]{2,}$/,                         // a rule ruled off a table
    /^\d{1,4}$/,                                 // bare page number
  ];
  // "~" is what the book's bullet became in the PDF — by far the commonest.
  var GL_BULLET = /^([~•¾»▪■◦●○*·]|--?|o|\d{1,2}[.)])\s+/;
  var GL_WARN   = /^(do not|don't|never|caution|warning|avoid|beware)\b/i;

  function glShout(s) {                 // a line printed in capitals
    return s === s.toUpperCase() && /[A-Z]{3}/.test(s);
  }

  // The headings the book uses again and again. Matching the whole line only,
  // so these can never swallow a sentence that merely starts the same way.
  var GL_LABEL = new RegExp('^(' + [
    '(first|second|third)[- ]line( (medicine|medicines|alternative|treatment|regimen|drugs?|therapy))?',
    'pre-?referral treatment', 'referral( criteria)?', 'admission criteria',
    'supportive (care|treatment)', 'adjunct(ive)? treatment', 'follow[- ]?up( care)?',
    'patient education( and counselling)?', 'prevention( and control)?',
    'treatment', 'management', 'diagnosis', 'investigations?', 'dosage',
    'notes?', 'cautions?', 'warning', 'summary', 'definition', 'causes',
    'clinical features', 'differential diagnosis', 'complications',
    '(dosage|treatment|management|prevention|dose) of .{2,60}',
    'in (children|adults|pregnancy|infants|neonates|the elderly).{0,40}',
    'intermittent preventive treatment.{0,40}',
  ].join('|') + ')$', 'i');

  // Words from the condition's own name, used to spot the book's sub-headings:
  // under "Complicated/Severe Malaria", a short line reading "Severe Malaria"
  // or "Uncomplicated Malaria" is a heading, not a sentence.
  function glTopicWords(topic) {
    return String(topic || '').toLowerCase().split(/[^a-z]+/)
      .filter(function (w) { return w.length >= 5; });
  }

  function glIsHeading(s, topic) {
    var words = s.split(/\s+/);
    // A word only counts if it is actually a word — so "DAY 1", a table
    // column, is not mistaken for a heading, while "TREATMENT LOC" is.
    var realWords = words.filter(function (w) { return /[A-Za-z]{2}/.test(w); }).length;
    // "NATIONAL MALARIA TREATMENT POLICY", "DEGREE OF DEHYDRATION" — but not a
    // lone table cell like "MILD", and not an ICD code like "Z20.3, Z23".
    if (glShout(s) && realWords >= 2 && s.length <= 80) return true;
    // "1.2 Trauma and Injuries"
    if (/^\d+(\.\d+)+\s+[A-Za-z]/.test(s) && words.length <= 12) return true;
    // A line that ends in a colon is introducing what follows — a heading.
    if (/:$/.test(s) && s.length <= 95 && words.length <= 14) return true;
    // The book's own recurring sub-headings, whole line only.
    if (s.length <= 70 && GL_LABEL.test(s.replace(/[.:]$/, ''))) return true;
    // A short, unpunctuated line naming the condition again — "Severe Malaria"
    // sitting above the paragraph that describes how to treat it.
    if (s.length <= 50 && words.length <= 5 && !/[.,;!?]$/.test(s) && /^[A-Z]/.test(s)) {
      var tw = glTopicWords(topic), low = s.toLowerCase();
      for (var k = 0; k < tw.length; k++) if (low.indexOf(tw[k]) >= 0) return true;
    }
    return false;
  }

  // Split into clean lines, dropping furniture and stitching the PDF's
  // mid-sentence breaks back into whole sentences.
  function glLines(text) {
    var kept = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (ln) {
      var s = ln.replace(/ /g, ' ')
                .replace(/Uganda Clinical Guidelines\s*\d{4}/gi, '')
                .trim();
      if (!s) return;
      for (var i = 0; i < GL_DROP.length; i++) if (GL_DROP[i].test(s)) return;
      kept.push(s);
    });

    var out = [];
    kept.forEach(function (s) {
      var prev = out.length ? out[out.length - 1] : null;
      // Only ever join a line that plainly continues the one before it: the
      // previous line stopped without punctuation and this one opens in
      // lower case. A bullet or a shouted heading always starts fresh.
      var joins = prev &&
        !GL_BULLET.test(s) && !glShout(s) &&
        !/[.:;!?]$/.test(prev) && !glShout(prev) &&
        /^[a-z0-9(,;]/.test(s);
      if (joins) {
        out[out.length - 1] = /[a-z]-$/.test(prev) ? prev.slice(0, -1) + s : prev + ' ' + s;
      } else {
        out.push(s);
      }
    });
    return out;
  }

  function glHtml(text, topic) {
    var lines = glLines(text);
    if (!lines.length) return '';
    var html = '', inList = false;
    function endList() { if (inList) { html += '</ul>'; inList = false; } }

    lines.forEach(function (s, idx) {
      var b = s.match(GL_BULLET);
      if (b) {
        if (!inList) { html += '<ul class="gl-ul">'; inList = true; }
        html += '<li>' + esc(s.slice(b[0].length).trim()) + '</li>';
        return;
      }
      endList();
      if (GL_WARN.test(s)) {
        html += '<div class="gl-warn"><span class="material-icons-outlined">error_outline</span>' +
                '<span>' + esc(s) + '</span></div>';
        return;
      }
      if (glIsHeading(s, topic)) {
        html += '<h6 class="gl-h">' + esc(s.replace(/:$/, '')) + '</h6>';
        return;
      }
      // The book's own heading ran across a page break, so the section opens
      // with its tail ("of Malaria"). Keep it — nothing clinical is ever
      // thrown away — but show it for what it is rather than as a sentence.
      if (idx === 0 && /^[a-z]/.test(s)) {
        html += '<p class="gl-frag">…' + esc(s) + '</p>';
        return;
      }
      html += '<p class="gl-p">' + esc(s) + '</p>';
    });
    endList();
    return html;
  }

  // Collapsible guideline detail: management, what else to check, what it could
  // be if you're not certain, complications, and the raw source text.
  function guidanceHtml() {
    var i = ctx.info || {};
    function d(title, body, icon) {
      if (!body || !String(body).trim()) return '';
      var inner = glHtml(body, ctx.title);
      if (!inner) return '';
      return '<details class="ucg-det"><summary>' +
        '<span class="material-icons-outlined">' + icon + '</span>' + esc(title) +
        '<span class="material-icons-outlined chev">expand_more</span></summary>' +
        '<div class="ucg-det-b">' + inner + '</div></details>';
    }
    var html =
      d('Management (guideline)', i.management, 'medical_information') +
      d('What to look for — clinical features', i.clinical_features, 'visibility') +
      d('If you are not certain — other possibilities', i.differential, 'help_outline') +
      d('Investigations — what the guideline says', i.investigations, 'biotech') +
      d('Complications to watch for', i.complications, 'warning_amber') +
      d('Causes / risk factors', i.causes, 'coronavirus') +
      d('Prevention & advice for the patient', i.prevention, 'health_and_safety') +
      // "Full guideline text (source)" used to sit here. It was the same page
      // over again — every one of the panels above is cut from it — so it only
      // made the section long enough to hide the parts that matter.
      d('Notes & cautions', i.notes, 'sticky_note_2');
    return html || '<div style="font-size:12.5px;color:var(--text-lt)">No extra guideline detail for this section.</div>';
  }

  function recalc() {
    var t = (Number(pkg.fees.consult) || 0) + (Number(pkg.fees.lab) || 0) + (Number(pkg.fees.meds) || 0);
    var el = document.getElementById('ucgTotal');
    if (el) el.textContent = 'UGX ' + t.toLocaleString('en-UG');
  }

  function wireRows() {
    var body = document.getElementById('ucgBody');
    body.querySelectorAll('[data-rmtest]').forEach(function (b) {
      b.onclick = function () { pkg.tests.splice(Number(b.dataset.rmtest), 1); render(); };
    });
    body.querySelectorAll('[data-rmdrug]').forEach(function (b) {
      b.onclick = function () { pkg.drugs.splice(Number(b.dataset.rmdrug), 1); render(); };
    });
    // Tapping the tick is what decides a medicine is actually being given —
    // and so what gets prescribed and taken off the shelf.
    body.querySelectorAll('[data-tick]').forEach(function (b) {
      b.onclick = function () {
        var d = pkg.drugs[Number(b.dataset.tick)];
        if (!d) return;
        d.selected = !d.selected;
        render();
      };
    });
    body.querySelectorAll('[data-fd]').forEach(function (inp) {
      inp.onchange = function () {
        var d = pkg.drugs[Number(inp.dataset.fd)];
        d.timesPerDay = Math.max(1, Number(inp.value) || 1);
        // How often it is taken does not change how many BOTTLES leave the
        // shelf — only how many tablets do.
        if (!isWholeContainer(d)) d.qty = d.timesPerDay * (d.durationDays || 1);
        render();
      };
    });
    body.querySelectorAll('[data-dd]').forEach(function (inp) {
      inp.onchange = function () {
        var d = pkg.drugs[Number(inp.dataset.dd)];
        d.durationDays = Math.max(1, Number(inp.value) || 1);
        if (!isWholeContainer(d)) d.qty = (d.timesPerDay || 1) * d.durationDays;
        render();
      };
    });
    body.querySelectorAll('[data-qt]').forEach(function (inp) {
      inp.onchange = function () { pkg.drugs[Number(inp.dataset.qt)].qty = Math.max(0, Number(inp.value) || 0); };
    });
    ['C:consult', 'L:lab', 'M:meds'].forEach(function (pair) {
      var p = pair.split(':'), el = document.getElementById('ucgFee' + p[0]);
      if (el) el.oninput = function () { pkg.fees[p[1]] = Math.max(0, Number(el.value) || 0); recalc(); };
    });
    // Payment chips — pick how the visit was settled without leaving the panel.
    var payHint = document.getElementById('ucgPayHint');
    function paintPay() {
      var opt = null;
      PAY_OPTS.forEach(function (o) { if (o.k === pkg.paymentStatus) opt = o; });
      body.querySelectorAll('[data-pay]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.pay === pkg.paymentStatus);
      });
      if (payHint) payHint.textContent = opt ? opt.hint : '';
    }
    body.querySelectorAll('[data-pay]').forEach(function (b) {
      b.onclick = function () { pkg.paymentStatus = b.dataset.pay; paintPay(); };
    });
    paintPay();

    var fu = document.getElementById('ucgFollow');
    if (fu) fu.onchange = function () { pkg.followUpDays = Math.max(0, Number(fu.value) || 0); };

    var addT = document.getElementById('ucgAddTest');
    if (addT) addT.onclick = function () {
      var name = window.prompt ? null : null;      // prompt() is blocked in WebViews
      openInlineAdd('test');
    };
    var addC = document.getElementById('ucgAddCond');
    if (addC) addC.onclick = function () {
      // Apply what is on screen first, otherwise stepping on to the next
      // condition silently threw this one's medicines away.
      applyToWizard();
      close();
      toast('Type the next condition, then tap the package button again', 'info');
      if (typeof window._wizStartAnotherCondition === 'function') {
        window._wizStartAnotherCondition();
      } else {
        var dx = document.getElementById('confirmedDx');
        if (dx) { dx.focus(); dx.select && dx.select(); }
      }
    };
    // One tap adds a common fluid, straight into Drips, fluids & blood.
    document.querySelectorAll('[data-qf]').forEach(function (b) {
      b.onclick = function () {
        var f = QUICK_FLUIDS[Number(b.dataset.qf)];
        if (!f) return;
        var already = pkg.drugs.some(function (d) {
          return String(d.drug || '').toLowerCase() === f.name.toLowerCase();
        });
        if (already) { toast(f.label + ' is already on this treatment', 'info'); return; }
        pkg.drugs.push({
          drug: f.name, dosage: '', from: 'added',
          group: 'fluid', selected: true,
          timesPerDay: 1, durationDays: 1, qty: 1,
        });
        normaliseGivenHere(pkg);
        render();
      };
    });
    wireDrugSearch();
  }

  // Inline "add a test" (no window.prompt — blocked in Android WebViews)
  // Every lab test name this clinic could reasonably mean: the tests the
  // consultation form already offers, plus any the clinic added itself. Read
  // from the page and from local storage, so suggestions work with no network.
  function labTestNames() {
    var out = [], seen = {};
    function add(n) {
      n = String(n || '').trim();
      if (!n) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1; out.push(n);
    }
    try {
      document.querySelectorAll('[data-lab]').forEach(function (c) { add(c.dataset.lab); });
    } catch (e) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf('custom_labs_') !== 0) continue;
        var list = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(list)) list.forEach(add);
      }
    } catch (e) {}
    return out;
  }

  function openInlineAdd(kind) {
    var host = document.getElementById('ucgTests');
    if (!host || host.querySelector('.ucg-inline')) return;
    var wrap = document.createElement('div');
    wrap.className = 'ucg-inline';
    wrap.style.cssText = 'margin-top:8px';
    wrap.innerHTML =
      '<div style="display:flex;gap:7px">' +
        '<input id="ucgNewTest" placeholder="Type a test — e.g. mal…" autocomplete="off" ' +
          'style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;background:var(--surface);color:var(--text)">' +
        '<button class="ucg-add" id="ucgNewTestOk">Add</button>' +
      '</div>' +
      '<div id="ucgTestRes"></div>';
    host.appendChild(wrap);
    var inp = document.getElementById('ucgNewTest');
    var box = document.getElementById('ucgTestRes');
    var names = labTestNames();
    inp.focus();

    function commit(v) {
      v = (v == null ? (inp.value || '') : v).trim();
      if (v) { pkg.tests.push(v); render(); } else { wrap.remove(); }
    }

    // As-you-type suggestions. Deliberately plain: match anywhere in the name,
    // shortest first, tap to add. No network, no database — instant on a slow
    // phone, and it still accepts anything typed that is not on the list.
    function suggest() {
      var q = (inp.value || '').trim().toLowerCase();
      if (q.length < 1) { box.innerHTML = ''; box.style.display = 'none'; return; }
      var hits = names.filter(function (n) {
        return n.toLowerCase().indexOf(q) >= 0 && pkg.tests.indexOf(n) < 0;
      }).sort(function (a, b) {
        var ap = a.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        var bp = b.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        return ap - bp || a.length - b.length;
      }).slice(0, 8);
      if (!hits.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
      box.innerHTML = hits.map(function (n, i) {
        return '<div data-t="' + i + '"><b>' + esc(n) + '</b></div>';
      }).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-t]').forEach(function (el) {
        el.onclick = function () { commit(hits[Number(el.dataset.t)]); };
      });
    }

    inp.oninput = suggest;
    document.getElementById('ucgNewTestOk').onclick = function () { commit(); };
    inp.onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Enter takes the top suggestion when the box is showing, else the text.
      var top = box.querySelector('[data-t]');
      if (top && box.style.display !== 'none') top.click(); else commit();
    };
    suggest();
  }

  // Drug search: "amo" → Amoxicillin 250 mg / 500 mg → tap → dosage popup
  // The medicine rows now carry a stock note, so the search sits lower down the
  // sheet. Bring its results into view rather than leaving them below the fold.
  function revealSearch(box) {
    try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }

  function wireDrugSearch() {
    var inp = document.getElementById('ucgDrugSearch');
    var box = document.getElementById('ucgSearchRes');
    if (!inp || !box) return;
    var t;
    inp.oninput = function () {
      clearTimeout(t);
      var q = inp.value.trim();
      if (q.length < 2) { box.style.display = 'none'; return; }
      t = setTimeout(async function () {
        // 1) The national formulary (EMHSLU 2023) — official name, form,
        //    strength, facility level and VEN class.
        var found = [];
        try {
          await openEm();
          found = emRows(
            'SELECT name, dosage_form, strength, level_of_care, ven_class ' +
            'FROM emhslu_items WHERE item_type=\'medicine\' AND name LIKE ? ' +
            'ORDER BY length(name), name LIMIT 16', [q + '%']);
          if (!found.length) {
            found = emRows(
              'SELECT name, dosage_form, strength, level_of_care, ven_class ' +
              'FROM emhslu_items WHERE item_type=\'medicine\' AND name LIKE ? ' +
              'ORDER BY length(name), name LIMIT 16', ['%' + q + '%']);
          }
          found = found.map(function (r) {
            return { name: r.name, dose: r.strength || '', unit: '', route: '',
                     frequency: '', duration: '', form: r.dosage_form || '',
                     level: r.level_of_care, ven: r.ven_class, src: 'EMHSLU' };
          });
        } catch (e) { found = []; }
        // 2) Fall back to the doses mentioned in the clinical guideline.
        if (!found.length) {
          found = rows(
            'SELECT DISTINCT name, dose, unit, route, frequency, duration FROM medicines ' +
            'WHERE name LIKE ? ORDER BY length(name) LIMIT 14', [q + '%']);
        }
        if (!found.length) {
          found = rows('SELECT DISTINCT name, dose, unit, route, frequency, duration FROM medicines ' +
            'WHERE name LIKE ? ORDER BY length(name) LIMIT 14', ['%' + q + '%']);
        }
        if (!found.length) {
          box.innerHTML = '<div style="color:var(--text-lt)">No match — “' + esc(q) +
            '” will be added as typed.<br><b>Tap to add</b></div>';
          box.style.display = 'block'; revealSearch(box);
          box.firstChild.onclick = function () { askDosage({ name: q, dose: '', unit: '' }); };
          return;
        }
        var lvl = myLevel();
        box.innerHTML = found.map(function (m, i) {
          var venTxt = { V: 'Vital', E: 'Essential', N: 'Necessary' }[m.ven] || '';
          var above = lvl && m.level && LEVELS.indexOf(m.level) > LEVELS.indexOf(lvl);
          return '<div data-i="' + i + '"><b>' + esc(m.name) + '</b>' +
            (m.dose ? ' <span style="color:#0E7C5A;font-weight:700">' + esc(m.dose + (m.unit || '')) + '</span>' : '') +
            (m.form ? ' <span style="color:var(--text-lt);font-size:11.5px">' + esc(m.form) + '</span>' : '') +
            (m.route ? ' <span style="color:var(--text-lt);font-size:11.5px">' + esc(m.route) + '</span>' : '') +
            (m.level ? '<span class="em-tag' + (above ? ' warn' : '') + '">' + esc(m.level) + '</span>' : '') +
            (venTxt ? '<span class="em-tag ven-' + esc(m.ven) + '" title="' + venTxt + '">' + esc(m.ven) + '</span>' : '') +
            (m.src ? '<span class="em-src">EMHSLU</span>' : '') +
            '</div>';
        }).join('');
        box.style.display = 'block'; revealSearch(box);
        box.querySelectorAll('[data-i]').forEach(function (el) {
          el.onclick = function () { askDosage(found[Number(el.dataset.i)]); };
        });
      }, 130);
    };
  }

  // Small popup asking the dosage, pre-filled from the guideline, editable.
  function askDosage(m) {
    var box = document.getElementById('ucgSearchRes');
    if (box) box.style.display = 'none';
    var tpd = freqPerDay(m.frequency), dd = durDays(m.duration);
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent = m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : '');
    document.getElementById('ucgAskText').textContent = 'How should this be taken?';
    document.getElementById('ucgAskDiff').innerHTML =
      '<div style="display:flex;gap:10px;align-items:end">' +
        '<div><span class="ucg-lbl">Times/day</span><input class="ucg-num" id="dqF" type="number" min="1" max="6" value="' + tpd + '"></div>' +
        '<div><span class="ucg-lbl">Days</span><input class="ucg-num" id="dqD" type="number" min="1" max="90" value="' + dd + '"></div>' +
        '<div><span class="ucg-lbl">Quantity</span><input class="ucg-num" id="dqQ" type="number" min="0" value="' + (tpd * dd) + '"></div>' +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--text-lt);margin-top:8px">e.g. 3 × daily for 5 days = 15 units</div>';
    document.getElementById('ucgAskYes').textContent = 'Add drug';
    ask.style.display = 'flex';
    var f = document.getElementById('dqF'), d = document.getElementById('dqD'), q = document.getElementById('dqQ');
    function sync() { q.value = (Number(f.value) || 1) * (Number(d.value) || 1); }
    f.onchange = sync; d.onchange = sync;
    document.getElementById('ucgAskNo').onclick = function () { ask.style.display = 'none'; };
    document.getElementById('ucgAskYes').onclick = function () {
      pkg.drugs.push({
        drug: m.name + (m.dose ? ' ' + m.dose + (m.unit || '') : ''),
        dosage: (m.dose ? m.dose + (m.unit || '') : '') +
                (m.form ? ' ' + m.form : '') + (m.route ? ' ' + m.route : ''),
        timesPerDay: Number(f.value) || 2,
        durationDays: Number(d.value) || 5,
        qty: Number(q.value) || 0,
        from: 'added',
        // A drug the clinician went and searched for is one they mean to give —
        // but WHAT it is decides where it belongs. This was hard-coded to
        // "treatment", so searching Dextrose filed a drip under Treatment and
        // then dosed it like a tablet.
        group: medGroup(m.name, '', ''),
        selected: true,
      });
      // A drip added by hand is still hung, not taken home.
      normaliseGivenHere(pkg);
      ask.style.display = 'none';
      render();
    };
  }

  // ── Open the package ─────────────────────────────────────────────────────
  async function open(condId, title, severity, page) {
    ensurePanel();
    ctx = { conditionId: condId, title: title, severity: severity, page: page, learned: false, info: null };
    var ov = document.getElementById('ucgOverlay');
    document.getElementById('ucgTitle').textContent = title;
    document.getElementById('ucgBody').innerHTML =
      '<div style="padding:30px;text-align:center;color:var(--text-lt);font-size:13px">Loading the standard package…</div>';
    ov.style.display = 'flex';

    try { await openDb(); } catch (e) {
      document.getElementById('ucgBody').innerHTML =
        '<div style="padding:24px;text-align:center;color:#C62828;font-size:13px">Could not open the guideline database: ' +
        esc(e.message) + '</div>';
      return;
    }

    // A parent heading (e.g. "Malaria") often carries no drugs — the real
    // packages live in its subsections ("Uncomplicated Malaria", "Severe
    // Malaria"). Offer those instead of an empty package.
    // Not in the guidelines at all → open a blank worksheet the clinician fills
    // in (and can save as a clinic standard for next time).
    if (!condId) {
      pkg = { tests: [], drugs: [], fees: { consult: 0, lab: 0, meds: 0 }, paymentStatus: 'pending', followUpDays: 7, page: null, title: title };
      srcPkg = JSON.parse(JSON.stringify(pkg));
      document.getElementById('ucgKicker').textContent = 'New package · not in the guidelines';
      document.getElementById('ucgTags').innerHTML =
        (severity ? '<span class="ucg-tag" style="text-transform:capitalize">' + esc(severity) + '</span>' : '') +
        '<span class="ucg-tag learn">build your own</span>';
      render();
      return;
    }

    var self = rows('SELECT number FROM conditions WHERE id=? LIMIT 1', [condId])[0];
    var ownDrugs = rows('SELECT COUNT(*) n FROM medicines WHERE condition_id=?', [condId])[0];
    if (self && (!ownDrugs || !ownDrugs.n) && !getLearned(condId, severity)) {
      var kids = rows(
        'SELECT c.id,c.title,c.page,(SELECT COUNT(*) FROM medicines m WHERE m.condition_id=c.id) n ' +
        'FROM conditions c WHERE c.number LIKE ? AND c.id<>? ORDER BY c.number LIMIT 8',
        [self.number + '.%', condId])
        .filter(function (k) { return k.n > 0 || carriesTreatment(k); })
        .map(function (k) {
          return Object.assign({}, k, { tests: extractTests(
            (rows('SELECT investigations FROM conditions WHERE id=? LIMIT 1', [k.id])[0] || {}).investigations, '').length });
        })
        .sort(function (a, b) { return (b.n - a.n) || (b.tests - a.tests); });
      if (kids.length === 1) { open(kids[0].id, kids[0].title, severity, kids[0].page); return; }
      if (kids.length) { pickFrom(kids, title, severity); return; }
    }

    // The treatment for this condition may be printed on a relative's page.
    // Use it, under the name the clinician chose, and say so plainly.
    ctx.borrowedFrom = null;
    var borrowed = borrowSource({ id: condId });
    if (borrowed && !getLearned(condId, severity)) {
      ctx.borrowedFrom = borrowed;
      ctx.sourceId = borrowed.id;
    }

    var learned = getLearned(condId, severity);
    if (learned && condId) {
      // load the guideline detail for the notes block even when using a learned package
      try {
        var gi = rows('SELECT causes,clinical_features,differential,investigations,management,' +
          'complications,prevention,notes,full_text FROM conditions WHERE id=? LIMIT 1', [condId])[0];
        if (gi) ctx.info = gi;
      } catch (e) {}
    }
    if (learned) {
      ctx.learned = true;
      pkg = {
        tests: learned.tests.slice(),
        // A saved clinic standard IS what this clinic gives, so it arrives
        // ticked — that is the point of having learned it.
        drugs: learned.drugs.map(function (d) {
          return Object.assign({ group: 'treatment' }, d, { from: 'learned', selected: true });
        }),
        fees: Object.assign({ consult: 0, lab: 0, meds: 0 }, learned.fees),
        followUpDays: learned.followUpDays || 7,
        page: page, title: title,
      };
    } else {
      pkg = buildFromGuideline(ctx.sourceId || condId, severity) ||
        { tests: [], drugs: [], fees: { consult: 0, lab: 0, meds: 0 }, paymentStatus: 'pending', followUpDays: 7, page: page, title: title };
    }
    normaliseGivenHere(pkg);
    srcPkg = JSON.parse(JSON.stringify(pkg));
    ctx.page = pkg.page || page;

    document.getElementById('ucgKicker').textContent =
      ctx.learned ? 'Your clinic standard' : 'Standard package · UCG 2023';
    document.getElementById('ucgTags').innerHTML =
      (severity ? '<span class="ucg-tag" style="text-transform:capitalize">' + esc(severity) + '</span>' : '') +
      (ctx.page ? '<span class="ucg-tag">UCG p.' + esc(ctx.page) + '</span>' : '') +
      (ctx.learned ? '<span class="ucg-tag learn">learned · used ' + (learned.uses || 1) + '×</span>' : '');
    render();
  }

  // Chooser: several guideline sections match — let the clinician pick.
  function pickFrom(list, term, severity) {
    ensurePanel();
    close();
    var ask = document.getElementById('ucgAsk');
    document.getElementById('ucgAskTitle').textContent = 'Which one?';
    document.getElementById('ucgAskText').textContent =
      'Sections under “' + term + '” that carry a treatment package';
    document.getElementById('ucgAskDiff').innerHTML = list.map(function (h, i) {
      // Say what is in each one, so the choice can be made without opening
      // them all to find out.
      var what = [];
      if (h.n)     what.push(h.n + ' medicine' + (h.n !== 1 ? 's' : ''));
      if (h.tests) what.push(h.tests + ' lab test' + (h.tests !== 1 ? 's' : ''));
      if (h.from)  what.push('from the ' + esc(h.from) + ' page');
      return '<div data-h="' + i + '" style="cursor:pointer;padding:11px 4px;border-bottom:1px solid var(--border)">' +
        '<div style="font-weight:700;line-height:1.35">' + esc(h.title) + '</div>' +
        (what.length ? '<div style="font-size:11.5px;font-weight:600;color:var(--text-lt);margin-top:2px">' +
          what.join(' · ') + '</div>' : '') +
        '</div>';
    }).join('');
    document.getElementById('ucgAskYes').style.display = 'none';
    document.getElementById('ucgAskNo').textContent = 'Cancel';
    ask.style.display = 'flex';
    document.getElementById('ucgAskNo').onclick = function () {
      ask.style.display = 'none';
      document.getElementById('ucgAskYes').style.display = '';
      document.getElementById('ucgAskNo').textContent = 'Not now';
    };
    document.getElementById('ucgAskDiff').querySelectorAll('[data-h]').forEach(function (el) {
      el.onclick = function () {
        var h = list[Number(el.dataset.h)];
        ask.style.display = 'none';
        document.getElementById('ucgAskYes').style.display = '';
        document.getElementById('ucgAskNo').textContent = 'Not now';
        open(h.id, h.title, severity, h.page);
      };
    });
  }

  // ── Apply to the consultation (+ ask before learning) ────────────────────
  function changeSummary() {
    var out = [];
    var a = srcPkg, b = pkg;
    a.tests.forEach(function (t) { if (b.tests.indexOf(t) < 0) out.push('− test: ' + t); });
    b.tests.forEach(function (t) { if (a.tests.indexOf(t) < 0) out.push('+ test: ' + t); });
    var an = a.drugs.map(function (d) { return d.drug; });
    var bn = b.drugs.map(function (d) { return d.drug; });
    an.forEach(function (n) { if (bn.indexOf(n) < 0) out.push('− drug: ' + n); });
    bn.forEach(function (n) { if (an.indexOf(n) < 0) out.push('+ drug: ' + n); });
    b.drugs.forEach(function (d) {
      var o = a.drugs.find(function (x) { return x.drug === d.drug; });
      if (o && (o.timesPerDay !== d.timesPerDay || o.durationDays !== d.durationDays || o.qty !== d.qty)) {
        out.push('~ ' + d.drug + ': ' + d.timesPerDay + '×/day for ' + d.durationDays + 'd (qty ' + d.qty + ')');
      }
    });
    ['consult', 'lab', 'meds'].forEach(function (k) {
      if ((a.fees[k] || 0) !== (b.fees[k] || 0)) out.push('~ ' + k + ' fee: UGX ' + (b.fees[k] || 0).toLocaleString('en-UG'));
    });
    if ((a.followUpDays || 0) !== (b.followUpDays || 0)) out.push('~ return in ' + b.followUpDays + ' days');
    return out;
  }

  // ── Linking a package drug to what is actually on the shelf ───────────────
  // The package names a medicine the way the guideline writes it ("Artemether/
  // Lumefantrine 20/120mg"); the shelf may hold it as "Coartem" or plain
  // "Artemether Lumefantrine". Compare on the bare drug name with strengths,
  // pack words and punctuation stripped, so the two meet.
  function stockKey(s) {
    return String(s || '')
      .toLowerCase()
      // strengths: 500mg, 20/120mg, 250 mg/5ml, 1g, 100000iu, 5mcg
      .replace(/\d+(\.\d+)?\s*\/?\s*(\d+(\.\d+)?)?\s*(mg|mcg|ug|g|ml|l|iu|units?|%)\b/g, ' ')
      .replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syr|syrup|susp|suspension|inj|injection|vial|amp|ampoule|cream|ointment|drops?)\b/g, ' ')
      .replace(/[^a-z]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stockList() {
    if (state && Array.isArray(state.clinicInventory) && state.clinicInventory.length) return state.clinicInventory;
    return window._stockItems || [];
  }

  // Returns the clinic_inventory row for this drug, or null when the clinic has
  // never stocked it. Null is not a failure — the wizard opens a shelf slot for
  // it at save time so the dispensing still shows up (and goes negative).
  function matchStockId(name, dosage) {
    var row = matchStockRow(name, dosage);
    return row ? row.id : null;
  }

  // The guideline lists ALTERNATIVES, not a combined regimen — so say, on each
  // row, whether the clinic actually holds that drug. Anything kept here is
  // treated as dispensed and comes off the shelf.
  function stockNote(d) {
    var it = matchStockRow(d.drug, d.dosage);
    if (it) {
      var q = Number(it.quantity);
      return '<span class="ucg-stk ok">in stock' +
        (isFinite(q) ? ': ' + q + ' ' + esc(it.unit || 'units') : '') + '</span>';
    }
    return '<span class="ucg-stk no">not in your stock — remove if you are not giving it</span>';
  }

  function matchStockRow(name, dosage) {
    var want = stockKey(name);
    if (!want) return null;
    var rows = stockList().filter(function (it) {
      return it && it.id && it.item_type !== 'material' && it.is_active !== false;
    });
    var keys = rows.map(function (it) { return { it: it, k: stockKey(it.item_name) }; });

    var hit = keys.find(function (r) { return r.k && r.k === want; });
    if (hit) return hit.it;

    // "Coartem" on the shelf vs "Coartem 20/120mg" in the package, or the other
    // way round — one name contained in the other, longest word first so a
    // short word like "zinc" cannot swallow an unrelated item.
    hit = keys.filter(function (r) {
      return r.k && want.length >= 4 && r.k.length >= 4 &&
             (r.k.indexOf(want) === 0 || want.indexOf(r.k) === 0);
    }).sort(function (a, b) { return b.k.length - a.k.length; })[0];
    if (hit) return hit.it;

    // Last resort: the strength distinguishes two shelf entries of the same
    // drug (Amoxicillin 250mg vs 500mg) — prefer the one whose name carries it.
    var dose = String(dosage || '').toLowerCase().replace(/\s+/g, '');
    if (dose) {
      hit = keys.find(function (r) {
        return r.k && want.indexOf(r.k) >= 0 &&
               String(r.it.item_name || '').toLowerCase().replace(/\s+/g, '').indexOf(dose) >= 0;
      });
      if (hit) return hit.it;
    }
    return null;
  }

  function applyToWizard() {
    if (!state) return;
    var _cond = String(dxTerm || pkg.title || ctx.title || '').trim();
    // The wizard starts with one blank medicine row — drop it so the package
    // doesn't leave an empty prescription line behind.
    state.medications = (state.medications || []).filter(function (m) {
      return m && String(m.drug || '').trim();
    });
    pkg.tests.forEach(function (t) { if (state.labTests.indexOf(t) < 0) state.labTests.push(t); });
    // Only what the clinician ticked is prescribed — and so only that comes off
    // the shelf. Everything else stays on the panel as reference.
    // Applying the same package twice — easy to do now that a visit can carry
    // several conditions — must not prescribe the same drug twice.
    function _alreadyPrescribed(name) {
      var k = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k) return false;
      return (state.medications || []).some(function (m) {
        return String(m.drug || '').toLowerCase().replace(/\s+/g, ' ').trim() === k;
      });
    }
    // What this condition is being treated with — recorded whether or not the
    // drug was added just now, so re-applying the same package (which adds
    // nothing, because it is already prescribed) still counts as treatment.
    var _wanted = pkg.drugs.filter(function (d) {
      return d.selected && (d.group || 'treatment') !== 'other';
    });
    var _added = _wanted.map(function (d) { return d.drug; });
    _wanted.filter(function (d) {
      return !_alreadyPrescribed(d.drug);
    }).forEach(function (d) {
      var tpd = Math.max(1, Math.min(4, Number(d.timesPerDay) || 2));
      // Give every row real intake times. Leaving these empty meant the
      // consultation could never be sent — the package looked applied, the
      // clinician pressed Send, and nothing was ever recorded.
      var times = (typeof window._wizDefaultTimes === 'function')
        ? window._wizDefaultTimes(tpd)
        : ({ 1: ['08:00'], 2: ['08:00', '20:00'],
             3: ['08:00', '14:00', '20:00'],
             4: ['07:00', '12:00', '17:00', '22:00'] }[tpd] || ['08:00', '20:00']).slice();
      state.medications.push({
        drug: d.drug,
        // A prescription line with no dose cannot be dispensed safely, and the
        // wizard rightly refuses it. Fall back to the strength carried on the
        // drug so the row arrives complete.
        dosage: (d.dosage || d.dose || d.strength || '').toString().trim(),
        timesPerDay: tpd,
        intakeTimes: times,
        durationDays: Number(d.durationDays) > 0 ? Number(d.durationDays) : 5,
        // Link the drug to the clinic's stock so dispensing DEDUCTS it. This
        // was left null, which meant every medicine the package added was
        // filtered out of the stock deduction and never left the shelf on
        // paper. Names are matched loosely (the package may carry the strength
        // in the name, the shelf may not).
        inventoryItemId: matchStockId(d.drug, d.dosage),
        qtyToDeduct: Number(d.qty) || 0,
      });
    });
    // Charges add up across the conditions treated in this visit — two
    // conditions means two sets of tests and two sets of medicines, and the
    // bill has to say so. Kept per condition so re-opening and re-applying the
    // same package replaces its own contribution instead of doubling it.
    // The consultation itself is charged once, however many conditions.
    state.dxFees = (state.dxFees && typeof state.dxFees === 'object') ? state.dxFees : {};
    state.dxFees[(_cond || pkg.title || 'condition').toLowerCase()] = {
      consult: Number(pkg.fees.consult) || 0,
      lab:     Number(pkg.fees.lab) || 0,
      meds:    Number(pkg.fees.meds) || 0,
    };
    var _tot = { consult: 0, lab: 0, meds: 0 };
    Object.keys(state.dxFees).forEach(function (k) {
      var f = state.dxFees[k] || {};
      _tot.consult = Math.max(_tot.consult, Number(f.consult) || 0);
      _tot.lab  += Number(f.lab)  || 0;
      _tot.meds += Number(f.meds) || 0;
    });
    state.feeConsult = _tot.consult;
    state.feeLab = _tot.lab;
    state.feeMeds = _tot.meds;
    // Carry the payment choice through, so saving from the panel settles the
    // money too. "Paid" is what writes the amount into the payments ledger.
    if (pkg.paymentStatus) {
      state.paymentStatus = pkg.paymentStatus;
      // Keep the wizard's own chips in step, so screen 2 shows the same choice.
      document.querySelectorAll('.pay-chip[data-pay]').forEach(function (c) {
        c.classList.toggle('active', c.dataset.pay === pkg.paymentStatus);
      });
    }
    if (pkg.followUpDays) state.followUpDays = pkg.followUpDays;

    // ── Every condition treated on this visit stays in the diagnosis ────────
    //
    // Malaria and typhoid together is the commonest pair in Uganda. Applying
    // the second package adds its medicines to the first one's, so the record
    // MUST name both conditions — otherwise it says the patient had typhoid
    // while dispensing malaria treatment, which is what used to happen: typing
    // the second condition over the first simply erased it.
    //
    // The box is not trusted to remember, because looking up the next condition
    // means typing over it. What is trusted is the treatment: a condition whose
    // medicines or tests are still on this consultation was treated, and belongs
    // in the diagnosis. Remove its treatment and it drops out by itself.
    if (_cond) {
      state.dxApplied = (state.dxApplied && typeof state.dxApplied === 'object') ? state.dxApplied : {};
      state.dxApplied[_cond.toLowerCase()] = {
        name:  _cond,
        drugs: _added.slice(),
        tests: pkg.tests.slice(),
      };
    }
    try {
      if (typeof window._wizSetConditions === 'function') {
        var _meds = (state.medications || []).map(function (m) {
          return String(m.drug || '').toLowerCase().replace(/\s+/g, ' ').trim();
        });
        var _labs = (state.labTests || []).map(function (t) { return String(t).toLowerCase(); });
        var _keep = [];
        Object.keys(state.dxApplied || {}).forEach(function (k) {
          var rec = state.dxApplied[k] || {};
          var alive =
            (rec.drugs || []).some(function (d) {
              return _meds.indexOf(String(d).toLowerCase().replace(/\s+/g, ' ').trim()) >= 0;
            }) ||
            (rec.tests || []).some(function (t) { return _labs.indexOf(String(t).toLowerCase()) >= 0; });
          if (alive) _keep.push(rec.name);
          else delete state.dxApplied[k];      // its treatment was taken off
        });
        // Anything else the clinician wrote by hand stays exactly as written.
        (window._wizConditions() || []).forEach(function (p) {
          if (!_keep.some(function (k) { return k.toLowerCase() === p.toLowerCase(); })) _keep.push(p);
        });
        window._wizSetConditions(_keep);
      }
    } catch (e) {}

    try { if (typeof window._wizRefreshAfterAutofill === 'function') window._wizRefreshAfterAutofill(); } catch (e) {}
  }

  function apply() {
    var changes = changeSummary();
    applyToWizard();
    close();
    // "Package applied" on its own read as "consultation recorded" — it is not,
    // nothing is saved until the consultation is sent. Say what is still needed.
    var _need = 'Not saved yet — press Send at the bottom to record it.';
    var _n = pkg.drugs.filter(function (d) { return d.selected && (d.group || 'treatment') !== 'other'; }).length;
    toast('Package applied (' + _n + ' medicine' + (_n !== 1 ? 's' : '') +
      ', ' + pkg.tests.length + ' test' + (pkg.tests.length !== 1 ? 's' : '') + '). ' + _need, 'success');

    if (!changes.length) return;                 // nothing to learn
    askToLearn(changes, null);   // ASK before changing what auto-fills next time
  }

  // ── Public entry: find the condition for the typed diagnosis, then open ──
  async function start(dxText, severity, wizState) {
    state = wizState || window._wizState || null;
    // With two conditions in the box the whole string is "Malaria + Typhoid",
    // which matches nothing in the book. Look up the last one — the one being
    // added now — whoever called us.
    var term = (dxText || '').split('+').pop().trim();
    if (!term) { toast('Enter the diagnosis first', 'error'); return; }
    dxTerm = term;
    ensurePanel();
    try { await openDb(); } catch (e) { toast('Guideline database unavailable offline yet', 'error'); return; }
    // The national medicines list is what lets the package recover drugs the
    // guideline names but that were never extracted. Not fatal if it is slow.
    try { await openEm(); } catch (e) {}

    var toks = term.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    var hits = [];
    if (toks.length) {
      try {
        hits = rows('SELECT c.id,c.title,c.page FROM conditions_fts f JOIN conditions c ON c.id=f.rowid ' +
          'WHERE conditions_fts MATCH ? ORDER BY rank LIMIT 8',
          [toks.map(function (t) { return '"' + t + '"*'; }).join(' AND ')]);
      } catch (e) { hits = []; }
    }
    if (!hits.length) {
      hits = rows('SELECT id,title,page FROM conditions WHERE title LIKE ? ORDER BY length(title) LIMIT 8', ['%' + term + '%']);
    }
    if (!hits.length && term.length >= 4) {
      // Mistyped, most likely. Search again allowing a slip or two before
      // telling the clinician their condition is not in the book at all.
      var q = term.toLowerCase();
      try {
        hits = rows('SELECT id,title,page FROM conditions ORDER BY length(title) LIMIT 600', [])
          .filter(function (r) { return looksLike(q, r.title); }).slice(0, 8);
      } catch (e) { hits = []; }
      if (hits.length) toast('Showing “' + hits[0].title + '” — did you mean that?', 'info');
    }
    if (!hits.length) {
      // Nothing in the guidelines — still give the clinician a worksheet.
      toast('Not in the guidelines — start a package for “' + term + '”', 'info');
      open(null, term, severity, null);
      return;
    }
    // Only offer sections that actually carry a treatment. Typing "Malaria"
    // used to list seven, four of them empty or holding another disease's text
    // entirely; the clinician had to open each one to find that out.
    hits = hits.map(function (h) {
      // A section whose treatment is printed on a relative's page is offered
      // with THAT page's contents, so the clinician can see what they get.
      var src = borrowSource(h) || h;
      var p = packInfo(src.id);
      return Object.assign({}, h, { n: p.n, from: src.id !== h.id ? src.title : '', tests: extractTests(
        (rows('SELECT investigations FROM conditions WHERE id=? LIMIT 1', [src.id])[0] || {}).investigations, '').length });
    });
    var real = hits.filter(carriesTreatment);
    // Never leave the clinician with nothing: if none of them carries a
    // treatment, offer what there is rather than pretending there is nothing.
    if (real.length) hits = real;
    hits.sort(function (a, b) { return (b.n - a.n) || (b.tests - a.tests) || (a.title.length - b.title.length); });
    if (hits.length === 1) { open(hits[0].id, hits[0].title, severity, hits[0].page); return; }

    pickFrom(hits, term, severity);
  }

  // ── Diagnosis suggestions ────────────────────────────────────────────────
  // Typing the condition should offer it, not make the clinician spell it out.
  // Three sources, cheapest first, so something useful appears on the first
  // keystroke even before the 6 MB guideline database has finished opening:
  //   1. what THIS clinic has diagnosed before (its own learned packages)
  //   2. a short list of the conditions seen most in Ugandan primary care
  //   3. the Uganda Clinical Guidelines themselves, once the database is open
  var COMMON_DX = [
    'Malaria', 'Malaria (uncomplicated)', 'Severe malaria', 'Typhoid fever',
    'Upper respiratory tract infection', 'Pneumonia', 'Bronchitis', 'Asthma',
    'Urinary tract infection', 'Diarrhoea', 'Dysentery', 'Cholera',
    'Intestinal worms', 'Amoebiasis', 'Giardiasis', 'Peptic ulcer disease',
    'Gastritis', 'Anaemia', 'Malnutrition', 'HIV/AIDS', 'Tuberculosis',
    'Sexually transmitted infection', 'Syphilis', 'Gonorrhoea', 'Candidiasis',
    'Pelvic inflammatory disease', 'Hypertension', 'Diabetes mellitus',
    'Epilepsy', 'Otitis media', 'Tonsillitis', 'Conjunctivitis', 'Skin infection',
    'Scabies', 'Ringworm', 'Wound infection', 'Cellulitis', 'Abscess', 'Burns',
    'Arthritis', 'Back pain', 'Headache', 'Migraine', 'Allergic reaction',
    'Measles', 'Chickenpox', 'Mumps', 'Meningitis', 'Hepatitis', 'Snake bite',
    'Antenatal care', 'Malaria prophylaxis', 'Family planning', 'Immunisation',
  ];

  // ── What each section of the book actually carries ────────────────────────
  // Typing "Malaria" was offering seven sections, and four of them had nothing
  // in them: "Malaria" and "Uncomplicated Malaria" carry no medicines and no
  // management text at all, and "Malaria Prophylaxis" and "Malaria Prevention
  // and Control" hold text about tsetse flies and trypanosomes — sleeping
  // sickness, wrongly attached to a malaria heading when the book was
  // extracted. Offering those wastes the clinician's time at best.
  //
  // One query, read once, tells us which sections are worth offering.
  var packIndex = null;
  function packInfo(condId) {
    if (!packIndex) {
      packIndex = {};
      try {
        rows('SELECT c.id AS id, length(coalesce(c.management,\'\')) AS mg, ' +
             'length(coalesce(c.investigations,\'\')) AS inv, ' +
             '(SELECT COUNT(*) FROM medicines m WHERE m.condition_id = c.id) AS n ' +
             'FROM conditions c', [])
          .forEach(function (r) { packIndex[r.id] = { n: r.n || 0, mg: r.mg || 0, inv: r.inv || 0 }; });
      } catch (e) { packIndex = {}; }
    }
    return packIndex[condId] || { n: 0, mg: 0, inv: 0 };
  }

  // Does this section's own prose actually prescribe anything? A dose, or one
  // of the programme abbreviations. This is what keeps "Recommended First Line
  // Regimens" — which lists ARVs only as TDF+3TC+DTG and so has no extracted
  // medicines and almost no management text.
  var dosedCache = {};
  function hasDosedProse(condId) {
    if (dosedCache[condId] !== undefined) return dosedCache[condId];
    var out = false;
    try {
      var c = rows('SELECT management,prevention,notes FROM conditions WHERE id=? LIMIT 1', [condId])[0];
      var prose = c ? [c.management, c.prevention, c.notes].filter(Boolean).join(' ') : '';
      out = DOSE_ON_LINE.test(prose) || MED_ABBREV.some(function (pair) {
        var at = prose.indexOf(pair[0]);
        if (at < 0) return false;
        var before = at > 0 ? prose.charAt(at - 1) : ' ';
        var after = prose.charAt(at + pair[0].length) || ' ';
        return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
      });
    } catch (e) {}
    dosedCache[condId] = out;
    return out;
  }

  // Is this section worth offering? It lists medicines, or it prescribes
  // something in its prose, or it carries real guidance — what to do, or what
  // to investigate. Counting investigations matters: the asthma section holds
  // almost all of its instruction there rather than under management.
  //
  // This is used RELATIVELY, never as a blanket rule. A thin section is only
  // dropped when a better one matched the same search, so a condition can
  // never disappear just because the book is thin on it — "Ectopic Pregnancy"
  // has barely 370 characters and must still be findable.
  function carriesGuidance(condId) {
    var p = packInfo(condId);
    if (p.n > 0 || (p.mg + p.inv) >= 400 || hasDosedProse(condId)) return true;
    // …or its treatment is printed on a relative's page — an ordinary malaria
    // case must be findable even though the book filed its treatment under the
    // severe heading.
    return !!borrowSource({ id: condId });
  }

  // Worth offering as a TREATMENT package, which is what the chooser is for:
  // it must have medicines — from the book's own list, or recovered from its
  // prose — or lab tests backed by real guidance.
  function carriesTreatment(cond) {
    var p = packInfo(cond.id);
    if (p.n > 0) return true;
    if (borrowSource(cond)) return true;
    if (p.inv > 0 && (p.mg + p.inv) >= 400) return true;
    try {
      var c = rows('SELECT management,prevention,notes FROM conditions WHERE id=? LIMIT 1', [cond.id])[0];
      if (!c) return false;
      var prose = [c.management, c.prevention, c.notes].filter(Boolean).join('\n');
      if (!prose.trim()) return false;
      return findMissingDrugs(prose, [], rankMarkers(prose)).length > 0;
    } catch (e) { return false; }
  }

  // ── When the treatment for a condition is printed on another page ─────────
  // The book covers uncomplicated and severe malaria on the same page, and the
  // extractor filed the whole of it — including "All patients: First line
  // medicine Artemether/Lumefantrine" — under "Complicated/Severe Malaria".
  // So the section called "Uncomplicated Malaria" is an empty shell, and a
  // clinician with an ordinary malaria case had nothing to choose.
  //
  // A section may take its package from a relative, but only on evidence, and
  // only between two sections about the same condition:
  //   • the relative prints this section's title as a heading of its own;
  //   • the two titles share the name of the condition;
  //   • neither is a prevention or counselling page — those are not treatment.
  // Across the whole book that is true three times. Everything else is left
  // alone, because borrowing between different conditions would be dangerous:
  // Cushing's must never inherit the treatment for Addison's.
  var BORROW_STOP = ('disease diseases syndrome other general management treatment acute chronic ' +
    'severe infection infections conditions prevention control care pregnancy children child ' +
    'infant infants adults women check counselling problems').split(' ');
  var BORROW_NEVER = /prophylax|prevention|preventive|counsel|immunis|immuniz|vaccin|screening/i;

  function topicWords(t) {
    return String(t || '').toLowerCase().split(/[^a-z]+/).filter(function (w) {
      return w.length >= 5 && BORROW_STOP.indexOf(w) < 0;
    });
  }
  function flatten(s) {
    return String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function printsAsHeading(relId, title) {
    var key = flatten(title);
    if (key.length < 8) return false;
    try {
      var c = rows('SELECT management,notes,prevention FROM conditions WHERE id=? LIMIT 1', [relId])[0];
      if (!c) return false;
      var text = [c.management, c.notes, c.prevention].filter(Boolean).join('\n');
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) if (flatten(lines[i]) === key) return true;
    } catch (e) {}
    return false;
  }

  var borrowCache = {};
  function borrowSource(cond) {
    if (!cond || !cond.id) return null;
    if (borrowCache[cond.id] !== undefined) return borrowCache[cond.id];
    borrowCache[cond.id] = null;
    try {
      if (packInfo(cond.id).n > 0) return null;
      var self = rows('SELECT number,title FROM conditions WHERE id=? LIMIT 1', [cond.id])[0];
      if (!self || !self.number || BORROW_NEVER.test(self.title)) return null;
      var mine = topicWords(self.title);
      if (!mine.length) return null;
      var parent = self.number.indexOf('.') > 0 ? self.number.replace(/\.[^.]+$/, '') : '';
      // the parent, then the siblings, then the children
      var kin = rows(
        'SELECT c.id,c.title,c.page,c.number,(SELECT COUNT(*) FROM medicines m WHERE m.condition_id=c.id) n ' +
        'FROM conditions c WHERE c.id<>? AND (c.number=? OR c.number LIKE ? OR c.number LIKE ?) ' +
        'ORDER BY n DESC LIMIT 40',
        [cond.id, parent, parent ? parent + '.%' : '\u0000', self.number + '.%']);
      for (var i = 0; i < kin.length; i++) {
        var k = kin[i];
        if (!k.n || BORROW_NEVER.test(k.title)) continue;
        if (!printsAsHeading(k.id, self.title)) continue;
        var theirs = topicWords(k.title);
        var shared = mine.some(function (w) { return theirs.indexOf(w) >= 0; });
        if (!shared) continue;
        borrowCache[cond.id] = k;
        return k;
      }
    } catch (e) {}
    return borrowCache[cond.id];
  }

  function learnedTitles() {
    var out = [];
    try {
      var all = allLearned();
      Object.keys(all).forEach(function (k) {
        if (all[k] && all[k].title) out.push({ t: all[k].title, uses: all[k].uses || 0 });
      });
    } catch (e) {}
    return out.sort(function (a, b) { return b.uses - a.uses; }).map(function (x) { return x.t; });
  }

  // ── Typing it slightly wrong ──────────────────────────────────────────────
  // "typiod" found nothing at all, because everything here matched on the exact
  // letters. A clinician typing between patients will drop a letter or swap
  // two, and the app should still know what they mean. This is the standard
  // edit distance, with adjacent swaps counted as one mistake rather than two,
  // because that is the commonest typing slip (typhoid → typiod).
  function editDist(a, b, cap) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > cap) return cap + 1;
    var prev2 = [], prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i];
      var best = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 &&
            a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);       // the two letters were swapped
        }
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > cap) return cap + 1;              // no way back under the budget
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  // How wrong a word is allowed to be: one slip in a short word, more in a long
  // one. Tight enough that "cough" cannot match "cholera".
  function slipBudget(n) { return n <= 3 ? 1 : (n <= 9 ? 2 : 3); }

  // Does any word of this title look like what was typed?
  function looksLike(q, title) {
    var cap = slipBudget(q.length);
    var words = String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3) continue;
      if (editDist(q, w, cap) <= cap) return true;
      // …or it is the start of a longer word, typed with a slip in it.
      if (w.length > q.length && editDist(q, w.slice(0, q.length + cap), cap) <= cap) return true;
    }
    return false;
  }

  function suggestDx(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    var out = [], seen = {};
    function add(title, tag) {
      var t = String(title || '').trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ title: t, tag: tag });
    }
    // The same condition under two spellings is one suggestion, not two:
    // "Malaria (uncomplicated)" from the built-in list and "Uncomplicated
    // Malaria" from the book are the same thing.
    var SMALL = { and: 1, the: 1, of: 1, in: 1, for: 1, with: 1, or: 1, a: 1, an: 1 };
    var byWords = {};
    function wordKey(t) {
      return String(t || '').toLowerCase().split(/[^a-z0-9]+/)
        .filter(function (w) { return w && !SMALL[w]; }).sort().join(' ');
    }
    function addOnce(t, tag) {
      var wk = wordKey(t);
      if (wk && byWords[wk]) return;
      if (wk) byWords[wk] = 1;
      add(t, tag);
    }

    // 1. the clinic's own standards come first — these are its real caseload
    learnedTitles().forEach(function (t) {
      if (t.toLowerCase().indexOf(q) >= 0) addOnce(t, 'your standard');
    });

    // 2. The book itself — but only sections that actually carry something.
    // This is what the clinician will end up opening, so it is what should be
    // offered; the built-in list below is only a fallback for anything the
    // guidelines do not cover.
    var fromBook = 0;
    if (db) {
      try {
        var found = rows('SELECT id,title FROM conditions WHERE title LIKE ? ORDER BY length(title) LIMIT 24',
                         ['%' + q + '%']);
        var strong = found.filter(function (r) { return carriesGuidance(r.id); });
        // Drop the thin sections only when there is something better to offer.
        (strong.length ? strong : found).slice(0, 8)
          .forEach(function (r) { fromBook++; addOnce(r.title, 'UCG 2023'); });
      } catch (e) {}
    }

    // 3. The built-in list of everyday conditions — only when the book gave us
    // nothing, so a clinician is never left with an empty box.
    if (!out.length || !fromBook) {
      COMMON_DX.filter(function (t) { return t.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) {
          var ap = a.toLowerCase().indexOf(q) === 0 ? 0 : 1;
          var bp = b.toLowerCase().indexOf(q) === 0 ? 0 : 1;
          return ap - bp || a.length - b.length;
        }).forEach(function (t) { addOnce(t, ''); });
    }

    // 4. Nothing matched the letters exactly — so it was probably mistyped.
    // Only now, and only for a word long enough to be sure of, so the ordinary
    // case costs nothing.
    if (!out.length && q.length >= 4) {
      COMMON_DX.forEach(function (t) { if (looksLike(q, t)) add(t, 'did you mean?'); });
      learnedTitles().forEach(function (t) { if (looksLike(q, t)) add(t, 'your standard'); });
      if (db) {
        try {
          rows('SELECT title FROM conditions ORDER BY length(title) LIMIT 600', [])
            .forEach(function (r) { if (looksLike(q, r.title)) add(r.title, 'UCG 2023 · did you mean?'); });
        } catch (e) {}
      }
    }
    return out.slice(0, 8);
  }

  function wireDxSuggest() {
    var inp = document.getElementById('confirmedDx');
    if (!inp || inp._ucgWired) return;
    inp._ucgWired = true;

    var box = document.createElement('div');
    box.id = 'ucgDxRes';
    box.style.cssText = 'display:none;margin-top:8px;background:var(--surface,#fff);' +
      'border:1.5px solid var(--brand-tint,#DBF4EA);border-radius:12px;overflow:hidden;' +
      'max-height:270px;overflow-y:auto;box-shadow:var(--shadow,0 6px 18px rgba(20,24,43,.07))';
    inp.parentNode.insertBefore(box, inp.nextSibling);

    // Warm the guideline database the moment the clinician starts typing, so
    // the fuller list is ready a keystroke or two later.
    var warmed = false;
    // Open the guideline database the moment typing starts, and paint the list
    // again once it is in — otherwise the first word a clinician types is
    // answered from the small built-in list, and the real sections of the book
    // only appear if they happen to type another letter.
    function warm() {
      if (warmed) return;
      warmed = true;
      openDb().then(function () {
        if (document.activeElement === inp && String(inp.value || '').trim().length >= 2) paint();
      }).catch(function () {});
    }

    var t, justPicked = false;
    function paint() {
      if (justPicked) { justPicked = false; return; }
      var hits = suggestDx(inp.value);
      if (!hits.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = hits.map(function (h, i) {
        return '<div data-d="' + i + '" style="padding:11px 13px;font-size:14px;cursor:pointer;' +
          'border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px">' +
          '<b style="font-weight:600;color:var(--text)">' + esc(h.title) + '</b>' +
          (h.tag ? '<span style="font-size:10.5px;font-weight:800;color:var(--text-lt);' +
            'letter-spacing:.3px;white-space:nowrap;align-self:center">' + esc(h.tag) + '</span>' : '') +
          '</div>';
      }).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-d]').forEach(function (el) {
        el.onclick = function () {
          inp.value = hits[Number(el.dataset.d)].title;
          // Tell the wizard the value changed, but do NOT let that re-open the
          // list we just picked from.
          justPicked = true;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          clearTimeout(t);
          box.style.display = 'none';
          box.innerHTML = '';
        };
      });
    }

    inp.addEventListener('input', function () {
      warm();
      clearTimeout(t);
      if (justPicked) { justPicked = false; return; }
      t = setTimeout(paint, 110);
    });
    inp.addEventListener('focus', warm);
    document.addEventListener('click', function (e) {
      if (e.target !== inp && !box.contains(e.target)) box.style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireDxSuggest);
  } else {
    wireDxSuggest();
  }

  window.UCGPackage = { start: start, open: open, close: close, suggestDx: suggestDx,
                        formatNotes: glHtml };
})();
