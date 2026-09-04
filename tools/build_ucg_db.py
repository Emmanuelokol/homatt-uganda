#!/usr/bin/env python3
"""
Build uganda_clinical_guidelines_2023.db from the converted UCG 2023 HTML.

Produces EXACTLY the schema the app reads, so a rebuild is a drop-in
replacement:

  chapters(number, title)
  conditions(id, number, title, depth, chapter_number, chapter_title, icd10,
             page, causes, clinical_features, differential, investigations,
             management, prevention, complications, notes, full_text)
  treatments(id, condition_id, level_of_care, treatment, step_order)
  medicines(id, condition_id, name, dose, unit, route, frequency, duration, source_line)
  conditions_fts            -- FTS5 over title + parsed fields + full text
  v_medicines_normalized    -- medicines with case-normalized names
  v_condition_full          -- flattened condition view

WHERE THE SECTIONS COME FROM
----------------------------
Earlier builds cut each condition out of the book by PAGE RANGE: a condition
began on the page the contents named and ended where the next condition's page
began.  A printed page carries the tail of one condition and the head of the
next, so roughly one condition in six inherited a neighbour's text.  Hairy
Leukoplakia described Kaposi's sarcoma, Painful Scrotal Swelling described
conjunctivitis, and Prostatitis described renal colic.  The same slicing chose
the icd10 code by taking the first ICD-shaped token on the page, which usually
belonged to whichever condition happened to be printed above.

This build cuts on the book's own headings instead (tools/ucg_spine.py), so a
section's text physically cannot cross into its neighbour, and reads the ICD
code from the heading line the code is actually printed on.

Usage: python3 build_ucg_db.py <input.html> <output.db>
"""
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ucg_clean
import ucg_fields
import ucg_spine


# ── Treatment steps ────────────────────────────────────────────────────────
LOC_RE = re.compile(r'\b(HC\s?[2-4]|RR|GH|NR|H\b)\b', re.I)


def norm_loc(tok: str):
    t = tok.upper().replace(' ', '')
    return t if t in {'HC2', 'HC3', 'HC4', 'RR', 'GH', 'NR', 'H'} else None


def parse_treatments(mgmt_text):
    """Each meaningful management line is a step; a level-of-care code on (or
    above) the line attributes it to that facility level. PDF line-wrapping is
    undone first so a step reads as one instruction, not three fragments."""
    BULLET = re.compile(r'^\s*(?:[•~\-–•●·]|\(?[a-z]\)|\d+[.)])\s+')
    STARTER = re.compile(r'^(give|start|treat|administer|continue|refer|admit|advise|'
                         r'monitor|check|apply|repeat|stop|avoid|use|do not|if |in |for |'
                         r'adults?|children?|first|second|alternative|note)\b', re.I)
    raw_lines = [l.rstrip() for l in (mgmt_text or '').split('\n')]
    merged, buf = [], ''
    for raw in raw_lines:
        line = raw.strip()
        if not line:
            continue
        new_step = bool(BULLET.match(raw)) or bool(STARTER.match(line)) or not buf
        # a continuation usually follows a line that did not end a sentence
        if buf and not new_step:
            buf = buf.rstrip('-') + (' ' if not buf.endswith('-') else '') + line
            continue
        if buf:
            merged.append(buf)
        buf = BULLET.sub('', raw).strip()
    if buf:
        merged.append(buf)

    out, level, order = [], None, 0
    for line in merged:
        line = line.strip(' •~-\t')
        if len(line) < 6:
            continue
        found = [norm_loc(m.group(1)) for m in LOC_RE.finditer(line)]
        found = [f for f in found if f]
        if found:
            level = found[0]
            if len(re.sub(LOC_RE, '', line).strip(' :–-')) < 6:
                continue          # a bare "HC3" header only sets the level
        order += 1
        out.append((level, line[:1000], order))
    return out


# ── Medicines ──────────────────────────────────────────────────────────────
# MU is mega-units, how the book doses benzylpenicillin ("3 MU every 6 hours");
# without it that drug is invisible. mmol, microgram spelled out, and the
# container words are here for the same reason.
UNIT = (r'(mg/kg/day|mg/kg|mcg/kg|micrograms?/kg|units?/kg|ml/kg|'
        r'mg|g|mcg|µg|micrograms?|ml|mL|litres?|IU|MU|mmol|units?|'
        r'drops?|puffs?|sachets?|tablets?|capsules?|ampoules?|vials?|%)(?![A-Za-z])')
DRUG = r'([A-Z][A-Za-z][A-Za-z\-/]+(?:\s+[A-Z]?[a-z\-/]+){0,3})'
# Thousands-grouped first ("500,000"), then a plain number which may use
# either separator for its decimal ("0.5", "0,5"). norm_dose settles which.
NUM = r'\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?'
MED_RE = re.compile(
    DRUG + r'[^\n]{0,40}?((?:' + NUM + r')(?:\s*[-–/]\s*(?:' + NUM + r'))?)\s*' + UNIT,
    re.UNICODE)
ROUTE_RE = re.compile(r'\b(IV|IM|PO|oral(?:ly)?|rectal(?:ly)?|topical(?:ly)?|SC|IO|inhal\w*|sublingual)\b', re.I)
FREQ_RE = re.compile(r'\b(once|twice|thrice|\d+\s*(?:times?|x))\s*(?:a|per)?\s*day\b|\b(?:od|bd|tds|qid|q\d+h|\d+\s*hourly|every\s+\d+\s*(?:hours?|hrs?))\b', re.I)
DUR_RE = re.compile(r'\bfor\s+(\d+(?:\s*[-–]\s*\d+)?)\s*(days?|weeks?|months?|years?|doses?)\b', re.I)
STOP_WORDS = {'The', 'This', 'If', 'In', 'Give', 'Do', 'For', 'All', 'Not', 'And',
              'Page', 'Note', 'Adults', 'Adult', 'Children', 'Child', 'Dose', 'Table',
              'Chapter', 'Neonates', 'Neonate', 'Infants', 'Infant', 'Patients',
              'Patient', 'Pregnant', 'Women', 'Weight', 'Age', 'Total', 'Maximum',
              'Repeat', 'Continue', 'Alternative', 'First', 'Second', 'Third', 'Then',
              'Treatment', 'Management', 'Duration', 'Follow', 'Refer', 'Severe', 'Mild'}
# A name the heuristic lifted straight out of an instruction: "Infiltrate 2 ml",
# "Start with 10 drops", "Toxic dose: >150 mg/kg". None of these is a medicine,
# and none is in the national list, so they are refused by their opening word.
NAME_NOT_DRUG = re.compile(
    r'^(infiltrate|instil|instill|apply|inject|dilute|start|stop|reduce|raise|'
    r'toxic|lethal|fatal|maximum|minimum|target|goal|therapeutic|initial|'
    r'loading|maintenance|standard|usual|normal|average|daily|weekly|hourly|'
    r'infuse|transfuse|titrate|administer|supply|deliver|measure|monitor)\b', re.I)
LEADING_CONNECTOR = re.compile(r'^(?:plus|and|or|with|then|also|add|give|use|dosage\s+of|dose\s+of|dosing\s+of|preparation\s+of|dilution\s+of)\s+', re.I)
# Clinical findings / vitals / lab readings get caught by the "name + number +
# unit" pattern ("Renal failure Urine output 12 ml"). They are NOT drugs and
# must never be offered as a prescription.
NON_DRUG = re.compile(
    r'\b(failure|output|pressure|rate|level|count|volume|weight|temperature|'
    r'saturation|h[ae]moglobin|score|index|status|deficit|intake|urine|stool|'
    r'glucose|sugar|haematocrit|hematocrit|circumference|diameter|size|'
    r'duration|interval|age|height|bmi|pulse|respiration|oxygen|dilution|preparation|administration)\b', re.I)

# A named derangement is a finding to act on, not a thing to prescribe:
# "Hypoglycaemia (Blood sugar <3 mmol/L or <54 mg/dL)" was becoming a medicine
# called Hypoglycaemia, dosed 3 mmol. Not one of the 750 medicines in the
# national list begins hypo- or hyper- or ends in -aemia, so this costs nothing.
DERANGEMENT = re.compile(r'^(hypo|hyper)|a?emia$', re.I)


# ── The national medicines list, used as a vocabulary ──────────────────────
# The old name pattern required a capital letter, because capitalisation was
# the cheap way to tell a drug from an ordinary word.  The book does not
# co-operate: it writes "Or erythromycin 500 mg", "plus metronidazole 500 mg
# IV", "Give an antipyretic: paracetamol 15 mg/kg".  Measured against the 750
# medicines of the Uganda Essential Medicines and Health Supplies List, the
# capitalisation rule found 49% of the drugs the guideline actually names.
#
# So the name is looked up in that list instead.  It is a better test in both
# directions: it finds a lowercase drug, and it cannot mistake "Renal failure
# Urine output 12 ml" for a prescription, because no such medicine exists.
EMHSLU_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         '..', 'app', 'clinic', 'data', 'emhslu_2023.db')

# Words that are medicines in the list but appear constantly in ordinary
# clinical prose.  Matching them by name alone would put a drug on a
# prescription every time the book mentioned a body fluid or a gas.
VOCAB_SKIP = {
    'water', 'oxygen', 'air', 'medical air', 'alcohol', 'blood', 'plasma',
    'compound', 'solution', 'powder', 'starch', 'talc', 'gas', 'urea', 'sugar',
    'glucose', 'sodium', 'potassium', 'calcium', 'iron', 'zinc oxide',
    'nitrous oxide', 'paraffin', 'gauze', 'cotton', 'salt', 'sugar solution',
}


# The staples of a Ugandan clinic, written the way the guideline writes them.
# The national list spells several of them so differently that a name lookup
# never meets them: it files normal saline under "Sodium chloride (Normal
# saline)", oral rehydration salts under "ORS/Zinc co-pack", and Ringer's
# lactate under "(Hartmann's/Ringer' s lactate IV" — with a stray space inside
# the word. These are too common to lose to a typesetting accident.
VOCAB_ALIASES = [
    'oral rehydration salts', 'ors', 'zinc sulphate', 'zinc',
    "ringer's lactate", 'ringers lactate', 'ringer lactate', "hartmann's",
    'hartmanns', 'normal saline', 'sodium chloride', 'dextrose',
    'water for injection', 'darrow', 'resomal',
]


def load_vocab(path=EMHSLU_DB):
    """Lower-cased medicine names from the national list, longest first."""
    names = set(VOCAB_ALIASES)
    try:
        db = sqlite3.connect(path)
        rows = db.execute("SELECT DISTINCT name FROM emhslu_items "
                          "WHERE item_type='medicine'").fetchall()
        db.close()
    except Exception:
        return sorted(names, key=len, reverse=True)
    for (raw,) in rows:
        n = re.sub(r'\s+', ' ', raw or '').strip()
        n = n.strip('()[]* ').replace('’', "'").replace("' s ", "'s ")
        # "Artemether/Lumefantrine, dispersible" -> the drug, not the form
        head = re.split(r'\s*[,(]', n)[0].strip().lower()
        if len(head) < 5 or head in VOCAB_SKIP:
            continue
        names.add(head)
        # The list joins a combination with " + ", the book with "/", and
        # neither spells it the other's way. Without both forms the full name
        # never matches and each half is found separately instead — which is
        # how one artemether/lumefantrine became two medicines.
        if re.search(r'\s*[/+]\s*', head):
            parts = [x.strip() for x in re.split(r'\s*[/+]\s*', head) if x.strip()]
            for sep in (' + ', '/', ' / ', '+'):
                names.add(sep.join(parts))
            # …and either half on its own, for when the book names just one
            for part in parts:
                if len(part) >= 6 and part not in VOCAB_SKIP:
                    names.add(part)
    return sorted(names, key=len, reverse=True)


_VOCAB = None
_VOCAB_RE = None


def vocab_re():
    global _VOCAB, _VOCAB_RE
    if _VOCAB_RE is None:
        _VOCAB = load_vocab()
        _VOCAB_RE = re.compile(
            r'(?<![A-Za-z])(' + '|'.join(re.escape(n) for n in _VOCAB) +
            r')(?![A-Za-z])', re.I) if _VOCAB else re.compile(r'(?!x)x')
    return _VOCAB_RE


# A dose sitting next to a name: "500 mg", "15 mg/kg", "3 MU", "0.9%".
DOSE_NEAR = re.compile(r'((?:' + NUM + r')(?:\s*[-–/]\s*(?:' + NUM + r'))?)\s*' + UNIT)


# Between a dose and the name it belongs to, the book writes nothing but a
# joining word: "100 ml/kg OF Ringer's Lactate", "2 ml of lignocaine".
DOSE_JOINER = re.compile(r'\s*(?:of|of the)?\s*', re.I)

# Reconstituting a drug is not prescribing one. Severe malaria's page explains
# how to make up IV artesunate — "pre-packed with sodium bicarbonate solution
# 1 ml", "dilute by adding 5 ml of sodium chloride" — and those became a
# bicarbonate and a saline on an ordinary malaria patient's prescription.
PREP_LINE = re.compile(
    r'\b(dilut\w*|reconstitut\w*|pre-?pack\w*|diluent|solvent|'
    r'obtaining a concentration|make up to|dissolve\w*)\b', re.I)


# "0,5 mg" is a decimal comma and becomes 0.5; "500,000 IU" is a thousands
# separator and must stay as it is. The difference is how many digits follow.
DECIMAL_COMMA = re.compile(r',(?=\d{1,2}(?!\d))')


def norm_dose(d):
    return DECIMAL_COMMA.sub('.', d or '')


def dose_for(name_start, name_end, line, nxt):
    """The dose belonging to a name: after it, then before it, then on the
    following line.

    After is the normal case ("paracetamol 15 mg/kg").  Before covers the
    book's other habit, "Give 100 ml/kg of Ringer's Lactate" — but only when
    nothing but a joining word separates the two.  Without that restriction
    "Repeat 20 ml/kg IV fluids and consider adrenaline" hands adrenaline the
    fluid's dose, which is the kind of mistake this parser exists to avoid.
    The following line covers a name that ran out of room, which is how zinc
    is printed: "give Zinc supplementation Child <6 months:" / "10 mg once a
    day".
    """
    m = DOSE_NEAR.search(line[name_end:name_end + 60])
    if m:
        return m.group(1), m.group(2), line

    head = line[:name_start]
    hits = list(DOSE_NEAR.finditer(head))
    if hits and DOSE_JOINER.fullmatch(head[hits[-1].end():]):
        return hits[-1].group(1), hits[-1].group(2), line

    if nxt:
        m = DOSE_NEAR.match(nxt.strip())
        if m:
            return m.group(1), m.group(2), line + ' ' + nxt.strip()
    return None, None, None


def parse_medicines(text):
    seen, out = set(), []
    for line in (text or '').split('\n'):
        line = line.strip()
        if len(line) < 6 or len(line) > 300:
            continue
        for m in MED_RE.finditer(line):
            name = re.sub(r'\s+', ' ', m.group(1)).strip(' -/')
            name = LEADING_CONNECTOR.sub('', name).strip(' -/')
            # "Hyperpyrexia Give paracetamol" → "paracetamol": the finding that
            # triggers the drug is not part of the drug's name.
            m2 = re.match(r'^[A-Z][A-Za-z/]+\s+(?:Give|Treat\s+with|Use)\s+(.+)$', name)
            if m2:
                name = m2.group(1).strip()
            if not name or len(name) < 4:
                continue
            # The heuristic below grabs up to four words, so it catches the
            # sentence around the drug as well as the drug: "Prednisolone is
            # given in", "Instil atropine eye drops", "Start with". When the
            # national list recognises a medicine inside that phrase, keep the
            # medicine and drop the sentence; when a multi-word phrase holds no
            # medicine at all, it was never a drug name.
            inner = vocab_re().search(name)
            if inner:
                name = inner.group(1)
            elif len(name.split()) >= 3 or NAME_NOT_DRUG.match(name):
                continue
            first = name.split()[0]
            if first in STOP_WORDS or first.lower() in {w.lower() for w in STOP_WORDS}:
                continue
            # "Give an antipyretic: paracetamol 15 mg/kg" was becoming a
            # medicine called "an antipyretic". A drug is never introduced by
            # an article, and a drug CLASS is not a drug — the vocabulary pass
            # below finds the real name on the same line.
            if re.match(r'^(an?|the|any|some|other|another)\b', name, re.I):
                continue
            if re.search(r'\b(antipyretics?|analgesics?|antibiotics?|antimalarials?|'
                         r'antiseptics?|antihistamines?|antiemetics?|laxatives?|'
                         r'anticonvulsants?|antifungals?|antivirals?|steroids?|'
                         r'bronchodilators?|vaccines?|supplements?|medicines?|drugs?)$',
                         name, re.I):
                continue
            # a real drug name starts with a letter and isn't a bare number/unit
            if not re.match(r'^[A-Za-z]', name):
                continue
            if NON_DRUG.search(name) or DERANGEMENT.search(name):
                continue
            dose, unit = norm_dose(m.group(2)), m.group(3)
            route = (ROUTE_RE.search(line) or [None])
            route = route.group(1).upper() if hasattr(route, 'group') else None
            freq = FREQ_RE.search(line)
            dur = DUR_RE.search(line)
            # "%" is a real drug strength (Sodium chloride 0.9%, Dextrose 5%)
            # but also matches oxygen-saturation targets (keep SpO2 > 94%).
            # Drug strengths are small; saturations are not.
            if unit == '%':
                try:
                    if float(re.split(r'[-–/]', dose)[0]) > 20:
                        continue
                except ValueError:
                    pass
                if re.search(r'oxygen|satur|spo2|cyanos|apnoe', line, re.I):
                    continue
            key = (name.lower(), dose, unit.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append((name, dose, unit,
                        route,
                        freq.group(0) if freq else None,
                        dur.group(0) if dur else None,
                        line[:500]))

    # Second pass: every medicine the national list knows, however the book
    # capitalised it.  This runs after the pattern above and only ADDS, so a
    # drug already found keeps exactly the name, dose and source line it had.
    rx = vocab_re()
    lines = [l.strip() for l in (text or '').split('\n')]
    for i, line in enumerate(lines):
        if len(line) < 6 or len(line) > 300:
            continue
        if PREP_LINE.search(line):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        for m in rx.finditer(line):
            name = m.group(1)
            dose, unit, src = dose_for(m.start(), m.end(), line, nxt)
            if not dose:
                continue          # named without a dose: not a prescription
            dose = norm_dose(dose)
            # The heuristic pass above refuses a percentage over 20 because it
            # cannot tell a drug strength from an oxygen saturation. Here the
            # name is already a medicine in the national list, so a percentage
            # is a strength — benzyl benzoate lotion really is 25%, hydrogen
            # peroxide 6%, halothane 100%. Only the wording is checked.
            if unit == '%' and re.search(r'oxygen|satur|spo2|cyanos|apnoe', line, re.I):
                continue
            key = (name.lower(), dose, unit.lower())
            if key in seen or any(k[0] == name.lower() for k in seen):
                continue
            seen.add(key)
            route = ROUTE_RE.search(src)
            freq = FREQ_RE.search(src)
            dur = DUR_RE.search(src)
            out.append((name, dose, unit,
                        route.group(1).upper() if route else None,
                        freq.group(0) if freq else None,
                        dur.group(0) if dur else None,
                        src[:500]))
    return out


# ── ICD-10 ─────────────────────────────────────────────────────────────────
# A real ICD-10 code is a letter (U excluded) then two digits, optionally a
# point and one or two more characters.  The code is taken only from the
# payload printed on the section's own heading line; nothing is inferred.  Six
# sections print their codes with the letter missing ("70.31, 70.11") and they
# are left empty rather than guessed at, because a wrong code travels onto
# forms, claims and returns and is worse than no code at all.
ICD_RE = re.compile(r'\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b')


def clean_icd(payload):
    hits = ICD_RE.findall(payload or '')
    return hits[0] if hits else None


# ── Build ──────────────────────────────────────────────────────────────────
SCHEMA = """
PRAGMA journal_mode=DELETE;
CREATE TABLE chapters (number INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE conditions (
  id INTEGER PRIMARY KEY, number TEXT, title TEXT, depth INTEGER,
  chapter_number INTEGER, chapter_title TEXT, icd10 TEXT, page INTEGER,
  causes TEXT, clinical_features TEXT, differential TEXT, investigations TEXT,
  management TEXT, prevention TEXT, complications TEXT, notes TEXT, full_text TEXT);
CREATE TABLE treatments (
  id INTEGER PRIMARY KEY, condition_id INTEGER REFERENCES conditions(id),
  level_of_care TEXT, treatment TEXT, step_order INTEGER);
CREATE TABLE medicines (
  id INTEGER PRIMARY KEY, condition_id INTEGER REFERENCES conditions(id),
  name TEXT, dose TEXT, unit TEXT, route TEXT, frequency TEXT, duration TEXT,
  source_line TEXT);
CREATE INDEX idx_tr_cond ON treatments(condition_id);
CREATE INDEX idx_tr_loc  ON treatments(level_of_care);
CREATE INDEX idx_med_cond ON medicines(condition_id);
CREATE INDEX idx_med_name ON medicines(name);
CREATE INDEX idx_cond_title ON conditions(title);
CREATE VIRTUAL TABLE conditions_fts USING fts5(
  title, number, chapter_title, clinical_features, investigations, management,
  full_text, content='conditions', content_rowid='id', tokenize="unicode61");
CREATE VIEW v_medicines_normalized AS
  SELECT m.*, lower(trim(m.name)) AS name_normalized FROM medicines m;
CREATE VIEW v_condition_full AS
  SELECT c.id, c.number, c.title, c.chapter_number, c.chapter_title, c.icd10, c.page,
         c.clinical_features, c.investigations, c.management, c.full_text,
         (SELECT COUNT(*) FROM treatments t WHERE t.condition_id=c.id) AS treatment_steps,
         (SELECT COUNT(*) FROM medicines m WHERE m.condition_id=c.id) AS medicine_count
  FROM conditions c;
"""


def book_order(number):
    """Sort key that puts 2.10 after 2.9 rather than after 2.1."""
    return [int(p) if p.isdigit() else 0 for p in number.split('.')]


# The book's back matter - appendices, references, the index - carries no
# heading the spine recognises, so without a stop the final section swallows all
# of it. "Techniques for Regional Anaesthesia" is eighteen lines of clinical
# text and was arriving with eight hundred, ending in a list of web addresses.
BACK_MATTER = re.compile(r'^(Appendix|Annex|References|Bibliography|Index)\b'
                         r'(\s+\d+)?\s*$', re.I)


def back_matter_start(lines, after):
    """The first line of the book's back matter, or len(lines)."""
    for i in range(after, len(lines)):
        if BACK_MATTER.match(lines[i].strip()):
            return i
    return len(lines)


def build_sections(lines):
    """Every section in the book, in printed order, with its line span."""
    toc = ucg_spine.parse_toc(lines)
    chapters = {int(n): e['title'] for n, e in toc.items()
                if e['depth'] == 1 and n.isdigit()}
    spine, unmatched = ucg_spine.resolve(lines, toc)
    orphans = ucg_spine.find_orphans(lines, spine)
    for o in orphans:
        spine[o['number']] = o

    seq = sorted(spine.values(), key=lambda v: v['line'])
    for a, b in zip(seq, seq[1:]):
        a['end'] = b['line']
    if seq:
        seq[-1]['end'] = back_matter_start(lines, seq[-1]['line'])
    return chapters, seq, unmatched, orphans


def main(src, dst):
    lines = ucg_spine.load_lines(src)
    chapters, seq, unmatched, orphans = build_sections(lines)
    drop = ucg_clean.furniture_mask(lines, chapters)
    pidx = ucg_clean.page_index(lines, chapters)

    print(f'  chapters         : {len(chapters)}')
    print(f'  sections         : {len(seq)}  ({len(orphans)} not listed in the contents)')
    print(f'  unmatched        : {len(unmatched)}')
    print(f'  furniture lines  : {len(drop)}')

    if os.path.exists(dst):
        os.remove(dst)
    db = sqlite3.connect(dst)
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO chapters(number,title) VALUES (?,?)',
                   sorted(chapters.items()))

    n_tr = n_med = n_icd = 0
    for v in seq:
        body = [lines[i] for i in range(v['line'] + 1, v['end']) if i not in drop]
        full_text = ucg_spine.dehyphenate('\n'.join(body)).strip()
        body = full_text.split('\n')

        # The definition paragraph the book prints before any header has no
        # column of its own.  It is not folded into notes: doing so would make
        # notes a thing that exists in two places at once, and full_text - which
        # the app already shows under "View source guideline text" - carries it
        # verbatim and in the right order.
        f, _lead = ucg_fields.split(body)

        ch_no = int(v['number'].split('.')[0]) if v['number'].split('.')[0].isdigit() else None
        icd = clean_icd(v.get('icd10')) or \
            clean_icd(ucg_spine.icd_below(lines, v['line']))
        if icd:
            n_icd += 1
        page = v.get('page') or ucg_clean.page_at(pidx, v['line'])

        cur = db.execute(
            'INSERT INTO conditions(number,title,depth,chapter_number,chapter_title,'
            'icd10,page,causes,clinical_features,differential,investigations,'
            'management,prevention,complications,notes,full_text) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (v['number'], v['title'], v['depth'], ch_no, chapters.get(ch_no),
             icd, page,
             f.get('causes'), f.get('clinical_features'), f.get('differential'),
             f.get('investigations'), f.get('management'), f.get('prevention'),
             f.get('complications'), f.get('notes'), full_text))
        cid = cur.lastrowid

        mgmt = f.get('management') or ''
        if not mgmt:
            # No parsed Management block: recover the treatment table from the
            # section's own text — start at the UCG "TREATMENT LOC" header when
            # present, else keep only lines carrying a level-of-care code.
            m = re.search(r'treatment\s+loc', full_text, re.I)
            if m:
                mgmt = full_text[m.end():]
            else:
                mgmt = '\n'.join(l for l in body if LOC_RE.search(l))
        steps = parse_treatments(mgmt)
        if steps:
            db.executemany(
                'INSERT INTO treatments(condition_id,level_of_care,treatment,step_order) '
                'VALUES (?,?,?,?)', [(cid, a, b, o) for a, b, o in steps])
            n_tr += len(steps)

        meds = parse_medicines(mgmt + '\n' + full_text)
        if meds:
            db.executemany(
                'INSERT INTO medicines(condition_id,name,dose,unit,route,frequency,'
                'duration,source_line) VALUES (?,?,?,?,?,?,?,?)',
                [(cid,) + m for m in meds])
            n_med += len(meds)

    db.execute("INSERT INTO conditions_fts(rowid,title,number,chapter_title,"
               "clinical_features,investigations,management,full_text) "
               "SELECT id,title,number,chapter_title,clinical_features,"
               "investigations,management,full_text FROM conditions")
    db.commit()
    db.execute('VACUUM')
    db.commit()

    print(f'  treatment steps  : {n_tr}')
    print(f'  medicine rows    : {n_med}')
    print(f'  ICD-10 codes     : {n_icd}')
    print(f'  wrote            : {dst} ({os.path.getsize(dst)/1e6:.1f} MB)')
    db.close()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
