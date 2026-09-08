/* Homatt Health — dictating the history and the vitals
 *
 * A clinician holding a phone in one hand and a cuff in the other should be
 * able to say "temp 38.5, BP 120 over 80, pulse 96, weight 62" and have the
 * four boxes fill in — and to say "complains of fever and headache for two
 * days, no vomiting" and have that land in the complaint and the story.
 *
 * Never a diagnosis and never a medicine. A misheard drug name becomes a
 * prescription, and no recogniser is good enough at "artemether/lumefantrine"
 * to be trusted with that. Those stay a deliberate tap.
 *
 * TWO KINDS OF TEXT, TWO DIFFERENT DANGERS
 * ----------------------------------------
 * The vitals are numbers, and the danger is a number in the wrong box. So a
 * value is taken ONLY when the clinician said what it was — a label ("temp",
 * "pulse") or an unambiguous unit ("kg", "mmHg"). A bare "38.5" fills nothing.
 * Every reading is then range-checked against what a human body can do, and
 * one outside it is REPORTED rather than stored: "I heard 385 for the
 * temperature" is useful; silently writing it is not.
 *
 * The complaint and the story are prose, and the danger is the opposite — not
 * a wrong box but a LOST sentence, because a clinician who dictated "no chest
 * pain" and cannot find it will assume it was recorded. So every word spoken
 * ends up in one box or the other, the complaint is only taken when the
 * clinician marked it, and everything ambiguous goes to the story where it
 * will be read back.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * It cannot tell that a recogniser DROPPED a negation. "no chest pain" heard
 * as "chest pain" reads perfectly well and means the opposite, and it would
 * feed the suggestion engine below. Nothing in this file detects that. The
 * only defence is that the transcript is shown back word for word, and the
 * denials it did hear are listed separately to draw the eye.
 */
(function (global) {
  'use strict';

  // Recognisers write digits most of the time, but not always, and Ugandan
  // clinicians dictating a decimal often say "thirty eight point five".
  var WORD = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
    fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100,
  };

  // Longest first, or the alternation matches "eight" inside "eighty" and
  // leaves a stray "y" behind — which is how "one hundred twenty over eighty"
  // became "120 over 8y" and the blood pressure vanished.
  var WORD_ALT = Object.keys(WORD)
    .sort(function (a, b) { return b.length - a.length; }).join('|');

  // "thirty eight point five" -> "38.5", left alone if it is already digits.
  function digitsFromWords(text) {
    // "38 point 5" — the recogniser wrote the digits but spelled the point.
    var out = String(text || '')
      .replace(/(\d+)\s+point\s+(\d)/gi, '$1.$2');
    var seq = new RegExp(
      '\\b((?:' + WORD_ALT + ')(?:[\\s-]+(?:' + WORD_ALT + '))*)' +
      '(?:\\s+point\\s+((?:' + WORD_ALT + ')(?:\\s+(?:' + WORD_ALT +
      '))*))?', 'gi');
    return out.replace(seq, function (whole, intPart, decPart) {
      var n = valueOf(intPart);
      if (n === null) return whole;
      if (decPart == null) return String(n);
      var digits = decPart.trim().split(/\s+/)
        .map(function (w) { return WORD[w.toLowerCase()]; });
      if (digits.some(function (d) { return d === undefined || d > 9; })) return whole;
      return n + '.' + digits.join('');
    });
  }

  function valueOf(phrase) {
    var words = String(phrase || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
    var total = 0, seen = false, i = 0;
    // Blood pressure is read aloud in hundreds without the word: "one twenty
    // over eighty" is 120/80, not 21/80. Only a single digit followed by a
    // tens word — "one hundred twenty" still takes the ordinary path below.
    if (words.length >= 2) {
      var lead = WORD[words[0]], tens = WORD[words[1]];
      if (lead >= 1 && lead <= 9 && tens >= 10 && tens <= 90 && tens % 10 === 0) {
        total = lead * 100 + tens;
        seen = true;
        i = 2;
      }
    }
    for (; i < words.length; i++) {
      var v = WORD[words[i]];
      if (v === undefined) return null;
      seen = true;
      if (v === 100) total = (total || 1) * 100;
      else if (total && total % 10 === 0 && v < 10) total += v;      // thirty eight
      else if (total && total % 100 === 0 && v < 100) total += v;    // a hundred and twenty
      else total += v;
    }
    return seen ? total : null;
  }

  // What a human body can actually do. A reading outside these is reported
  // back rather than written into the box.
  var RANGE = {
    temp:   [30, 45,  '°C'],
    pulse:  [20, 250, '/min'],
    weight: [0.5, 300, 'kg'],
    sbp:    [50, 300, 'mmHg'],
    dbp:    [20, 200, 'mmHg'],
  };

  // The label has to be spoken. Order does not matter; the clinician may say
  // them in any order, or only some of them.
  var LABEL = [
    ['temp',   /\b(?:temp(?:erature)?|fever)\b[^0-9]{0,14}(\d{1,3}(?:\.\d{1,2})?)/i],
    ['pulse',  /\b(?:pulse|heart\s*rate|h\.?r\.?|beats?)\b[^0-9]{0,14}(\d{1,3})/i],
    ['weight', /\b(?:weigh(?:s|t|ing)?|mass)\b[^0-9]{0,14}(\d{1,3}(?:\.\d{1,2})?)/i],
  ];

  // Blood pressure, however it is said: "120 over 80", "120 on 80", "120/80",
  // "BP 120 80". Both numbers together or not at all — half a blood pressure
  // is not a blood pressure.
  var BP = [
    /\b(?:b\.?p\.?|blood\s*pressure)\b[^0-9]{0,14}(\d{2,3})\s*(?:\/|over|on|by)\s*(\d{2,3})/i,
    /\b(\d{2,3})\s*(?:\/|\s+over\s+|\s+on\s+)\s*(\d{2,3})\s*(?:mm\s?hg)?\b/i,
  ];

  // A unit says what the number is even when the label was not spoken:
  // "62 kilos", "38.5 degrees", "96 beats per minute".
  var UNIT = [
    ['weight', /(\d{1,3}(?:\.\d{1,2})?)\s*(?:kg|kgs|kilo(?:gram)?s?)\b/i],
    ['temp',   /(\d{2,3}(?:\.\d{1,2})?)\s*(?:°\s*c|degrees?(?:\s+c(?:elsius)?)?|celsius)\b/i],
    ['pulse',  /(\d{1,3})\s*(?:bpm|beats?(?:\s+per\s+minute)?)\b/i],
  ];

  function inRange(k, v) {
    var r = RANGE[k];
    return !!r && v >= r[0] && v <= r[1];
  }

  /**
   * Read the vitals out of a sentence.
   *
   * Returns { vitals, heard, ignored }:
   *   vitals  — only the readings that were both labelled and plausible
   *   heard   — a plain-English line per reading taken, to show the clinician
   *   ignored — labelled readings that failed the range check, and why
   */
  function parseVitals(spoken) {
    var text = digitsFromWords(String(spoken || ''));
    var vitals = {}, heard = [], ignored = [];

    function take(key, raw) {
      if (vitals[key] !== undefined) return;             // first mention wins
      var v = parseFloat(raw);
      if (!isFinite(v)) return;
      if (!inRange(key, v)) {
        if (!ignored.some(function (g) { return g.key === key && g.value === v; })) {
          ignored.push({ key: key, value: v,
                         why: 'outside ' + RANGE[key][0] + '–' + RANGE[key][1] +
                              ' ' + RANGE[key][2] });
        }
        return;
      }
      vitals[key] = String(v);
      heard.push(LABELS[key] + ' ' + v + ' ' + RANGE[key][2]);
    }

    for (var i = 0; i < BP.length; i++) {
      var b = BP[i].exec(text);
      if (b) {
        var s = parseFloat(b[1]), d = parseFloat(b[2]);
        // Systolic is the higher of the two; said the other way round it is
        // still a blood pressure, but a systolic under the diastolic is not.
        if (inRange('sbp', s) && inRange('dbp', d) && s > d) {
          vitals.sbp = String(s); vitals.dbp = String(d);
          heard.push('Blood pressure ' + s + '/' + d + ' mmHg');
        } else {
          ignored.push({ key: 'bp', value: b[1] + '/' + b[2],
                         why: 'not a possible blood pressure' });
        }
        break;
      }
    }

    LABEL.forEach(function (p) {
      var m = p[1].exec(text);
      if (m) take(p[0], m[1]);
    });
    UNIT.forEach(function (p) {
      var m = p[1].exec(text);
      if (m) take(p[0], m[1]);
    });

    return { vitals: vitals, heard: heard, ignored: ignored };
  }

  var LABELS = {
    temp: 'Temperature', pulse: 'Pulse', weight: 'Weight',
    sbp: 'Systolic', dbp: 'Diastolic',
  };

  // ── Who the patient is ───────────────────────────────────────────────────
  // Sex and age are patterned enough to read with rules. A NAME is not: Ugandan
  // names are in no dictionary, and no rule can tell "Jackline Marcy came in
  // with fever" from a place or a symptom. So a name is taken ONLY when the
  // clinician marked it — "her name is", "the patient is", "called" — and
  // anything less certain is left for the model pass, which can be wrong
  // without being dangerous because the box is right there to correct.

  // Sex, said outright. Relationship words are deliberately absent: "the mother
  // says he is not feeding" is a male patient described by a female informant,
  // and reading "mother" as the patient's sex would be wrong every time a
  // parent brought a child in.
  var SEX_WORD = [
    ['female', /\b(?:female|woman|lady|girl|f\/(?:\d)|is a female)\b/i],
    ['male',   /\b(?:male|man|gentleman|boy|m\/(?:\d)|is a male)\b/i],
  ];
  var SHE = /\b(?:she|her|hers|herself)\b/gi;
  var HE  = /\b(?:he|him|his|himself)\b/gi;

  // "32 years old", "a 32-year-old", "aged 32", "3 months old".
  var AGE_Y = /\b(?:aged\s+)?(\d{1,3})\s*[-\s]?\s*(?:year|yr)s?\b(?:[\s-]*old)?/i;
  var AGE_M = /\b(\d{1,3})\s*[-\s]?\s*(?:month|mo)s?\b[\s-]*old\b/i;
  // Months without "old" — "a baby of six months", "she is 8 months". Only
  // when a person word introduces it, because "cough for 6 months" is a
  // duration and putting that in the age box would be a lie about a child.
  var AGE_M2 = /\b(?:baby|infant|child|toddler|aged?|she\s+is|he\s+is|is)\s+(?:of\s+)?(\d{1,3})\s*months?\b/i;
  var AGE_BARE = /\baged\s+(\d{1,3})\b/i;
  // A bare number that a person is said to BE. "he is 52", "she's 27",
  // "the age is 45", "a young man of 22", "his age is 28". Never a bare number
  // on its own — that is how a temperature becomes an age.
  var AGE_SAID = new RegExp(
    '\\b(?:' + [
      '(?:the\\s+)?age\\s+(?:is|of)',
      '(?:his|her|their)\\s+age\\s+(?:is)?',
      "(?:he|she|they|patient|client|pt)\\s*(?:'s|s)?\\s+(?:is\\s+)?(?:age(?:d)?\\s+)?",
      '(?:man|woman|lady|gentleman|boy|girl|child|baby|person|patient)\\s+of',
    ].join('|') + ')\\s*(\\d{1,3})\\b(?!\\s*(?:%|kg|kilo|mm|degree|celsius|c\\b|/))', 'i');

  // How a name is actually announced. "name is" alone missed the commonest
  // opening of all — "Name of the person is Emmanuel Opal" — because of the
  // three words in the middle, so the possessive part is a slot rather than a
  // fixed phrase. Ordered longest-first so "this patient is called X" does not
  // match "patient is" and take "called X" as the name.
  var NAME_CUE = new RegExp(
    '\\b(?:' + [
      // name of the person / of the patient / of this lady …
      'name\\s+of\\s+(?:the|this)\\s+[a-z]+\\s+is',
      "(?:the\\s+)?(?:her|his|their|patient'?s?|client'?s?)\\s+name\\s+(?:is|was)",
      'name\\s+(?:is|was)',
      'patient\\s+name',            // "Patient name Okello John" — no verb at all
      'go(?:es)?\\s+by',
      'named',
      'called',
      '(?:we|i)\\s+have',           // "We have Mukasa Peter here"
      "(?:am|i\\s*am|i'm)\\s+(?:seeing|attending\\s+to|with)",
      'this\\s+is',
      'patient\\s+is',
    ].join('|') + ')\\s+([A-Za-z][A-Za-z\'’-]+(?:\\s+[A-Za-z][A-Za-z\'’-]+){0,2})', 'i');

  // Cue words that can end up glued to the front of a captured name when two
  // cues overlap ("this patient is called Grace"). Stripped rather than
  // rejected — the name after them is still a name.
  var NAME_LEAD = /^(?:called|named|is|was|a|an|the|here|with|and|spelt|spelled|spelling)\s+/i;
  // …and not the word that happened to follow it. "We have Mukasa Peter here"
  // is a name plus a place-holder; the place-holder is not part of anybody's
  // name.
  var NAME_TAIL = /\s+(?:here|there|now|today|please|again|yeah|ok|okay|and|who|she|he|they|with|is|was|has|aged?)$/i;

  function titleCase(s) {
    return String(s || '').trim().split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  // Words that follow a name cue but are plainly not a name.
  var NOT_A_NAME = /^(?:a|an|the|complaining|complains|complained|here|with|for|not|and|his|her|male|female|man|woman|lady|gentleman|boy|girl|child|baby|infant|patient|client|person|feeling|having|has|had|suffering|presenting|presents|brought|coming|come|came|known|unknown|emergency|case|seeing|attending|age|aged|years?|months?)\b/i;

  /**
   * Read who the patient is out of a dictated sentence.
   * Returns { name, sex, age, ageUnit, heard } — only what was actually marked.
   */
  function parsePerson(spoken) {
    var text = digitsFromWords(joinSpelled(String(spoken || '')));
    var out = { name: '', sex: '', age: '', ageUnit: '', heard: [] };

    for (var i = 0; i < SEX_WORD.length; i++) {
      if (SEX_WORD[i][1].test(text)) { out.sex = SEX_WORD[i][0]; break; }
    }
    if (!out.sex) {
      // Whichever pronoun the clinician used for the patient, by weight of use.
      var she = (text.match(SHE) || []).length;
      var he = (text.match(HE) || []).length;
      if (she > he) out.sex = 'female';
      else if (he > she) out.sex = 'male';
    }
    if (out.sex) out.heard.push('Sex: ' + out.sex);

    // Months first: an infant's age in months must not be read as years.
    var m = AGE_M.exec(text) || AGE_M2.exec(text);
    if (m && +m[1] > 0 && +m[1] <= 36) {
      out.age = m[1]; out.ageUnit = 'months';
    } else {
      m = AGE_Y.exec(text) || AGE_BARE.exec(text) || AGE_SAID.exec(text);
      if (m && +m[1] > 0 && +m[1] <= 120) { out.age = m[1]; out.ageUnit = 'years'; }
    }
    if (out.age) out.heard.push('Age: ' + out.age + ' ' + out.ageUnit);

    var n = NAME_CUE.exec(text);
    if (n) {
      // Two cues can overlap — "this patient is called Grace" matches
      // "patient is" first and hands back "called Grace". Peel the cue words
      // off rather than throwing the name away.
      var cand = n[1].trim();
      for (var g = 0; g < 3 && NAME_LEAD.test(cand); g++) {
        cand = cand.replace(NAME_LEAD, '').trim();
      }
      for (var g2 = 0; g2 < 3 && NAME_TAIL.test(cand); g2++) {
        cand = cand.replace(NAME_TAIL, '').trim();
      }
      if (cand && !NOT_A_NAME.test(cand)) {
        out.name = titleCase(cand);
        out.heard.push('Name: ' + out.name);
      }
    }
    return out;
  }

  // ── The complaint and the story ──────────────────────────────────────────
  // Vitals are numbers, so the rule there is never to guess which box one
  // belongs to. Free text has the opposite failure: the danger is not a wrong
  // box but a LOST sentence, because a clinician who dictated "no chest pain"
  // and cannot find it will assume it was recorded.
  //
  // So the invariant here is that every word spoken ends up in one box or the
  // other. The complaint is only taken when the clinician marked it — by
  // saying "complains of", or by opening with a short symptom phrase — and
  // everything else, including anything ambiguous, goes to the story. The
  // story is the safe place: it is a free textarea the clinician reads back.

  // The clinician saying, in so many words, "this is what they came with".
  var COMPLAINT_CUE = /\b(?:complain(?:s|ing|ed)?\s+of|complaint\s+(?:is|of)|presents?\s+with|presenting\s+with|(?:has|have|had)\s+come\s+(?:in\s+)?with|came\s+(?:in\s+)?with|comes?\s+in\s+with|brought\s+(?:in\s+)?(?:with|because\s+of)|here\s+(?:for|with)|the\s+(?:problem|complaint|trouble)\s+is|c\s*\/\s*o)\b\s*/i;

  // Where the complaint stops and the story starts: a duration, an onset, an
  // extra symptom, something already taken, or a denial.
  // A bare duration is a story cue on its own. Clinicians drop the "for":
  // "diarrhoea three days, four episodes today" — and without this the
  // duration rides into the complaint, where it reads as part of the symptom.
  var SPAN = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|' +
             'a|an|few|several|couple\\s+of)\\s+' +
             '(?:hour|day|night|week|month|year)s?';
  var STORY_CUE = new RegExp('\\b(?:' + [
    'for\\s+(?:the\\s+)?(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|a\\s+few|several|about)',
    'since\\b', 'started\\b', 'starting\\b', 'began\\b', 'onset\\b', 'which\\s+began',
    'also\\b', 'plus\\b', 'associated\\b',
    'denies\\b', 'denied\\b', 'no\\s+[a-z]', 'not\\s+[a-z]', 'without\\s+[a-z]',
    'has\\s+(?:taken|had|been)', 'have\\s+taken', 'was\\s+given', 'were\\s+given',
    'took\\b', 'tried\\b',
    'getting\\s+worse', 'worse\\s+(?:at|after|on|with)', 'better\\s+(?:at|after|on|with)',
    'relieved\\s+by', 'aggravated\\s+by', 'radiat\\w+',
    'on\\s+and\\s+off', 'comes\\s+and\\s+goes',
    '(?:this|last|yesterday|today|tonight)\\s',
    'for\\s+(?:a|an|the)\\s+(?:day|week|month|year|while|night)',
    // How it happened, and what they can or cannot do because of it. Both are
    // the story of the complaint, not the complaint itself: "back pain after
    // lifting", "a wound from a nail", "fever and refuses to eat".
    'after\\b', 'from\\s+(?:a|an)\\s', 'refus\\w+', '(?:un)?able\\s+to',
    SPAN,
  ].join('|') + ')\\b', 'i');

  // Enough of a symptom vocabulary to recognise an opening line as a
  // complaint. It does not need to be complete — anything it does not know
  // simply goes to the story, which is the harmless direction.
  var SYMPTOM_WORDS = [
    'fever', 'hot body', 'body hotness', 'chills', 'rigors', 'shivering',
    'cough', 'coughing', 'catarrh', 'flu', 'cold',
    'headache', 'head ?ache', 'migraine', 'dizziness', 'dizzy', 'fainting',
    'diarrhoea', 'diarrhea', 'loose stools?', 'running stomach',
    'vomiting', 'vomits?', 'throwing up', 'nausea', 'nauseous',
    'abdominal pain', 'stomach ?ache', 'stomach pain', 'belly pain', 'colic',
    'chest pain', 'palpitations', 'breathlessness', 'difficulty in breathing',
    'hard(?: to)? breath\\w*', 'short(?:ness)? of breath', 'wheez\\w+',
    'fast breathing', 'chest in-?drawing',
    'rash', 'itching', 'itchy', 'swelling', 'swollen', 'boils?', 'ulcers?',
    'wound', 'burn', 'bite', 'injury', 'fracture', 'bleeding',
    'ear ?ache', 'ear pain', 'ear discharge', 'sore throat', 'throat pain',
    'toothache', 'tooth pain', 'gum pain',
    'weakness', 'fatigue', 'tiredness', 'tired', 'malaise', 'body weakness',
    'joint pain', 'back ?ache', 'back pain', 'muscle pain', 'body pain',
    'burning urine', 'painful urination', 'dysuria', 'frequency',
    'discharge', 'sores?', 'jaundice', 'yellow eyes',
    'convulsions?', 'fits?', 'seizures?', 'unconscious\\w*', 'confusion',
    'loss of appetite', 'not eating', 'weight loss', 'night sweats',
    'stiff neck', 'neck stiffness', 'photophobia',
    'blurred vision', 'poor vision', 'red eye', 'eye pain', 'eye discharge',
    'pain',
  ];
  var SYMPTOM_SRC = SYMPTOM_WORDS.join('|');
  var SYMPTOM = new RegExp('\\b(?:' + SYMPTOM_SRC + ')\\b', 'i');
  // The same vocabulary, anchored — "do these words START with a symptom?"
  var SYMPTOM_HEAD = new RegExp('^(?:' + SYMPTOM_SRC + ')\\b', 'i');

  // Weak cues, trusted ONLY when a known symptom follows immediately.
  // "with" and "has" are far too common to mark a complaint on their own, but
  // "with a rash" and "has fever" are exactly how one is said out loud, and
  // requiring the next words to be in the symptom vocabulary makes them safe:
  // nothing that is not already a symptom can be turned into a complaint.
  var WEAK_CUE = /\b(?:with|has|have|had|having|got|feeling|feels|reports?|reporting|presents?|presenting|shows?|showing)\s+(?:(?:a|an|the|some|this|got|been)\s+)*/gi;

  // The clinician's own denials, surfaced so their eye goes to them. A
  // recogniser that DROPS a "no" cannot be detected from the text it produced
  // — which is exactly why the transcript is shown back verbatim rather than
  // only the tidied result.
  var NEGATION = /\b(?:no|not|denies|denied|without|never)\s+((?:[a-z]+\s*){1,3})/gi;

  // What belongs in the background rather than in today's story: what they
  // already have, what they are already on, and who they are. A clinician says
  // these in the same breath as the complaint, so they arrive mixed in.
  var BACKGROUND_CUE = /\b(?:(?<!\bnot\s)known\b|is\s+a\s+known|history\s+of|past\s+history|family\s+history|previously\s+(?:treated|diagnosed)|already\s+on|currently\s+on|is\s+on\s+(?:treatment|medication|art|arvs?|insulin|metformin)|on\s+(?:art|arvs?|insulin|metformin|treatment for)|hiv\s*(?:positive|negative|\+ve)|diabetic|hypertensive|asthmatic|epileptic|pregnan\w+|breast\s*feeding|smok\w+|drinks?\s+alcohol|alcoholic|lives\s+(?:in|with|alone)|works?\s+as|farmer|market\s+vendor|boda\s*(?:boda)?\s+(?:rider|driver|man|cyclist|guy)|(?:is|works)\s+(?:as\s+)?a\s+boda)\b/i;

  // A clause that is nothing but "on <something>" is a medicine they are
  // already taking — "known heart problem, on furosemide". Tested on its own
  // because it is anchored to the whole clause, which the cue list above is
  // not.
  var BACKGROUND_CLAUSE =
    /^on\s+(?!and\b|the\b|an?\b|his\b|her\b|their\b|both\b|exam|palpation)[a-z][a-z-]*[,.;]?$/i;

  /** The first ordinary word that introduces a real symptom, or null. */
  function weakCue(text) {
    WEAK_CUE.lastIndex = 0;
    var m;
    while ((m = WEAK_CUE.exec(text))) {
      var rest = text.slice(m.index + m[0].length);
      if (SYMPTOM_HEAD.test(rest)) return { index: m.index, cue: m[0] };
      // Keep looking: "brought with her mother, has a fever" has two.
      if (WEAK_CUE.lastIndex <= m.index) WEAK_CUE.lastIndex = m.index + 1;
    }
    return null;
  }

  // Once the name, the sex and the age are in their own boxes, saying them
  // again in the story is noise — and the story is the box a clinician reads
  // as "what happened to this person today". Nothing is lost by moving them
  // out: the words are still on the screen verbatim, in the box that can be
  // corrected and again under "What was heard, word for word".
  //
  // A clause is dropped ONLY when it is nothing but scaffolding. It is kept
  // the moment it contains a symptom or a denial, so the way this fails is by
  // keeping too much — which is untidy, and safe.
  var PERSON_VOCAB = new RegExp('\\b(?:' + [
    'name', 'named', 'names', 'called', 'call', 'goes', 'go', 'by',
    'of', 'the', 'this', 'that', 'these', 'a', 'an',
    'his', 'her', 'their', 'its', 'our', 'my',
    'patients?', 'clients?', 'person', 'people', 'case',
    'is', 'was', 'are', 'am', 'be', 'been', 'being',
    'he', 'she', 'they', 'it', 'we', 'i', 'you',
    'have', 'has', 'had',
    'male', 'female', 'man', 'woman', 'lady', 'gentleman', 'boy', 'girl',
    'child', 'baby', 'infant', 'toddler', 'mr', 'mrs', 'miss', 'ms', 'dr',
    'years?', 'yrs?', 'months?', 'old', 'age', 'aged',
    'about', 'around', 'approximately', 'roughly',
    'yeah', 'yes', 'ok', 'okay', 'so', 'well', 'erm', 'um', 'uh', 'er', 'ah',
    'and', 'but', 'then', 'now', 'here', 'there', 'today',
    'seeing', 'see', 'attending', 'attend', 'to', 'with', 'who', 'which',
    'come', 'comes', 'came', 'coming', 'brought', 'bring', 'brings',
    'arrived', 'arrives', 'presented', 'presenting', 'presents', 'visit',
    'visited', 'seen',
  ].join('|') + ')\\b', 'gi');

  var HAS_NEGATION = /\b(?:no|not|denies|denied|without|never|nothing)\b/i;

  function dropPersonBits(history, who) {
    if (!history) return history;
    var nameWords = String((who && who.name) || '').toLowerCase()
      .split(/\s+/).filter(Boolean);
    var keep = [];
    history.split(/(?<=[,.;])\s*/).forEach(function (part) {
      var t = part.trim();
      if (!t) return;
      // A symptom or a denial makes it the story, whatever else is in it.
      if (SYMPTOM.test(t) || HAS_NEGATION.test(t)) { keep.push(t); return; }
      var rest = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
      nameWords.forEach(function (w) {
        var safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rest = rest.replace(new RegExp('\\b' + safe + '\\b', 'g'), ' ');
      });
      PERSON_VOCAB.lastIndex = 0;
      rest = rest.replace(PERSON_VOCAB, ' ')
        .replace(/\b\d+\b/g, ' ')
        .replace(/\b[a-z]\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (rest) keep.push(t);
    });
    return tidy(keep.join(' '));
  }

  // ── Names that were spelt out ────────────────────────────────────────────
  //
  // A recogniser trained on English will not spell Ugandan names reliably, and
  // the clinician's way round that is the same as on the phone: spell it. The
  // recogniser hands back the letters separately — "O-K-E-L-L-O", or "O K E L
  // L O" after "spelt" — and they are joined back into a word here.
  //
  // Hyphens are joined on sight, because a run of single letters joined by
  // hyphens is never ordinary prose. Space-separated letters are joined ONLY
  // after a spelling cue, or "I am a" would become "Iama".
  var SPELLED_HYPHEN = /\b([A-Za-z])(?:\s*[-–—.]\s*([A-Za-z])){2,}\b/g;
  var SPELL_CUE = /\b(?:spelt|spelled|spelling|spell\s+it|that\s+is|which\s+is|letters?)\s*[:,]?\s*/i;

  function joinSpelled(text) {
    var out = String(text || '');

    // "O-K-E-L-L-O" → "OKELLO"
    out = out.replace(SPELLED_HYPHEN, function (whole) {
      return whole.replace(/[^A-Za-z]/g, '');
    });

    // "spelt O K E L L O" → "spelt OKELLO"
    var cue = SPELL_CUE.exec(out);
    while (cue) {
      var at = cue.index + cue[0].length;
      var run = /^((?:[A-Za-z]\s+){2,}[A-Za-z])\b/.exec(out.slice(at));
      if (!run) break;
      var joined = run[1].replace(/\s+/g, '');
      out = out.slice(0, at) + joined + out.slice(at + run[1].length);
      SPELL_CUE.lastIndex = 0;
      var next = SPELL_CUE.exec(out.slice(at + joined.length));
      if (!next) break;
      cue = { index: at + joined.length + next.index, 0: next[0] };
    }
    return out;
  }

  function tidy(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/^[\s,.;:–—-]+/, '')
      .replace(/[\s,;:]+$/, '')
      .trim();
  }

  /**
   * Split a dictated sentence into the complaint and the story.
   *
   * Returns { complaint, history, negations, lost }:
   *   lost — words that reached neither box. It must always be empty; the
   *          test asserts it, because losing a sentence is the fault that
   *          matters here.
   */
  function parseStory(spoken) {
    var text = tidy(spoken);
    if (!text) return { complaint: '', history: '', negations: [], lost: '' };

    // cutFrom is where the complaint span is removed from the story; start is
    // where the complaint TEXT begins. They differ by the cue itself
    // ("complains of"), which is scaffolding rather than clinical content and
    // would otherwise be stranded in the story as "Patient complains of for
    // two days".
    var cutFrom = -1, start = -1, cueText = '';
    var cue = COMPLAINT_CUE.exec(text);
    if (cue) {
      cutFrom = cue.index;
      start = cue.index + cue[0].length;
      cueText = cue[0];
      // "Patient complains of", "She presents with" — the subject belongs to
      // the cue, not to the story. Left behind it strands a lone "Patient" at
      // the front of the history.
      var subj = /(?:^|\s)((?:the\s+)?(?:patient|pt|client|mother|father|child|baby|infant|man|woman|lady|he|she|they)\s+)$/i
        .exec(text.slice(0, cutFrom));
      if (subj) { cutFrom -= subj[1].length; cueText = subj[1] + cueText; }
    } else if (weakCue(text)) {
      // No announced cue, but a known symptom is introduced by an ordinary
      // word: "with a rash", "has fever", "feeling weak". This is how most
      // people actually say it, and it is safe because the symptom vocabulary
      // does the deciding — "with her mother" is not a complaint.
      var w = weakCue(text);
      cutFrom = w.index;
      start = w.index + w.cue.length;
      cueText = w.cue;
      var wsubj = /(?:^|\s)((?:the\s+)?(?:patient|pt|client|mother|father|child|baby|infant|man|woman|lady|he|she|they)\s+)$/i
        .exec(text.slice(0, cutFrom));
      if (wsubj) { cutFrom -= wsubj[1].length; cueText = wsubj[1] + cueText; }
    } else {
      // No cue at all, but the clinician opened on a symptom — "fever for
      // three days getting worse at night". That is a complaint followed by
      // its story.
      // The complaint begins AT the symptom, not at the first word: "she has
      // been feeling tired" would otherwise make "she" the complaint, because
      // "has been" is where the story starts.
      var head = text.split(/\s+/).slice(0, 8).join(' ');
      var sym = SYMPTOM.exec(head);
      if (sym) {
        cutFrom = start = sym.index;
        var lead = /(?:^|\s)((?:the\s+)?(?:patient|pt|client|mother|father|child|baby|infant|man|woman|lady|he|she|they)\s+(?:has\s+been\s+|have\s+been\s+|is\s+|are\s+|was\s+|were\s+|has\s+|have\s+|had\s+|feels?\s+|feeling\s+|reports?\s+|says?\s+)*)$/i
          .exec(text.slice(0, cutFrom));
        if (lead) { cutFrom -= lead[1].length; cueText = lead[1]; }
      }
    }

    var complaint = '', history = text;
    if (start >= 0) {
      var after = text.slice(start);
      var stop = STORY_CUE.exec(after);
      var punct = /[,.;]/.exec(after);
      var end = after.length;
      if (stop) end = Math.min(end, stop.index);
      if (punct) end = Math.min(end, punct.index);
      // A complaint is a phrase, not a paragraph. Anything longer belongs to
      // the story, where the clinician reads it back.
      var w = after.slice(0, end).trim().split(/\s+/);
      if (w.length > 8) end = after.indexOf(w[8]);
      // Never end on a joining word. The cap above cut "a wound on the left
      // leg from a | boda accident", leaving "from a" hanging on the
      // complaint; those words belong with the rest in the story.
      var tail = /(?:\s+(?:a|an|the|of|on|in|at|from|with|and|to|for|by|his|her|their))+\s*$/i
        .exec(after.slice(0, end));
      if (tail) end -= tail[0].length;
      if (end > 0) {
        // "a fever and cough" is how it is said and not how it is written
        // down. The article is the only word dropped, and it carries nothing —
        // but it is added to the cue text rather than simply discarded, so the
        // "nothing spoken is lost" count below stays exactly true.
        complaint = tidy(after.slice(0, end));
        var art = /^(?:a|an|the|some)\s+/i.exec(complaint);
        if (art) { complaint = complaint.slice(art[0].length); cueText += ' ' + art[0]; }
        history = tidy(text.slice(0, cutFrom) + ' ' + text.slice(start + end));
      }
    }

    // Nothing clinical may vanish. Compared on words, since punctuation and
    // spacing are tidied on the way through; the cue phrase is excluded
    // because it is deliberately dropped.
    function bag(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/).filter(Boolean).sort();
    }
    var before = bag(text), after2 = bag(complaint + ' ' + history), lost = [];
    // (background is carved out of history below, so it is already counted)
    var seen = {};
    after2.concat(bag(cueText)).forEach(function (x) { seen[x] = (seen[x] || 0) + 1; });
    before.forEach(function (x) {
      if (seen[x]) seen[x]--; else lost.push(x);
    });

    // Anything in the story that is really background is moved across, clause
    // by clause, so "known diabetic on metformin" stops sitting inside today's
    // complaint. Nothing is dropped in the move — the invariant above is
    // recomputed over all three boxes.
    var background = '';
    if (history) {
      var keep = [], bg = [];
      history.split(/(?<=[,.;])\s*|\s+(?=and\s+(?:is\s+)?known\b)/).forEach(function (part) {
        var t = part.trim();
        if (!t) return;
        (BACKGROUND_CUE.test(t) || BACKGROUND_CLAUSE.test(t) ? bg : keep).push(t);
      });
      // Everything left over CAN be background — "complains of chest pain,
      // known hypertensive on amlodipine" leaves no story at all. Requiring
      // something to stay behind was wrong: it parked the whole background in
      // today's story, which is the box a clinician reads as what happened
      // today.
      if (bg.length) {
        background = tidy(bg.join(' '));
        history = tidy(keep.join(' '));
      }
    }

    var negations = [], m;
    NEGATION.lastIndex = 0;
    while ((m = NEGATION.exec(text))) negations.push(tidy(m[0]));

    return { complaint: complaint, history: history, background: background,
             negations: negations, lost: lost.join(' ') };
  }

  // ── The microphone ───────────────────────────────────────────────────────
  // Recording is only half of it. Transcription happens on the server, so it
  // needs a connection — and this app is built for clinics that often do not
  // have one. The button says so rather than failing silently, because a
  // clinician tapping a dead button twice is worse than a clinician who was
  // told to type.
  var FIELD = { sbp: 'itSbp', dbp: 'itDbp', temp: 'itTemp',
                weight: 'itWeight', pulse: 'itPulse' };
  var MAX_MS = 30000;                    // a vitals reading is one sentence
  var _rec = null, _chunks = [], _stopT = null;

  function say(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'it-dict-say' + (kind ? ' ' + kind : '');
  }

  function offline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  // Put the numbers in the boxes and tell the fields they changed, so the
  // existing abnormal-reading colouring and the suggestion engine both run
  // exactly as they do when the clinician types.
  // Append rather than replace. A clinician who dictates a second sentence
  // must not lose the first, and a box the clinician typed into by hand must
  // survive a dictation. Nothing spoken overwrites anything already there.
  function addTo(id, text) {
    var el = document.getElementById(id);
    if (!el || !text) return 0;
    var had = String(el.value || '').trim();
    el.value = had ? had.replace(/[\s,;]+$/, '') + '. ' + text : text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  }

  // Vitals REPLACE: a re-taken temperature is meant to overwrite the old
  // one. Free text appends, because a second sentence adds to the story
  // rather than correcting it. addTo() above is the free-text half.
  function fill(vitals) {
    var n = 0;
    Object.keys(vitals).forEach(function (k) {
      var el = document.getElementById(FIELD[k]);
      if (!el) return;
      el.value = vitals[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      n++;
    });
    return n;
  }

  // A failed dictation is remembered, so the clinic is told the same thing on
  // the next attempt and the settings screen can show it. "Out of credit" is
  // not a glitch: it will not fix itself, and a clinician who thinks it is a
  // bad signal will keep trying all morning.
  var FAULT_KEY = 'homatt_dictation_fault';
  function noteFault(kind, message) {
    try {
      if (!kind) { localStorage.removeItem(FAULT_KEY); return; }
      localStorage.setItem(FAULT_KEY, JSON.stringify({
        kind: kind, message: message || '', at: new Date().toISOString(),
      }));
    } catch (e) {}
  }
  function lastFault() {
    try { return JSON.parse(localStorage.getItem(FAULT_KEY) || 'null'); }
    catch (e) { return null; }
  }

  async function transcribe(blob, mode) {
    var form = new FormData();
    form.append('audio', blob, 'clip.webm');
    form.append('mode', mode === 'vitals' ? 'vitals' : 'story');
    // _getClinicSupabase() is the app's one shared client — the page-level
    // `supabase` global is not safe to read here, because a page that assigns
    // to it replaces the library with the client.
    var sb = (typeof global._getClinicSupabase === 'function')
      ? global._getClinicSupabase() : null;
    if (!sb || !sb.functions) {
      var e0 = new Error('Dictation is not set up on this server.');
      e0.kind = 'unconfigured';
      throw e0;
    }
    var r = await sb.functions.invoke('transcribe', { body: form });
    if (r.error) throw await faultFrom(r.error);
    noteFault(null);
    return (r.data && r.data.text) || '';
  }

  /**
   * Can this phone reach Supabase at all?
   *
   * Asked only when a request failed with nothing to read, to tell a server
   * that is not answering from one that is answering with something the
   * browser will not show us. `mode: 'no-cors'` is the point: the reply is
   * opaque and unreadable, but the PROMISE still tells us whether anything
   * came back, and that is the whole question.
   *
   * Returns true (reached it), false (did not), or null (cannot tell).
   */
  async function supabaseReachable() {
    var cfg = global.HOMATT_CONFIG || {};
    var base = cfg.SUPABASE_URL;
    if (!base || typeof fetch !== 'function') return null;
    try {
      await fetch(String(base).replace(/\/+$/, '') + '/auth/v1/health',
                  { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * What actually went wrong, in words a clinician can act on.
   *
   * Every one of these looked identical before — "Could not reach the dictation
   * service" — and they need four different people to fix them. The one that
   * matters most is the FIRST one: a clinic that has not deployed the function
   * yet has never had dictation, and telling them the network is bad sends them
   * to the wrong problem for a week.
   *
   * A non-2xx arrives as an error whose `context` is the Response, so both the
   * status and the function's own JSON are there to be read.
   */
  async function faultFrom(e) {
    var ctx = e && e.context;
    var status = (ctx && typeof ctx.status === 'number') ? ctx.status : 0;
    var body = null;
    try {
      if (ctx && typeof ctx.json === 'function') body = await ctx.json();
    } catch (e2) {}

    // Our own function says which fault it is. Only its messages are shown
    // verbatim — a gateway's "Requested function was not found" is true and
    // useless to a nurse.
    if (body && body.kind && body.error) {
      var mine = new Error(String(body.error));
      mine.kind = String(body.kind);
      return mine;
    }

    var msg, kind;
    if (status === 404) {
      kind = 'unconfigured';
      msg = 'Dictation has not been switched on for this clinic yet. Someone ' +
            'has to set it up on the server — type the readings for now.';
    } else if (status === 401 || status === 403) {
      kind = 'signedout';
      msg = 'You have been signed out, so dictation was refused. Sign in ' +
            'again — type it in for now.';
    } else if (status === 429) {
      kind = 'busy';
      msg = 'The dictation service is busy. Wait a moment and try again.';
    } else if (status >= 500) {
      kind = 'server';
      msg = 'The dictation service had a problem at its end. Type it in for ' +
            'now and try again later.';
    } else {
      // No status at all. This is the case that cost a clinic a week.
      //
      // An Edge Function that was never DEPLOYED answers 404 from the gateway
      // with no CORS headers on it, so the browser refuses to show the reply
      // to JavaScript and fetch() simply rejects. From in here that is
      // indistinguishable from a dead connection — and it is by far the more
      // likely of the two, because a function has to be deployed before it can
      // ever answer, and nothing in the app says whether it was.
      //
      // So ask a second question the browser WILL answer: can this phone reach
      // Supabase at all? If it can, the connection is not the problem and the
      // clinic should be looking at their server, not their signal.
      var reachable = await supabaseReachable();
      if (reachable === true) {
        kind = 'unconfigured';
        msg = 'Dictation has not been switched on for this clinic yet — the ' +
              'server is answering, but the dictation part of it was never ' +
              'installed. Type it in for now and show this to whoever set the ' +
              'app up.';
      } else {
        // The way round it goes in the same breath as the bad news — a message
        // that only says something failed leaves the clinician tapping the
        // button again with a patient in front of them.
        kind = 'unreachable';
        msg = 'Could not reach the dictation service. Type it in for now.';
      }
    }
    var err = new Error(msg);
    err.kind = kind;
    err.status = status;
    return err;
  }

  // ── Filling in who the patient is ────────────────────────────────────────
  function setSex(sex) {
    if (!sex) return 0;
    var b = document.querySelector('.it-sex-btn[data-sex="' + sex + '"]');
    if (!b || b.classList.contains('on')) return 0;
    b.click();
    return 1;
  }
  function setAge(age, unit) {
    if (!age) return 0;
    var el = document.getElementById('itAge');
    if (!el) return 0;
    el.value = age;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    var u = document.querySelector('[data-unit="' + (unit || 'years') + '"]');
    if (u && !u.classList.contains('on')) u.click();
    return 1;
  }
  // The name is only ever written into an EMPTY box. A clinician who typed a
  // spelling by hand has decided how it is spelled, and a recogniser's guess at
  // a Ugandan name must not overwrite that.
  function setName(name) {
    var el = document.getElementById('quickPatientName');
    if (!el || !name || String(el.value || '').trim()) return 0;
    el.value = name;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  }

  // Ask the server to split the transcript up. Returns {} on any failure —
  // the rules below have already filled what they could, so a model that is
  // slow, down or not configured costs the clinician nothing.
  async function structure(text) {
    try {
      var sb = (typeof global._getClinicSupabase === 'function')
        ? global._getClinicSupabase() : null;
      if (!sb || !sb.functions) return {};
      var r = await sb.functions.invoke('structure', { body: { transcript: text } });
      if (r.error || !r.data || !r.data.fields) return {};
      return r.data.fields;
    } catch (e) { return {}; }
  }

  // Every word of the dictation must still be in one box or another. The rules
  // guarantee that by construction; a model does not, so its split is only
  // accepted when it demonstrably drops nothing. Otherwise the rules' split
  // stands — worse organised, but complete, which is the way round that matters.
  function keepsEverything(text, complaint, history, background) {
    function bag(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/).filter(function (w) { return w.length > 2; });
    }
    var have = {};
    bag(complaint + ' ' + history + ' ' + background).forEach(function (w) { have[w] = 1; });
    var missing = bag(text).filter(function (w) { return !have[w]; });
    // A few filler words may fall out in tidying; a sentence may not.
    return missing.length <= 3;
  }

  // Write into a box, remembering what was there before and what we left, so a
  // later, better split can REPLACE our text rather than be appended after it —
  // and so a box the clinician has since typed in is recognised and left alone.
  function writeTo(id, text, wrote) {
    var el = document.getElementById(id);
    if (!el || !text) return 0;
    var had = String(el.value || '').trim().replace(/[\s,;]+$/, '');
    var now = had ? had + '. ' + text : text;
    el.value = now;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (wrote) wrote[id] = { had: had, left: now };
    return 1;
  }

  // Put a better version of the same field in place of the one we wrote. If the
  // box no longer holds exactly what we left there, the clinician has edited it
  // since, and their words win — an "improvement" that deletes what a clinician
  // typed is not an improvement.
  function replaceIfUntouched(id, text, wrote) {
    var el = document.getElementById(id);
    var w = wrote && wrote[id];
    if (!el || !text) return 0;
    if (!w) return writeTo(id, text, wrote);       // nothing there before
    if (String(el.value) !== w.left) return 0;     // typed in since
    var now = w.had ? w.had + '. ' + text : text;
    if (now === w.left) return 0;
    el.value = now;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    w.left = now;
    return 1;
  }

  // A model may only report a name it actually heard. Asked to fill a form, a
  // model will oblige — and a plausible Ugandan name on a consultation nobody
  // named is worse than an empty box, because it looks like a record. So every
  // word of a suggested name has to be in the transcript.
  function saidAloud(candidate, text) {
    if (!candidate) return false;
    var hay = ' ' + String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
    return String(candidate).toLowerCase().split(/\s+/).filter(Boolean)
      .every(function (w) { return hay.indexOf(' ' + w + ' ') >= 0; });
  }

  /**
   * The whole consultation, from one dictation.
   *
   * The RULES fill the boxes the moment the words arrive — no second round
   * trip, no waiting. On a clinic connection that is the difference between a
   * filled form and a clinician watching an empty one, and the rules place
   * every word correctly in 30 of 30 measured dictations.
   *
   * The MODEL is then asked, in the background, whether it can split the prose
   * better and put a name to the patient. When it answers, anything it improves
   * replaces what the rules wrote — unless the clinician has typed there since,
   * in which case their words stand. It is never shown a number, never asked
   * for a diagnosis, and its split is refused outright if it drops a word.
   *
   * `refine`, if given, is called with the updated result when that happens.
   */
  async function applyConsult(text, refine) {
    var lines = [];

    // 1. Numbers, by rule. Never from a model.
    var v = parseVitals(text);
    var nv = fill(v.vitals);
    if (nv) lines.push('Vitals: ' + v.heard.join(' · '));
    v.ignored.forEach(function (g) {
      lines.push('Ignored ' + g.key + ' ' + g.value + ' — ' + g.why);
    });

    // 2. Who they are and what they came with, by rule — straight into the
    //    boxes, before anything is asked of the server.
    var who = parsePerson(text);
    var story = parseStory(text);
    var wrote = {};
    var placedName = who.name, placedSex = who.sex, placedAge = who.age,
        placedUnit = who.ageUnit || 'years', placedComplaint = story.complaint;

    var n = 0;
    n += setName(who.name);
    n += setSex(who.sex);
    n += setAge(who.age, who.ageUnit);
    var chief = document.getElementById('itChief');
    var chiefEmpty = chief && !String(chief.value || '').trim();
    n += (chiefEmpty ? writeTo('itChief', story.complaint, wrote) : 0);
    // The story, with the "his name is X, he is male, 28 years old" scaffolding
    // taken out — it is already in the three boxes above, and repeating it is
    // what made the summary look like a transcript rather than a record.
    n += writeTo('itSubjective',
                 dropPersonBits(chiefEmpty ? story.history : text, who), wrote);
    if (story.background) n += writeTo('itBackground', story.background, wrote);

    function report(name, sex, age, unit, complaint, count) {
      // Always the words that were actually heard, first, before any tidying —
      // a dropped "no" is invisible in the tidied version and obvious here.
      var out = ['Heard: “' + text + '”'];
      var placed = [];
      if (name) placed.push('name ' + name);
      if (sex) placed.push(sex);
      if (age) placed.push(age + ' ' + unit);
      if (complaint) placed.push('complaint: ' + complaint);
      if (placed.length) out.push('Filled in: ' + placed.join(' · '));
      out = out.concat(lines);
      if (story.negations.length) {
        out.push('You said: ' + story.negations.join(', ') + ' — check that is right');
      }
      if (!count) out.push('Nothing in that could be placed — the words are ' +
                           'above, type what belongs where.');
      return { text: out.join('  ·  '), ok: count > 0 };
    }

    // 3. The model, second and optional. Nothing above waits for it.
    if (typeof refine === 'function') {
      structure(text).then(function (ai) {
        if (!ai) return;
        var m = 0;
        if (!placedName && saidAloud(ai.name, text)) {
          m += setName(ai.name); if (m) placedName = ai.name;
        }
        if (!placedSex && ai.sex) { if (setSex(ai.sex)) { placedSex = ai.sex; m++; } }
        if (!placedAge && ai.age) {
          if (setAge(ai.age, ai.ageUnit || 'years')) {
            placedAge = ai.age; placedUnit = ai.ageUnit || 'years'; m++;
          }
        }
        if ((ai.complaint || ai.history || ai.background) &&
            keepsEverything(text, ai.complaint || '', ai.history || '', ai.background || '')) {
          if (chiefEmpty && ai.complaint) {
            m += replaceIfUntouched('itChief', ai.complaint, wrote);
            placedComplaint = ai.complaint;
          }
          if (chiefEmpty && ai.history) m += replaceIfUntouched('itSubjective', ai.history, wrote);
          if (ai.background) m += replaceIfUntouched('itBackground', ai.background, wrote);
        }
        if (!m) return;
        var r = report(placedName, placedSex, placedAge, placedUnit,
                       placedComplaint, n + m);
        r.usedModel = true;
        refine(r);
      }).catch(function () { /* the rules have already done the job */ });
    }

    var res = report(placedName, placedSex, placedAge, placedUnit,
                     placedComplaint, n);
    res.usedModel = false;
    return res;
  }

  // What to do with the transcript, and what to tell the clinician about it.
  //
  // The story mode always shows the transcript VERBATIM. That is not padding:
  // a recogniser that drops a "no" from "no chest pain" produces text that
  // reads perfectly well and means the opposite, and nothing in this file can
  // detect it. The only defence is that the clinician sees the words that were
  // actually heard, so the denials are listed separately to draw the eye.
  function applied(mode, text, refine) {
    text = String(text || '').trim();
    if (mode === 'consult') return applyConsult(text, refine);
    if (mode === 'story') {
      var got = parseStory(text);
      // The chief complaint is ONE thing — the reason they came. A clinician
      // adding "also complains of joint pain" is giving another symptom, and
      // that belongs in the history. So the complaint box is only ever set
      // when it is empty; after that everything spoken joins the story.
      var chief = document.getElementById('itChief');
      var taken = chief && !String(chief.value || '').trim();
      var n = (taken ? addTo('itChief', got.complaint) : 0) +
              addTo('itSubjective', taken ? got.history : text);
      if (!n) return { text: 'Heard nothing to write down.', ok: false };
      var lines = ['Heard: “' + text + '”'];
      if (got.complaint) lines.push('Complaint: ' + got.complaint);
      if (got.negations.length) {
        lines.push('You said: ' + got.negations.join(', ') + ' — check that is right');
      }
      return { text: lines.join('  ·  '), ok: true };
    }

    var v = parseVitals(text);
    var filled = fill(v.vitals);
    var out = [];
    if (filled) out.push('Heard: ' + v.heard.join(' · '));
    v.ignored.forEach(function (g) {
      out.push('Ignored ' + g.key + ' ' + g.value + ' — ' + g.why);
    });
    if (!filled && !v.ignored.length) {
      out.push('Heard “' + text.slice(0, 60) + '” — no reading in that. Say it ' +
               'like: temp 38.5, BP 120 over 80, pulse 96.');
    }
    return { text: out.join('  ·  '), ok: !!filled };
  }

  function stop() {
    clearTimeout(_stopT);
    if (_rec && _rec.state !== 'inactive') { try { _rec.stop(); } catch (e) {} }
    _rec = null;
    liveOff();
  }

  // ── The words, before they are filed ─────────────────────────────────────
  //
  // A recogniser that turns "no chest pain" into "chest pain" produces a
  // sentence that reads perfectly well and means the opposite, and nothing in
  // this file can detect it — the transcript is the only place a human can.
  // So it is shown large and in full, and it can be CORRECTED here, once,
  // rather than in five separate boxes further down the screen. Correcting it
  // re-runs the placement from the start, so a fixed word reaches every box it
  // belongs in.
  var _heardApply = null;

  function showHeard(text, mode, show) {
    var box = document.getElementById('itHeardBox');
    var ta = document.getElementById('itHeardText');
    if (!box || !ta) return;
    ta.value = String(text || '');
    box.hidden = false;
    // Remember how to re-place it, so the "Use these words" button below does
    // exactly what the dictation itself did.
    _heardApply = { mode: mode, show: show, was: String(text || '') };
    try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }

  function hideHeard() {
    var box = document.getElementById('itHeardBox');
    if (box) box.hidden = true;
    _heardApply = null;
  }

  /** Wired once, on whichever page has the box. */
  function bindHeard() {
    var use = document.getElementById('itHeardUse');
    var again = document.getElementById('itHeardAgain');
    var ta = document.getElementById('itHeardText');
    var say0 = document.getElementById('itDictateStorySay');
    if (use && !use._wired) {
      use._wired = 1;
      use.addEventListener('click', async function () {
        if (!_heardApply || !ta) { hideHeard(); return; }
        var fixed = String(ta.value || '').trim();
        if (!fixed) { hideHeard(); return; }
        // Unchanged words are already in the boxes — saying so beats silently
        // appending the same sentence to the story a second time.
        if (fixed === _heardApply.was.trim()) {
          say(say0, 'Kept as heard.', 'ok');
          hideHeard();
          return;
        }
        var m = _heardApply.mode, sh = _heardApply.show;
        clearForRedo();
        var res = await applied(m, fixed, function (r) { sh(r, true); });
        sh(res);
        say(say0, 'Corrected, and filled in again from your words.', 'ok');
        hideHeard();
      });
    }
    if (again && !again._wired) {
      again._wired = 1;
      again.addEventListener('click', function () {
        // A re-take, not a second sentence. Saying it again means the first
        // attempt was wrong, and appending it produced "Name of the person is
        // Emmanuel Paul.. Name of the person is Emmanuel Opal." in the story.
        clearForRedo();
        hideHeard();
        var btn = document.getElementById('itDictateStory');
        if (btn) btn.click();
      });
    }
  }

  // Placing corrected words on top of the old ones would append the story
  // twice, so the boxes the dictation filled are emptied first. Only those:
  // anything the clinician typed by hand is not ours to clear.
  function clearForRedo() {
    ['itChief', 'itSubjective', 'itBackground'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  }

  // ── Showing that it is listening ─────────────────────────────────────────
  //
  // A button that only changes colour looks the same on a working microphone
  // and a dead one, and a clinician who cannot tell will keep talking into
  // nothing and lose the whole consultation. So the bars are driven by the
  // ACTUAL level coming off the microphone: if they do not move, it is not
  // hearing you, and that is worth knowing while there is still time to type.
  var _live = { raf: 0, ctx: null, tick: 0, t0: 0, meter: 0, peak: 0, drew: 0, ran: false };

  function liveEls() {
    return { box: document.getElementById('itDictateLive'),
             bars: document.getElementById('itDictateBars'),
             time: document.getElementById('itDictateTime') };
  }

  /** How loud was the loudest moment of this recording, 0…1. */
  function loudestHeard() { return _live.peak; }

  /** Did the level meter actually run? Its silence only means something if so. */
  function meterRan() { return !!_live.ran; }

  /**
   * Why a recording came back silent, in the order the causes are likely.
   *
   * "Nothing was recorded" is where a clinician gives up, and every one of
   * these has a different fix. The level meter has been running the whole
   * time, so this is not a guess: a peak of exactly zero means the audio
   * pipeline delivered nothing at all, and a peak just above zero means it
   * delivered a signal with no voice in it.
   */
  function silentWhy(peak) {
    if (!peak) {
      return 'Nothing came through the microphone at all. On the phone this ' +
             'is almost always the app not having the microphone yet: open ' +
             'Settings → Apps → Homatt Clinic → Permissions → Microphone and ' +
             'allow it. If it is already allowed, close any app that might be ' +
             'holding the microphone and tap again.';
    }
    return 'The microphone was working but heard almost nothing — the bars ' +
           'barely moved. Hold the phone closer to your mouth, check nothing ' +
           'is covering the microphone at the bottom, and say it again.';
  }

  function liveOn(stream) {
    var el = liveEls();
    _live.peak = 0;
    _live.drew = 0;
    _live.ran = false;
    if (!el.box) return;
    el.box.hidden = false;
    var h0 = el.box.querySelector('.it-live-hint');
    if (h0) {
      h0.className = 'it-live-hint';
      h0.textContent = 'Tap the button again when you have finished';
    }
    _live.t0 = Date.now();
    if (el.time) el.time.textContent = '0:00';
    _live.tick = setInterval(function () {
      var s = Math.floor((Date.now() - _live.t0) / 1000);
      if (el.time) {
        el.time.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      }
    }, 500);

    // The level meter is a bonus, not a requirement — an older WebView with no
    // AudioContext still gets the dot, the clock and the hint.
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC || !el.bars || !stream) return;
    var bars = el.bars.querySelectorAll('i');
    if (!bars.length) return;
    try {
      var ctx = new AC();
      // A new AudioContext starts SUSPENDED under the autoplay policy, and a
      // suspended analyser returns silence for ever — every bar flat, on a
      // microphone that is working perfectly. That is the whole "it is not
      // hearing me" symptom, and it is one line to fix. resume() is safe to
      // call when it is already running.
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.5;
      src.connect(an);
      var freq = new Uint8Array(an.frequencyBinCount);
      var wave = new Uint8Array(an.fftSize);
      _live.ctx = ctx;

      // Speech lives between roughly 100 Hz and 4 kHz. Averaging the WHOLE
      // spectrum across seven bars put most of them in frequencies a human
      // voice never reaches, so the right-hand bars sat dead however loudly
      // anyone spoke. Only the speech band is shown.
      var nyquist = (ctx.sampleRate || 48000) / 2;
      var topBin = Math.max(bars.length,
        Math.min(freq.length, Math.round(4000 / nyquist * freq.length)));

      var draw = function () {
        _live.drew++;
        _live.ran = true;          // the meter is real, so its verdict counts
        // RMS off the waveform is the honest answer to "is there any sound?".
        // The frequency bins are for the shape of the bars; this is for the
        // decision, and for telling the clinician afterwards.
        an.getByteTimeDomainData(wave);
        var sum2 = 0;
        for (var k = 0; k < wave.length; k++) {
          var d = (wave[k] - 128) / 128;
          sum2 += d * d;
        }
        var rms = Math.sqrt(sum2 / wave.length);
        if (rms > _live.peak) _live.peak = rms;

        an.getByteFrequencyData(freq);
        var per = Math.floor(topBin / bars.length) || 1;
        for (var i = 0; i < bars.length; i++) {
          var sum = 0;
          for (var j = 0; j < per; j++) sum += freq[i * per + j] || 0;
          // Loudness is logarithmic and a phone at arm's length in a clinic is
          // quiet. /140 on a linear scale left ordinary speech barely moving
          // the bars, which reads as "not hearing me".
          var lvl = (sum / per) / 255;
          var v = Math.min(1, Math.pow(lvl, 0.55) * 1.6);
          bars[i].style.transform = 'scaleY(' + (0.14 + v * 0.86).toFixed(3) + ')';
        }
        _live.raf = requestAnimationFrame(draw);
      };
      draw();

      // requestAnimationFrame does not run when the WebView thinks the page is
      // not visible, and some Android WebViews think that with the screen on.
      // A slow timer keeps the level honest either way — and says, in words,
      // whether it is hearing anything. The bars are the fast answer; this is
      // the one a clinician can read at a glance while still talking, which is
      // the only moment at which it is still worth knowing.
      var hint = el.box.querySelector('.it-live-hint');
      var began = Date.now();
      _live.meter = setInterval(function () {
        if (_live.drew === 0 && _live.ctx) draw();
        _live.drew = 0;
        if (!hint) return;
        if (_live.peak >= 0.012) {
          hint.textContent = 'Hearing you — tap the button again when you finish';
          hint.className = 'it-live-hint good';
        } else if (Date.now() - began > 2500) {
          hint.textContent = 'Not hearing anything yet — speak up, or hold the ' +
                             'phone closer';
          hint.className = 'it-live-hint bad';
        }
      }, 400);
    } catch (e) { /* the clock and the dot are enough */ }
  }

  function liveOff() {
    var el = liveEls();
    if (el.box) el.box.hidden = true;
    if (_live.raf) { cancelAnimationFrame(_live.raf); _live.raf = 0; }
    if (_live.tick) { clearInterval(_live.tick); _live.tick = 0; }
    if (_live.meter) { clearInterval(_live.meter); _live.meter = 0; }
    if (_live.ctx) { try { _live.ctx.close(); } catch (e) {} _live.ctx = null; }
    if (el.bars) {
      [].forEach.call(el.bars.querySelectorAll('i'), function (b) { b.style.transform = ''; });
    }
  }

  /**
   * Open the microphone, and say something useful when it will not open.
   *
   * "The microphone is blocked" is true and unhelpful: on Android the fix is
   * four taps deep in a settings screen the clinician has never seen, and
   * "blocked" does not distinguish a refusal from a phone with no microphone
   * at all. So the reasons are told apart and the way out is spelled out.
   */
  async function openMic() {
    // A permission that was refused once and remembered will not prompt again,
    // so the phone is asked first — otherwise the clinician taps a button that
    // silently does nothing.
    try {
      if (navigator.permissions && navigator.permissions.query) {
        var st = await navigator.permissions.query({ name: 'microphone' });
        if (st && st.state === 'denied') {
          var d = new Error('The microphone is turned off for this app. Open ' +
            'the phone Settings → Apps → Homatt Clinic → Permissions → ' +
            'Microphone and allow it, then tap again.');
          d.kind = 'mic-denied';
          throw d;
        }
      }
    } catch (e) {
      // Some WebViews throw on an unknown permission name. That is not an
      // answer, so fall through and simply ask for the microphone.
      if (e && e.kind === 'mic-denied') throw e;
    }

    // What a clinic room actually is: two people talking, a corridor outside,
    // a fan, and a phone held at arm's length. These are asked for as
    // preferences, not requirements — a hard constraint a phone cannot meet
    // fails the whole call with OverconstrainedError, and a slightly noisier
    // recording is enormously better than none. Mono because the recogniser
    // wants one channel and it halves what a clinic uploads on mobile data.
    var WANT = {
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl:  { ideal: true },
        channelCount:     { ideal: 1 },
        sampleRate:       { ideal: 16000 },
      },
    };

    try {
      return await navigator.mediaDevices.getUserMedia(WANT);
    } catch (e0) {
      // An older WebView can reject the shape of the request rather than the
      // request itself. Ask again the plain way before giving up on it.
      var n0 = (e0 && e0.name) || '';
      if (n0 === 'OverconstrainedError' || n0 === 'TypeError' ||
          n0 === 'NotSupportedError') {
        try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e1) { e0 = e1; }
      }
      throw micFault(e0);
    }
  }

  /** Which microphone problem it is, in words that say what to do next. */
  function micFault(e) {
    var name = (e && e.name) || '';
    var err;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      err = new Error('The microphone was not allowed. Tap the button again ' +
        'and choose Allow — or turn it on in Settings → Apps → Homatt ' +
        'Clinic → Permissions → Microphone.');
      err.kind = 'mic-denied';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      err = new Error('This phone has no microphone the app can use. Type it in.');
      err.kind = 'mic-missing';
    } else if (name === 'NotReadableError' || name === 'AbortError') {
      err = new Error('The microphone is being used by something else — end ' +
        'the call or close the other app, then tap again.');
      err.kind = 'mic-busy';
    } else {
      err = new Error('The microphone would not start. Type it in for now.');
      err.kind = 'mic-failed';
    }
    return err;
  }

  /**
   * What this phone can actually record, in the order the recogniser prefers.
   *
   * The recording used to be labelled `audio/webm` whatever the phone had
   * really produced, and that label is what the Edge Function forwards to
   * Deepgram as the Content-Type. An Android WebView that hands back MP4 was
   * therefore announced as WebM, and the recogniser was asked to decode a
   * container that was not there. Opus in WebM is both the best fit and the
   * smallest thing to upload from a clinic on mobile data, so it is asked for
   * first — but what comes back is what gets labelled.
   */
  var RECORD_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
  ];

  function makeRecorder(stream) {
    var MR = global.MediaRecorder;
    if (MR && typeof MR.isTypeSupported === 'function') {
      for (var i = 0; i < RECORD_TYPES.length; i++) {
        if (MR.isTypeSupported(RECORD_TYPES[i])) {
          try { return new MR(stream, { mimeType: RECORD_TYPES[i] }); }
          catch (e) { /* supported in name only — try the next */ }
        }
      }
    }
    // No isTypeSupported, or nothing on the list worked: let the phone pick.
    return new MR(stream);
  }

  /** What the recorder actually produced, for the Content-Type upstream. */
  function recordedType(rec, chunks) {
    var t = (rec && rec.mimeType) || '';
    if (!t && chunks && chunks.length && chunks[0].type) t = chunks[0].type;
    // MediaRecorder reports "audio/webm;codecs=opus"; the parameters are true
    // but some upstreams are happier with the bare type.
    return String(t || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  }

  /**
   * Wire a "say the readings" button to the vitals boxes.
   *   btnId  — the button
   *   sayId  — a line under it where what was heard is written back
   */
  function attach(btnId, sayId, mode) {
    var btn = document.getElementById(btnId);
    var out = document.getElementById(sayId);
    if (!btn) return;
    bindHeard();
    mode = (mode === 'story' || mode === 'consult') ? mode : 'vitals';

    btn.addEventListener('click', async function () {
      if (_rec) {
        // Said BEFORE stopping, not after. A recorder can fire onstop
        // synchronously, and onstop is what knows whether anything was
        // actually recorded — saying "reading it…" afterwards overwrote the
        // real answer with a lie that never changed.
        say(out, 'Listening finished — reading it…');
        stop();
        btn.classList.remove('on');
        return;
      }

      if (offline()) {
        say(out, 'Dictation needs a connection. Type the readings for now.', 'warn');
        return;
      }
      if (!navigator.mediaDevices || !global.MediaRecorder) {
        say(out, 'This phone cannot record audio. Type the readings.', 'warn');
        return;
      }

      var stream;
      hideHeard();                       // the last dictation's words are done
      say(out, 'Asking for the microphone…');
      try {
        stream = await openMic();
      } catch (e) {
        noteFault(e && e.kind, e && e.message);
        say(out, (e && e.message) || 'The microphone would not start.', 'warn');
        return;
      }

      _chunks = [];
      try {
        _rec = makeRecorder(stream);
      } catch (e) {
        // A microphone left open is a microphone still listening, in a room
        // with a patient in it. If the recorder will not start, close it.
        stream.getTracks().forEach(function (t) { t.stop(); });
        _rec = null;
        say(out, 'This phone will not record in a format the app can read. ' +
                 'Type it in.', 'warn');
        return;
      }
      // stop() clears _rec synchronously and onstop fires afterwards, so hold
      // on to the recorder here — it is the only thing that knows what format
      // it recorded in.
      var rec = _rec;
      _rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) _chunks.push(ev.data); };
      // A recorder can fail after it has started — the phone takes a call, the
      // WebView is pushed out of memory. Without this the button stays lit and
      // the clinician keeps talking into a recorder that stopped.
      _rec.onerror = function () {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        _rec = null;
        btn.classList.remove('on');
        liveOff();
        clearTimeout(_stopT);
        say(out, 'The recording stopped part way. Tap again and say it once ' +
                 'more, or type it in.', 'warn');
      };
      _rec.onstop = async function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        btn.classList.remove('on');
        liveOff();                       // the auto-stop timer comes here too
        // Labelled with what the phone REALLY produced — that label is what
        // the Edge Function passes to the recogniser as the Content-Type, and
        // announcing MP4 as WebM asks it to decode a container that is not
        // there.
        var blob = new Blob(_chunks, { type: recordedType(rec, _chunks) });
        // Two very different failures used to share one message. The level
        // meter has been measuring all along, so say which one it was.
        var loud = loudestHeard();
        if (!blob.size) {
          say(out, silentWhy(loud), 'warn');
          noteFault('mic-silent', silentWhy(loud));
          return;
        }
        // A recording that DID produce bytes but never rose above the noise
        // floor is a muted microphone, and sending it costs money to be told
        // nothing. 0.012 RMS is below a quiet room; ordinary speech at arm's
        // length measures 0.05–0.3. Trusted only when the meter actually ran —
        // on a WebView with no AudioContext the peak is zero because nothing
        // measured it, and refusing every recording there would be a worse
        // fault than the one this guards against.
        if (meterRan() && loud < 0.012) {
          say(out, silentWhy(loud), 'warn');
          noteFault('mic-silent', silentWhy(loud));
          return;
        }
        say(out, 'Reading it…');
        var text;
        try {
          text = await transcribe(blob, mode);
        } catch (e) {
          noteFault(e && e.kind, e && e.message);
          say(out, (e && e.message) ||
                   'Could not reach the dictation service. Type it in for now.',
              'warn');
          return;
        }
        // The rules answer now; the model, if it answers at all, answers into
        // the same two places a moment later. A fast model can beat the first
        // answer to the screen, so the later one is never overwritten by it.
        var refined = false;
        function show(res, isRefine) {
          if (refined && !isRefine) return;
          if (isRefine) refined = true;
          say(out, res.text, res.ok ? 'ok' : 'warn');
          // Everything that was captured, gathered at the top of the screen for
          // the clinician to check before anything is confirmed.
          if (typeof global._intakeCheck === 'function') {
            setTimeout(function () { global._intakeCheck(text); }, 320);
          }
        }
        // The words, before anything is filed, where they can be corrected.
        // Only for the consultation button: the vitals boxes are numbers the
        // clinician can see filled in directly, and a second confirmation
        // there would be a tap that buys nothing.
        if (mode === 'consult') showHeard(text, mode, show);
        show(await applied(mode, text, function (r) { show(r, true); }));
      };
      // A timeslice, not one blob at the end: if the WebView is pushed out of
      // the foreground mid-sentence, what was already said has been handed
      // over instead of being lost with the recorder.
      _rec.start(1000);
      btn.classList.add('on');
      liveOn(stream);
      say(out, mode === 'vitals'
        ? 'Listening — say the readings, then tap again.'
        : 'Listening — say who it is and what they came with, then tap again.');
      _stopT = setTimeout(stop, MAX_MS);
    });
  }

  var API = { parseVitals: parseVitals, parseStory: parseStory,
              parsePerson: parsePerson, applyConsult: applyConsult,
              lastFault: lastFault, noteFault: noteFault,
              digitsFromWords: digitsFromWords, RANGE: RANGE, attach: attach,
              dropPersonBits: dropPersonBits, joinSpelled: joinSpelled };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.HomattDictate = API;
})(typeof window !== 'undefined' ? window : globalThis);
