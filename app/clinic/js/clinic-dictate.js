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
  var AGE_BARE = /\baged\s+(\d{1,3})\b/i;

  var NAME_CUE = /\b(?:(?:her|his|the patient'?s?|patient)\s+name\s+is|name\s+is|named|called|this\s+is|patient\s+is)\s+([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,2})/i;

  function titleCase(s) {
    return String(s || '').trim().split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  // Words that follow a name cue but are plainly not a name.
  var NOT_A_NAME = /^(?:a|an|the|complaining|complains|here|with|for|not|and|his|her|male|female|man|woman|boy|girl|child|baby|patient|feeling|having)\b/i;

  /**
   * Read who the patient is out of a dictated sentence.
   * Returns { name, sex, age, ageUnit, heard } — only what was actually marked.
   */
  function parsePerson(spoken) {
    var text = digitsFromWords(String(spoken || ''));
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

    var m = AGE_M.exec(text);
    if (m && +m[1] > 0 && +m[1] <= 36) {
      out.age = m[1]; out.ageUnit = 'months';
    } else {
      m = AGE_Y.exec(text) || AGE_BARE.exec(text);
      if (m && +m[1] > 0 && +m[1] <= 120) { out.age = m[1]; out.ageUnit = 'years'; }
    }
    if (out.age) out.heard.push('Age: ' + out.age + ' ' + out.ageUnit);

    var n = NAME_CUE.exec(text);
    if (n && !NOT_A_NAME.test(n[1].trim())) {
      out.name = titleCase(n[1]);
      out.heard.push('Name: ' + out.name);
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
  var COMPLAINT_CUE = /\b(?:complain(?:s|ing|ed)?\s+of|complaint\s+(?:is|of)|presents?\s+with|presenting\s+with|came\s+(?:in\s+)?with|comes?\s+in\s+with|here\s+(?:for|with)|c\s*\/\s*o)\b\s*/i;

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
  var SYMPTOM = new RegExp('\\b(?:' + [
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
  ].join('|') + ')\\b', 'i');

  // The clinician's own denials, surfaced so their eye goes to them. A
  // recogniser that DROPS a "no" cannot be detected from the text it produced
  // — which is exactly why the transcript is shown back verbatim rather than
  // only the tidied result.
  var NEGATION = /\b(?:no|not|denies|denied|without|never)\s+((?:[a-z]+\s*){1,3})/gi;

  // What belongs in the background rather than in today's story: what they
  // already have, what they are already on, and who they are. A clinician says
  // these in the same breath as the complaint, so they arrive mixed in.
  var BACKGROUND_CUE = /\b(?:(?<!\bnot\s)known\b|is\s+a\s+known|history\s+of|past\s+history|family\s+history|previously\s+(?:treated|diagnosed)|already\s+on|currently\s+on|is\s+on\s+(?:treatment|medication|art|arvs?|insulin|metformin)|on\s+(?:art|arvs?|insulin|metformin|treatment for)|hiv\s*(?:positive|negative|\+ve)|diabetic|hypertensive|asthmatic|epileptic|pregnan\w+|breast\s*feeding|smok\w+|drinks?\s+alcohol|alcoholic|lives\s+(?:in|with|alone)|works?\s+as|farmer|market\s+vendor|boda)\b/i;

  // A clause that is nothing but "on <something>" is a medicine they are
  // already taking — "known heart problem, on furosemide". Tested on its own
  // because it is anchored to the whole clause, which the cue list above is
  // not.
  var BACKGROUND_CLAUSE =
    /^on\s+(?!and\b|the\b|an?\b|his\b|her\b|their\b|both\b|exam|palpation)[a-z][a-z-]*[,.;]?$/i;

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
    } else {
      // No cue, but the clinician opened on a symptom — "fever for three days
      // getting worse at night". That is a complaint followed by its story.
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
        complaint = tidy(after.slice(0, end));
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
    // A non-2xx arrives as r.error, but the function's own JSON — which says
    // WHICH fault it was — rides along in the context. Without reading it, an
    // exhausted account is indistinguishable from a dropped connection.
    if (r.error) {
      var body = null;
      try {
        if (r.error.context && typeof r.error.context.json === 'function') {
          body = await r.error.context.json();
        }
      } catch (e) {}
      // With no reply to read, the connection is the likeliest fault, and the
      // clinician needs the way round it in the same breath as the bad news —
      // a message that only says something failed leaves them tapping the
      // button again with a patient in front of them.
      var err = new Error((body && body.error) ||
        'Could not reach the dictation service. Type it in for now.');
      err.kind = (body && body.kind) || 'unreachable';
      throw err;
    }
    noteFault(null);
    return (r.data && r.data.text) || '';
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
    n += writeTo('itSubjective', chiefEmpty ? story.history : text, wrote);
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
    mode = (mode === 'story' || mode === 'consult') ? mode : 'vitals';

    btn.addEventListener('click', async function () {
      if (_rec) { stop(); btn.classList.remove('on'); say(out, 'Listening finished — reading it…'); return; }

      if (offline()) {
        say(out, 'Dictation needs a connection. Type the readings for now.', 'warn');
        return;
      }
      if (!navigator.mediaDevices || !global.MediaRecorder) {
        say(out, 'This phone cannot record audio. Type the readings.', 'warn');
        return;
      }

      var stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        say(out, 'The microphone is blocked. Allow it in the phone settings.', 'warn');
        return;
      }

      _chunks = [];
      _rec = new MediaRecorder(stream);
      _rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) _chunks.push(ev.data); };
      _rec.onstop = async function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        btn.classList.remove('on');
        var blob = new Blob(_chunks, { type: 'audio/webm' });
        if (!blob.size) { say(out, 'Nothing was recorded.', 'warn'); return; }
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
        show(await applied(mode, text, function (r) { show(r, true); }));
      };
      _rec.start();
      btn.classList.add('on');
      say(out, mode === 'vitals'
        ? 'Listening — say the readings, then tap again.'
        : 'Listening — say who it is and what they came with, then tap again.');
      _stopT = setTimeout(stop, MAX_MS);
    });
  }

  var API = { parseVitals: parseVitals, parseStory: parseStory,
              parsePerson: parsePerson, applyConsult: applyConsult,
              lastFault: lastFault, noteFault: noteFault,
              digitsFromWords: digitsFromWords, RANGE: RANGE, attach: attach };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.HomattDictate = API;
})(typeof window !== 'undefined' ? window : globalThis);
