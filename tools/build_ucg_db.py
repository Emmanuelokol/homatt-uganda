#!/usr/bin/env python3
"""
Build uganda_clinical_guidelines_2023.db from the converted UCG 2023 HTML.

Produces EXACTLY the schema documented in README.md so the app (and any other
tooling) works unchanged if the official .db is dropped in later:

  chapters(number, title)
  conditions(id, number, title, depth, chapter_number, chapter_title, icd10,
             page, causes, clinical_features, differential, investigations,
             management, prevention, complications, notes, full_text)
  treatments(id, condition_id, level_of_care, treatment, step_order)
  medicines(id, condition_id, name, dose, unit, route, frequency, duration, source_line)
  conditions_fts            -- FTS5 over title + parsed fields + full text
  v_medicines_normalized    -- medicines with case-normalized names
  v_condition_full          -- flattened condition view

Usage: python3 build_ucg_db.py <input.html> <output.db>
"""
import html
import os
import re
import sqlite3
import sys
from collections import Counter

# ── Text helpers ───────────────────────────────────────────────────────────
RUNNING_HEADER = {'uganda', 'clinical', 'guidelines', '2023', 'ministry of health'}
COMMON_WORDS = {
    'the', 'and', 'for', 'with', 'patient', 'treatment', 'give', 'dose', 'days',
    'blood', 'infection', 'management', 'clinical', 'features', 'signs', 'test',
    'child', 'children', 'adults', 'oral', 'daily', 'history', 'examination',
    'laboratory', 'investigations', 'prevention', 'health', 'visit', 'action',
}


def looks_english(s: str) -> bool:
    words = re.findall(r'[a-z]{3,}', s.lower())
    return any(w in COMMON_WORDS for w in words)


def maybe_unreverse(line: str) -> str:
    """The PDF→HTML conversion emitted some (rotated table) text backwards.
    Reverse a line only when doing so clearly turns gibberish into English."""
    s = line.strip()
    if len(s) < 4 or looks_english(s):
        return line
    rev = s[::-1]
    return rev if looks_english(rev) else line


CTRL_RE = re.compile('[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\ufeff\ufffd\ue000-\uf8ff]')


def clean_lines(raw_html: str):
    txt = html.unescape(re.sub(r'<[^>]+>', '\n', raw_html))
    txt = txt.replace('\xa0', ' ')
    # PDF bullet/glyph leftovers (\x89, PUA glyphs, zero-widths) render as tofu
    txt = CTRL_RE.sub(' ', txt)
    # words split across a line break by PDF hyphenation: 'contrain-\ndicated'
    txt = re.sub(r'(\w)-\n(\w)', r'\1\2', txt)
    return [l.strip() for l in txt.split('\n')]


# ── 1. Table of contents → chapters + conditions ───────────────────────────
TOC_RE = re.compile(r'^((?:\d+\.)+\d*|\d+)\s+(.{3,140}?)\s*\.{3,}\s*(\d{1,4})$')


def parse_toc(lines):
    seen, toc = set(), []
    for l in lines:
        m = TOC_RE.match(l)
        if not m:
            continue
        num = m.group(1).rstrip('.')
        title = re.sub(r'\s+', ' ', m.group(2)).strip(' .')
        page = int(m.group(3))
        if not title or num in seen:
            continue
        seen.add(num)
        toc.append({'number': num, 'title': title, 'page': page,
                    'depth': num.count('.') + 1})
    return toc


# ── 2. Body split into pages ───────────────────────────────────────────────
def parse_pages(lines):
    """Return {page_number: [lines]} using the running-header page markers."""
    marks = []
    for i, l in enumerate(lines):
        if re.fullmatch(r'\d{1,4}', l):
            nxt = ' '.join(lines[i + 1:i + 4]).lower()
            if 'uganda' in nxt and 'clinical' in nxt:
                marks.append((int(l), i))
    pages = {}
    for k, (pno, idx) in enumerate(marks):
        end = marks[k + 1][1] if k + 1 < len(marks) else len(lines)
        body = []
        for l in lines[idx + 1:end]:
            low = l.lower().strip()
            if not l or low in RUNNING_HEADER or re.fullmatch(r'chapter\s+\d+:?', low):
                continue
            body.append(maybe_unreverse(l))
        # The page's running header arrives as one word per line
        # ("CHAPTER / 1: / Emergencies / and / Trauma"). Drop that leading
        # fragment run so full_text starts at the real content.
        head_re = re.compile(r'^(?:chapter|\d+:?|[A-Za-z]{2,14}|and|of|the)$', re.I)
        k = 0
        while k < min(12, len(body)) and ' ' not in body[k] and len(body[k]) < 20:
            if any(rx.match(body[k]) for _, rx in FIELD_RES):
                break                      # never eat a real heading
            if not head_re.match(body[k]):
                break
            k += 1
        pages.setdefault(pno, []).extend(body[k:])
    return pages


# ── 3. Field splitting inside a condition's text ───────────────────────────
FIELD_PATTERNS = [
    ('causes',            r'^(?:causes?|aetiolog(?:y|ical\s+agents?)|cause\s*/\s*risk\s*factors?)\b'),
    ('clinical_features', r'^(?:clinical\s+features?|signs?\s+and\s+symptoms?|symptoms?\s+and\s+signs?|presentation)\b'),
    ('differential',      r'^(?:differential\s+diagnos[ei]s)\b'),
    ('investigations',    r'^(?:investigations?|laboratory\s+investigations?|diagnosis)\b'),
    ('management',        r'^(?:management|treatment(?:\s+loc)?|treatment\s+objectives?)\b'),
    ('prevention',        r'^(?:prevention(?:\s+and\s+control)?|health\s+education)\b'),
    ('complications',     r'^(?:complications?)\b'),
    ('notes',             r'^(?:notes?|caution|remember|important)\b'),
]
FIELD_RES = [(k, re.compile(p, re.I)) for k, p in FIELD_PATTERNS]


def split_fields(text_lines):
    """Split a condition's text into the UCG fields. A heading counts when the
    line IS the heading, or the line STARTS with it followed by ':' / '-' and
    the rest of the sentence (both shapes occur in the converted text)."""
    fields, current = {}, None
    for l in text_lines:
        stripped = l.strip(' :\u2022~-')
        head, rest = None, ''
        for key, rx in FIELD_RES:
            m = rx.match(stripped)
            if not m:
                continue
            tail = stripped[m.end():].lstrip()
            # heading alone, or "Heading: text…"
            if len(stripped) <= 60 or tail[:1] in {':', '-', '\u2013'}:
                head, rest = key, tail.lstrip(':-\u2013 ').strip()
                break
        if head:
            current = head
            fields.setdefault(current, [])
            if rest:
                fields[current].append(rest)
        elif current:
            fields[current].append(l)
    return {k: '\n'.join(v).strip() for k, v in fields.items() if ''.join(v).strip()}


# ── 4. Treatments (level of care) ──────────────────────────────────────────
LOC_RE = re.compile(r'\b(HC\s?[2-4]|RR|GH|NR|H\b)\b', re.I)


def norm_loc(tok: str):
    t = tok.upper().replace(' ', '')
    return t if t in {'HC2', 'HC3', 'HC4', 'RR', 'GH', 'NR', 'H'} else None


def parse_treatments(mgmt_text):
    """Each meaningful management line is a step; a level-of-care code on (or
    above) the line attributes it to that facility level. PDF line-wrapping is
    undone first so a step reads as one instruction, not three fragments."""
    BULLET = re.compile(r'^\s*(?:[•~\-\u2013\u2022\u25cf\u00b7]|\(?[a-z]\)|\d+[.)])\s+')
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
        line = line.strip(' \u2022~-\t')
        if len(line) < 6:
            continue
        found = [norm_loc(m.group(1)) for m in LOC_RE.finditer(line)]
        found = [f for f in found if f]
        if found:
            level = found[0]
            if len(re.sub(LOC_RE, '', line).strip(' :\u2013-')) < 6:
                continue          # a bare "HC3" header only sets the level
        order += 1
        out.append((level, line[:1000], order))
    return out


# ── 5. Medicines ───────────────────────────────────────────────────────────
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
LEADING_CONNECTOR = re.compile(r'^(?:plus|and|or|with|then|also|add|give|use)\s+', re.I)


def parse_medicines(text):
    seen, out = set(), []
    for line in (text or '').split('\n'):
        line = line.strip()
        if len(line) < 6 or len(line) > 300:
            continue
        for m in MED_RE.finditer(line):
            name = re.sub(r'\s+', ' ', m.group(1)).strip(' -/')
            name = LEADING_CONNECTOR.sub('', name).strip(' -/')
            if not name or len(name) < 4:
                continue
            first = name.split()[0]
            if first in STOP_WORDS or first.lower() in {w.lower() for w in STOP_WORDS}:
                continue
            # a real drug name starts with a letter and isn't a bare number/unit
            if not re.match(r'^[A-Za-z]', name):
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
                    if float(re.split(r'[-\u2013/]', dose)[0]) > 20:
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


# ── 6. ICD-10 ──────────────────────────────────────────────────────────────
ICD_RE = re.compile(r'\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b')


def find_icd10(text):
    hits = ICD_RE.findall(text or '')
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


def main(src, dst):
    raw = open(src, encoding='utf-8', errors='replace').read()
    lines = clean_lines(raw)
    toc = parse_toc(lines)
    pages = parse_pages(lines)
    print(f'  TOC entries      : {len(toc)}')
    print(f'  pages segmented  : {len(pages)}')

    chapters = {}
    for t in toc:
        if t['depth'] == 1:
            try:
                chapters[int(t['number'])] = t['title']
            except ValueError:
                pass
    conditions = [t for t in toc if t['depth'] >= 2]
    conditions.sort(key=lambda t: (t['page'], t['number']))

    if os.path.exists(dst):
        os.remove(dst)
    db = sqlite3.connect(dst)
    db.executescript(SCHEMA)

    db.executemany('INSERT INTO chapters(number,title) VALUES (?,?)',
                   sorted(chapters.items()))

    max_page = max(pages) if pages else 0
    n_tr = n_med = 0
    for i, c in enumerate(conditions):
        # text = this condition's page through the page before the next condition
        start = c['page']
        # Sections share pages: include the page the NEXT condition starts on,
        # otherwise a condition whose treatment table spills over is truncated
        # mid-sentence (this is what hid Pneumonia's whole management table).
        end = conditions[i + 1]['page'] if i + 1 < len(conditions) else min(start + 3, max_page)
        if end < start:
            end = start
        end = min(end, start + 12)          # guard against TOC gaps
        body = []
        for p in range(start, end + 1):
            body.extend(pages.get(p, []))
        full_text = '\n'.join(body).strip()

        f = split_fields(body)
        ch_no = int(c['number'].split('.')[0]) if c['number'].split('.')[0].isdigit() else None
        cur = db.execute(
            'INSERT INTO conditions(number,title,depth,chapter_number,chapter_title,'
            'icd10,page,causes,clinical_features,differential,investigations,'
            'management,prevention,complications,notes,full_text) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (c['number'], c['title'], c['depth'], ch_no, chapters.get(ch_no),
             find_icd10(full_text), c['page'],
             f.get('causes'), f.get('clinical_features'), f.get('differential'),
             f.get('investigations'), f.get('management'), f.get('prevention'),
             f.get('complications'), f.get('notes'), full_text))
        cid = cur.lastrowid

        mgmt = f.get('management') or ''
        if not mgmt:
            # No parsed Management block: recover the treatment table from the
            # raw text — start at the UCG "TREATMENT LOC" header when present,
            # else keep only lines carrying an explicit level-of-care code.
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

    print(f'  chapters         : {len(chapters)}')
    print(f'  conditions       : {len(conditions)}')
    print(f'  treatments       : {n_tr}')
    print(f'  medicines        : {n_med}')
    loc = db.execute('SELECT level_of_care, COUNT(*) FROM treatments '
                     'GROUP BY level_of_care ORDER BY 2 DESC').fetchall()
    print(f'  levels of care   : {loc[:8]}')
    filled = db.execute(
        'SELECT SUM(clinical_features IS NOT NULL), SUM(investigations IS NOT NULL), '
        'SUM(management IS NOT NULL), SUM(icd10 IS NOT NULL), '
        'SUM(length(full_text)>200) FROM conditions').fetchone()
    print(f'  parsed fields    : features={filled[0]} investigations={filled[1]} '
          f'management={filled[2]} icd10={filled[3]} full_text>200ch={filled[4]}')
    print(f'  file size        : {os.path.getsize(dst)/1024/1024:.2f} MB')
    db.close()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
