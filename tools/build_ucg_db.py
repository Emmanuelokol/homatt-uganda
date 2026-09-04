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
UNIT = r'(mg|g|mcg|µg|ml|mL|IU|units?|%)'
DRUG = r'([A-Z][A-Za-z][A-Za-z\-/]+(?:\s+[A-Z]?[a-z\-/]+){0,3})'
MED_RE = re.compile(
    DRUG + r'[^\n]{0,40}?(\d+(?:[.,]\d+)?(?:\s*[-–/]\s*\d+(?:[.,]\d+)?)?)\s*' + UNIT,
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
LEADING_CONNECTOR = re.compile(r'^(?:plus|and|or|with|then|also|add|give|use|dosage\s+of|dose\s+of|dosing\s+of|preparation\s+of|dilution\s+of)\s+', re.I)
# Clinical findings / vitals / lab readings get caught by the "name + number +
# unit" pattern ("Renal failure Urine output 12 ml"). They are NOT drugs and
# must never be offered as a prescription.
NON_DRUG = re.compile(
    r'\b(failure|output|pressure|rate|level|count|volume|weight|temperature|'
    r'saturation|h[ae]moglobin|score|index|status|deficit|intake|urine|stool|'
    r'glucose|sugar|haematocrit|hematocrit|circumference|diameter|size|'
    r'duration|interval|age|height|bmi|pulse|respiration|oxygen|dilution|preparation|administration)\b', re.I)


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
            first = name.split()[0]
            if first in STOP_WORDS or first.lower() in {w.lower() for w in STOP_WORDS}:
                continue
            # a real drug name starts with a letter and isn't a bare number/unit
            if not re.match(r'^[A-Za-z]', name):
                continue
            if NON_DRUG.search(name):
                continue
            dose, unit = m.group(2).replace(',', '.'), m.group(3)
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
