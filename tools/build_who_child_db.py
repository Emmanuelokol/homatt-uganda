#!/usr/bin/env python3
"""
Build who_child_2023.db — WHO "Pocket book of primary health care for children
and adolescents" (WHO Regional Office for Europe, ISBN 978-92-890-5762-2).

WHY A SECOND GUIDELINE DATABASE
-------------------------------
The Uganda Clinical Guidelines 2023 are the national standard, but they are
written for the whole population. This book is paediatric: everything in it is
dosed per kilogram of body weight, and it carries the weight-band dosing tables
a clinic actually needs when a sick child is in front of them.

Both databases sit side by side. Nothing here replaces the UCG.

SCHEMA (deliberately close to uganda_clinical_guidelines_2023.db so the app's
existing query patterns transfer unchanged)

  meta(key, value)                     provenance: source file, sha256, counts
  chapters(number, title)
  conditions(id, number, title, depth, chapter_number, chapter_title, page,
             age_group, definition, causes, history, examination,
             clinical_features, differential, investigations, diagnosis,
             management, treatment, referral, follow_up, prevention,
             counselling, complications, monitoring, red_flags, cautions,
             notes, full_text)
  tables(id, condition_id, number, caption, header, body_md)
  medicines(id, condition_id, name, dose, unit, per_kg, route, frequency,
            duration, source_line)
  drugs(id, name, name_normalized, indication, dosage, formulation,
        source_table, source_caption)
  drug_doses(id, drug_id, band_order, band, dose)
  conditions_fts / drugs_fts
  v_condition_full / v_drug_full

TWO RULES THIS BUILDER KEEPS, BECAUSE THIS IS A DOSING REFERENCE
----------------------------------------------------------------
1. Nothing is invented. Every cell of every dosing table is stored exactly as
   the book prints it. Where the PDF stacked several formulations into one
   cell ("5 mL  1/2  -"), the stack is kept whole rather than guessed apart —
   a wrongly split paediatric dose is a poisoning.
2. Nothing safety-critical is dropped. The book's "DO NOT" warnings and RED
   FLAGS are pulled into their own columns so the app can always show them.

Usage: python3 build_who_child_db.py <input.md> <output.db>
"""
import hashlib
import os
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone

# ── Text cleaning ──────────────────────────────────────────────────────────
# The PDF's bullets did not survive conversion. They are still in the file, as
# a stray control byte (\x84 — 2197 of them), a cent sign, and a lone letter
# "u" (a Wingdings arrow the converter read as a letter). Restoring them is
# what turns "History of previous episodes Vaccination status Fever Cough"
# back into four separate findings instead of one run-on sentence.
BULLETS = re.compile('[\x84\xa2\x95●]')
WINGDING_U = re.compile(r'(?<![A-Za-z])u (?=[A-Z(])')
# Private-use glyphs are dead bullets/arrows left by the PDF conversion.
PUA = re.compile(r'[-�]')
BOOK_TITLE = 'primary health care for children and adolescents'


def clean(s: str) -> str:
    s = s.replace('\xa0', ' ')
    s = BULLETS.sub(' • ', s)
    s = WINGDING_U.sub('• ', s)
    s = PUA.sub(' ', s)
    return re.sub(r'[ \t]{2,}', ' ', s)


def dropcap(title: str) -> str:
    """The PDF's drop capitals landed at the end of the line:
    'he role of the primary health care provider T' -> 'The role of the …'."""
    m = re.match(r'^([a-z].*?)\s+([A-Z])$', title.strip())
    return (m.group(2) + m.group(1)) if m else title.strip()


def unwrap_prose_rows(lines):
    """Some pages were laid out in two columns, and the converter turned the
    running prose into one-cell table rows:

        |Acute external otitis, also known as swimmer's ear, is a diffuse…|||

    That is a paragraph, not data. Left as a table row it would be skipped
    when the section text is gathered, and the clinical description would
    simply vanish from the section. A row with one filled cell and a sentence
    in it is put back to being a sentence."""
    out = []
    for l in lines:
        s = l.strip()
        if s.startswith('|') and not SEP_ROW.match(s):
            filled = [c for c in cells(s) if c.strip()]
            if len(filled) == 1 and len(filled[0]) > 60:
                out.append(filled[0])
                continue
        out.append(l)
    return out


def norm(s: str) -> str:
    """Comparison key: markup and punctuation removed, lowercased."""
    s = unicodedata.normalize('NFKD', str(s or '').lower())
    s = re.sub(r'[*_<>–—]', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def bulletise(text: str) -> str:
    """Put every restored bullet on its own line. A clinician reading a phone
    screen needs a list of findings, not a paragraph with dots in it."""
    out = []
    for line in text.split('\n'):
        if line.lstrip().startswith('|') or '•' not in line:
            out.append(line.strip())
            continue
        parts = [p.strip(' •\t') for p in line.split('•')]
        parts = [p for p in parts if p]
        if not parts:
            continue
        first = parts[0]
        rest = parts[1:]
        # A line that opens with a bullet has no lead-in sentence.
        if line.lstrip().startswith('•'):
            out.extend('• ' + p for p in parts)
        else:
            out.append(first)
            out.extend('• ' + p for p in rest)
    return '\n'.join(out)


# ── 1. Table of contents ───────────────────────────────────────────────────
TOC_NUM = re.compile(r'^(\d+(?:\.\d+)*)\.?\s+(.+?)\s*\t\s*(\d{1,4})$')
# Some chapters print their contents as a table instead:
#   |6.2.1|Otalgia (ear pain)|208|
# Missing these loses every sub-section of the biggest chapter in the book.
TOC_ROW = re.compile(r'^\|\s*(\d+(?:\.\d+)+)\s*\|\s*([^|]{3,110}?)\s*\|\s*'
                     r'(\d{1,4})(?:\s+\d{1,4})*\s*\|?\s*$')
TOC_UNNUM = re.compile(r'^([A-Z(][^\t]{2,90}?)\s*\t\s*(\d{1,4})$')
NUM_ONLY = re.compile(r'^(\d+(?:\.\d+)*)\.?\s+(.+?)$')


def parse_toc(lines):
    """Returns (numbered, unnumbered). The main contents comes first, so the
    first sighting of a number wins and the per-chapter mini-contents that
    repeat later are ignored."""
    numbered, unnumbered, seen = {}, [], set()
    for i, raw in enumerate(lines):
        s = raw.strip()
        mr = TOC_ROW.match(s)
        if mr:
            num = mr.group(1)
            if num not in seen:
                seen.add(num)
                numbered[num] = {'number': num, 'title': dropcap(mr.group(2).strip()),
                                 'page': int(mr.group(3)), 'toc_line': i}
            continue
        m = TOC_NUM.match(s)
        if not m:
            # A long contents title wraps: '1.2.1 WHO quality of care …young'
            # on one line, 'adolescents<TAB>3' on the next.
            nm = NUM_ONLY.match(s)
            if nm and '\t' not in s and i + 1 < len(lines):
                nxt = lines[i + 1].strip()
                m2 = TOC_UNNUM.match(nxt) or re.match(r'^([a-z][^\t]{2,90}?)\s*\t\s*(\d{1,4})$', nxt)
                if m2:
                    m = re.match(r'^(\d+(?:\.\d+)*)\.?\s+(.+)$',
                                 nm.group(1) + ' ' + nm.group(2) + ' ' + m2.group(1))
                    if m:
                        num, title, page = m.group(1), m.group(2), int(m2.group(2))
                        if num not in seen:
                            seen.add(num)
                            numbered[num] = {'number': num, 'title': dropcap(title),
                                             'page': page, 'toc_line': i}
                    continue
            if m is None:
                mu = TOC_UNNUM.match(s)
                if mu:
                    t = dropcap(mu.group(1).strip())
                    # Drop continuation fragments and pure cross-references.
                    if len(t) > 3 and not t.endswith(('and', 'or', 'the', 'of', 'in', 'with')):
                        unnumbered.append({'title': t, 'page': int(mu.group(2)),
                                           'toc_line': i})
                continue
        if m:
            num, title, page = m.group(1), dropcap(m.group(2).strip()), int(m.group(3))
            if num in seen:
                continue
            seen.add(num)
            numbered[num] = {'number': num, 'title': title, 'page': page, 'toc_line': i}
    return numbered, unnumbered


# ── 2. Anchoring each section in the body ──────────────────────────────────
def strip_markup(line: str) -> str:
    s = re.sub(r'^[#*_\s]+', '', line)
    return re.sub(r'</?u>', '', s)


# A contents entry is a title that ends in a page number and nothing else.
# Each chapter reprints its own little contents list before the text, in three
# different shapes, and anchoring to one of those instead of the real heading
# leaves a section with no text at all — which is what happened to the whole of
# Chapter 4 until this caught it.
TOC_TAB = re.compile(r'\t\s*\d{1,4}\s*$')
TOC_BOLD = re.compile(r'^\*{2}\s*\d+(?:\.\d+)*\s+.{3,110}?\s+\d{1,4}\s*\*{2}$')
TOC_PLAIN = re.compile(r'^\d+(?:\.\d+)*\s+[A-Z(].{2,110}?\s+\d{1,4}$')


def is_toc_line(line: str) -> bool:
    s = line.strip()
    return bool(TOC_TAB.search(s) or TOC_BOLD.match(s) or TOC_PLAIN.match(s))


def find_anchor(lines, start, number, title, stop=None):
    """First body line that opens this section, at or after `start`.

    Most body headings are not on a line of their own — the conversion glued
    each heading to the paragraph that follows it ('6.1.3 Pneumonia Pneumonia
    is a lower airway infection…') — so the match is on how a line BEGINS.
    Some headings ARE alone on their line, though (the emergency procedures:
    'How to give oxygen', 'Giving chest compressions'), so those count too."""
    key = norm(title)[:24]
    pat_num = re.compile(r'^' + re.escape(number) + r'[.\s]') if number else None
    best_num_only = None
    end = len(lines) if stop is None else min(stop, len(lines))
    for i in range(start, end):
        raw = lines[i]
        if raw.lstrip().startswith('|') or is_toc_line(raw):
            continue
        s = strip_markup(raw)
        if pat_num:
            if not pat_num.match(s):
                continue
            rest = norm(s[len(number):])
            if key and rest.startswith(key[:min(len(key), 18)]):
                return i
            if best_num_only is None:
                best_num_only = i          # right number, retitled in the body
        else:
            if norm(s).startswith(key):
                return i
    return best_num_only


# ── 3. Field splitting on the book's inline bold headings ──────────────────
FIELDS = [
    ('definition',        r'definition'),
    ('causes',            r'causes?|aetiolog\w*|risk factors?'),
    ('history',           r'history(?: and examination)?|history taking'),
    ('examination',       r'examination|physical examination|assessment'),
    ('clinical_features', r'clinical features?|signs? and symptoms?|symptoms?(?: and signs?)?|presentation'),
    ('differential',      r'differential diagnos[ei]s'),
    ('investigations',    r'investigations?|laboratory (?:tests?|investigations?)|tests?'),
    ('diagnosis',         r'diagnosis|diagnostic criteria'),
    ('management',        r'management'),
    ('treatment',         r'treatment(?: and referral)?|treatment and care'),
    ('referral',          r'referral|refer(?:ral)? to hospital|when to refer|treatment and referral'),
    ('follow_up',         r'follow-?up(?: care)?|monitoring and follow-?up'),
    ('prevention',        r'prevention(?: and control)?|prophylaxis'),
    ('counselling',       r'counselling(?: and support)?|advice to (?:parents|caregivers)|health education'),
    ('complications',     r'complications?'),
    ('monitoring',        r'monitoring'),
    ('red_flags',         r'red flags?'),
    ('notes',             r'notes?|caution|important|remember'),
]
FIELD_RES = [(k, re.compile(r'^(?:' + p + r')\s*:?$', re.I)) for k, p in FIELDS]
BOLD = re.compile(r'\*\*([^*\n]{2,42}?)\*\*')


def field_key(label: str):
    lab = label.strip().strip(':').strip()
    for key, rx in FIELD_RES:
        if rx.match(lab):
            return key
    return None


def split_fields(text: str):
    """The book marks its sections with inline bold — '**History** …
    **Examination** …' — often several inside one very long line."""
    fields, cur, buf = {}, None, []
    pos, out = 0, []
    for m in BOLD.finditer(text):
        key = field_key(m.group(1))
        if not key:
            continue
        out.append((m.start(), m.end(), key))
    if not out:
        return {}
    for idx, (s, e, key) in enumerate(out):
        end = out[idx + 1][0] if idx + 1 < len(out) else len(text)
        body = text[e:end].strip(' :\n–-')
        if not body:
            continue
        fields.setdefault(key, []).append(body)
    return {k: bulletise('\n'.join(v)).strip() for k, v in fields.items() if ''.join(v).strip()}


# ── 4. Safety text: the book's DO NOT warnings ─────────────────────────────
DONT = re.compile(r'\*\*DO NOT\*\*|\bDO NOT\b')


def cautions(text: str):
    """Every DO NOT warning the book prints, from the words 'DO NOT' to the end
    of that instruction. These are the lines that stop a clinician giving a
    harmful drug, so they are lifted into their own column and never left to
    chance inside a section the app might not render."""
    hits, seen = [], set()
    plain = re.sub(r'\*+', '', text or '')
    for m in re.finditer(r'DO NOT\b', plain):
        tail = plain[m.start():m.start() + 400]
        # Stop at the end of the instruction: a full stop, or the next bullet.
        cut = re.search(r'(?<=[a-z0-9)])\.(?=\s|$)|\n', tail)
        s = re.sub(r'\s+', ' ', tail[:cut.end()] if cut else tail).strip()
        if len(s) < 15:
            continue
        k = norm(s)[:70]
        if k in seen:
            continue
        seen.add(k)
        hits.append(s)
    return '\n'.join('• ' + h for h in hits[:12]) or None


# ── 5. Medicines named inside a section ────────────────────────────────────
# A drug name may end in a single capital — Vitamin K, Vitamin D, Penicillin V
# — so that letter is part of the name, not the start of the next word.
_DRUG = (r"([A-Z][A-Za-z][A-Za-z\-/'’]{2,}(?:\s+[a-z\-/'’]+){0,2}"
         r"(?:\s+[A-Z](?![A-Za-z]))?)")
PERKG = re.compile(
    _DRUG + r'[^.\n]{0,60}?'
    r'(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*'
    r'(mg|g|mcg|μg|IU|mL|ml)\s*/\s*kg', re.UNICODE)
PLAIN = re.compile(
    _DRUG + r'[^.\n]{0,40}?'
    r'(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*'
    r'(mg|g|mcg|μg|IU|mL|ml)\b', re.UNICODE)
# "nystatin gel (100 000 U/mL) OR miconazole gel (20 g/mL)" — one sentence,
# two drugs. If an 'or'/'and' sits between the name and the number, the number
# belongs to the other drug. Filing it under this one would be a real error.
GAP_BREAK = re.compile(r'\b(or|and|alternatively|instead)\b', re.I)
# A second drug name between this one and the number means the number is that
# other drug's. "Adrenaline (see epinephrine) Cefotaxime 50 mg/kg" is one line
# of a table; filing 50 mg/kg under Adrenaline would be a fivefold overdose.
GAP_OTHER_DRUG = re.compile(r'\b[A-Z][a-z]{4,}')
TRAILING_FILLER = re.compile(
    r'\s+(?:at|of|to|in|for|with|and|or|the|a|is|as|'
    r'orally|rectally|rectallya|topically|slow|nasal|buccal|deep)$', re.I)
ROUTE = re.compile(r'\b(IV|IM|PO|oral(?:ly)?|rectal(?:ly)?|topical(?:ly)?|SC|IO|'
                   r'inhal\w*|nebuli[sz]\w*|sublingual|intranasal)\b', re.I)
FREQ = re.compile(r'\b(once|twice|three times|four times|\d+\s*times?)\s*(?:a|per)\s*day\b|'
                  r'\bevery\s+\d+\s*(?:h|hours?)\b|\bat bedtime\b|\bsingle dose\b', re.I)
DUR = re.compile(r'\bfor\s+(\d+(?:\s*[-–]\s*\d+)?)\s*(days?|weeks?|months?|doses?)\b', re.I)
NOT_A_DRUG = re.compile(
    r'\b(weight|height|length|circumference|pressure|rate|output|intake|level|'
    r'count|volume|score|temperature|saturation|h[ae]moglobin|glucose|sodium level|'
    r'age|dose|dosage|table|figure|chapter|page|max|maximum|minimum|total|'
    r'concentration|density|index|interval|duration|size|diameter|birth)\b', re.I)
STOP = {'the', 'this', 'if', 'in', 'give', 'do', 'for', 'all', 'not', 'and', 'or',
        'note', 'adults', 'adult', 'children', 'child', 'infant', 'infants',
        'newborn', 'newborns', 'adolescent', 'adolescents', 'table', 'figure',
        'chapter', 'page', 'dose', 'doses', 'dosage', 'treatment', 'management',
        'use', 'used', 'using', 'when', 'with', 'without', 'after', 'before',
        'severe', 'mild', 'moderate', 'acute', 'chronic', 'first', 'second',
        'start', 'continue', 'repeat', 'consider', 'refer', 'check', 'monitor',
        'weight', 'body', 'each', 'every', 'per', 'total', 'maximum', 'minimum'}
LEAD = re.compile(r'^(?:give|start|use|add|then|plus|and|or|with|consider|'
                  r'treat|administer|oral|orally|IV|IM|SC|rectal|rectally|'
                  r'topical|nebuli[sz]ed|inhaled|intranasal)\b\s*', re.I)


def load_emhslu_tokens(emhslu_path):
    """A name only counts as a medicine if it is one.

    The regexes below find "<Capitalised words> <number> <unit>", which is the
    shape of a drug instruction — and also the shape of "Renal failure urine
    output 12 mL". So every candidate is checked against a real medicines list:
    the 750 medicines of Uganda's EMHSLU 2023, already bundled with this app.
    That list is also what tells a wrapped table row ('penicillin') apart from
    a new drug entry."""
    vocab = set()
    if emhslu_path and os.path.exists(emhslu_path):
        try:
            src = sqlite3.connect(emhslu_path)
            for (nm,) in src.execute(
                    "SELECT name FROM emhslu_items WHERE item_type='medicine'"):
                low = (nm or '').lower()
                vocab.add(re.sub(r'[^a-z]', '', low))
                for tok in re.split(r'[^A-Za-z]+', low):
                    if len(tok) >= 4:
                        vocab.add(tok)
            src.close()
        except sqlite3.Error as e:
            print(f'  ! EMHSLU vocabulary unavailable ({e}); falling back to '
                  f'drug-name endings only')
    return vocab - STOP


def with_annex(vocab, annex_names):
    out = set(vocab)
    for n in annex_names:
        for tok in re.split(r'[^A-Za-z]+', n.lower()):
            if len(tok) >= 4:
                out.add(tok)
    return out - STOP


def parse_medicines(text: str, vocab):
    seen, out = set(), []
    plain = re.sub(r'\*+', '', text or '')
    for line in plain.split('\n'):
        line = line.strip()
        if len(line) < 8 or len(line) > 400:
            continue
        for per_kg, rx in ((1, PERKG), (0, PLAIN)):
            for m in rx.finditer(line):
                gap = line[m.end(1):m.start(2)]
                if GAP_BREAK.search(gap) or GAP_OTHER_DRUG.search(gap):
                    continue
                name = re.sub(r'\s+', ' ', m.group(1)).strip(' -/')
                # "Treat with oral metronidazole" — peel every lead-in word,
                # not just the first. What is left must be the drug itself.
                for _ in range(4):
                    stripped = LEAD.sub('', name).strip(' -/')
                    if stripped == name:
                        break
                    name = stripped
                for _ in range(3):
                    trimmed = TRAILING_FILLER.sub('', name).strip(' -/')
                    if trimmed == name:
                        break
                    name = trimmed
                if len(name) < 4 or not re.match(r'^[A-Za-z]', name):
                    continue
                if name.split()[0].lower() in STOP or NOT_A_DRUG.search(name):
                    continue
                head = re.split(r'[^A-Za-z]+', name.lower())[0]
                if head not in vocab:
                    continue
                dose, unit = m.group(2).replace(',', '.'), m.group(3)
                key = (name.lower(), dose, unit.lower(), per_kg)
                if key in seen:
                    continue
                # A per-kg hit always beats the same drug found without /kg.
                if per_kg == 0 and (name.lower(), dose, unit.lower(), 1) in seen:
                    continue
                seen.add(key)
                r = ROUTE.search(line)
                f = FREQ.search(line)
                d = DUR.search(line)
                out.append((name, dose, unit, per_kg,
                            r.group(1).upper() if r else None,
                            f.group(0) if f else None,
                            d.group(0) if d else None,
                            line[:400]))
    return out[:60]


# ── 6. Tables — kept verbatim ──────────────────────────────────────────────
CAPTION = re.compile(r'^\*{2,3}\s*(Table\s*(\d+)[.\s]*)(.*?)\*{2,3}\s*$')


def collect_tables(lines):
    """Every markdown table, with the caption that introduces it. Stored as the
    book prints it: this is the dosing reference, so it is never reflowed.

    A caption only counts for the table right below it. A long table breaks
    across pages into several blocks, and letting the caption drift would put
    'Table 137. Drugs and dosages' on top of an unrelated table further down."""
    out, i = [], 0
    caption, number, caption_line = None, None, -99
    while i < len(lines):
        s = lines[i].strip()
        m = CAPTION.match(s)
        if m:
            number = int(m.group(2))
            caption = re.sub(r'\s+', ' ', (m.group(1) + m.group(3))).strip()
            caption_line = i
            i += 1
            continue
        if s.startswith('|'):
            start = i
            block = []
            while i < len(lines) and (lines[i].strip().startswith('|') or
                                      (not lines[i].strip() and
                                       i + 1 < len(lines) and lines[i + 1].strip().startswith('|'))):
                if lines[i].strip():
                    block.append(lines[i].rstrip())
                i += 1
            if len(block) >= 2:
                near = (start - caption_line) <= 8
                out.append({'line': start, 'end_line': i,
                            'number': number if near else None,
                            'caption': caption if near else None,
                            'header': block[0], 'body_md': '\n'.join(block)})
            continue
        i += 1
    return out


# ── 7. The drug annex: weight-band dosing tables ───────────────────────────
BAND_HEADER = re.compile(r'^\|\s*Drug\s*\|', re.I)
SEP_ROW = re.compile(r'^\|[\s\-:|]+\|$')


def cells(row: str):
    r = row.strip()
    if r.startswith('|'):
        r = r[1:]
    if r.endswith('|'):
        r = r[:-1]
    return [c.strip() for c in r.split('|')]


def is_dosing_header(row: str) -> bool:
    """A real dosing table opens 'Drug | Dosage | Formulation | <weight bands>'
    (or Form / Frequency for the topical tables). Matching on the HEADER, not
    on the caption, matters twice over: a long table breaks across pages and
    only the first block keeps its caption, and captions like 'Antiepileptic
    drugs and side-effects' would otherwise drag a side-effect list into the
    dosing reference."""
    c = cells(row)
    if len(c) < 3:
        return False
    first = norm(c[0])
    second = norm(c[1])
    return first.startswith('drug') and second in (
        'dosage', 'form', 'formulation', 'dosage form', 'dose')


# A weight band is a real range: "3– < 6 kg", "4–12 months".
BAND_LIKE = re.compile(r'\d\s*[–\-]\s*<?\s*\d|\bAdult\b')
# A wrapped tail begins mid-word or mid-sentence: lowercase, a bracket, a
# digit, or a page cross-reference.
TAIL_HEAD = re.compile(r'^(?:[a-z]|\(|\d|p\.\s*\d)')


def is_continuation(name: str, parent_name) -> bool:
    """Is the first cell of this row the tail of the row above?

    The PDF wrapped long cells and the converter turned every wrapped LINE into
    its own table row, so 'Benzylpenicillin' arrives as a row named 'Benzyl'
    followed by a row named 'penicillin' — each carrying half the real dosing
    data. Those tails must be reattached, never dropped: they hold doses.

    The test is how the book prints, not a list of known drugs. Every drug name
    in the annex is capitalised; a wrapped tail is not. Guessing from a
    vocabulary instead would quietly swallow any drug the list happens to miss
    — which is exactly what it did to Cefadroxil."""
    n = (name or '').strip()
    if not n:
        return True
    if parent_name and parent_name.rstrip().endswith('-'):
        return True
    return bool(TAIL_HEAD.match(n))


def parse_drug_tables(tables, tokens):
    """Tables 137-150 are 'drug | dosage | formulation | one column per weight
    band'. Every cell is stored exactly as printed and attributed to its band,
    so the app can show a clinician the 10–<15 kg column without ever
    recalculating a dose itself.

    Where the PDF stacked several formulations into one cell ('5 mL ½ –'), the
    stack is kept whole. Splitting it would mean guessing which number belongs
    to the syrup and which to the tablet, and a wrong guess here is a
    poisoning."""
    drugs, doses = [], []
    ctx_no, ctx_cap = None, None
    for t in tables:
        rows = [r for r in t['body_md'].split('\n') if r.strip().startswith('|')]
        own_header = next((r for r in rows if is_dosing_header(r)), None)
        if not own_header:
            # Only a table that says 'Drug | Dosage | Form…' over its own
            # columns is read as dosing. Every page of the annex reprints that
            # header, so nothing is lost by insisting on it — and insisting is
            # what stops a table like 'antiTB drug | Route | Mode of action'
            # being read as though 'Oral' were a dose.
            continue
        header = cells(own_header)
        header_cols = len(header)
        if t['number'] and t['caption']:
            ctx_no, ctx_cap = t['number'], t['caption']

        parent = None          # index into `drugs` of the entry being read
        for r in rows:
            if SEP_ROW.match(r.strip()) or is_dosing_header(r):
                continue
            c = cells(r)
            if len(c) < 3 or not c[0]:
                continue
            name_block = re.sub(r'\*+', '', c[0]).strip()
            n0 = norm(name_block)
            if n0 in ('drug', '', 'dose according to body weight') or len(n0) < 3:
                continue

            # A drug name is short. Anything long is a prose row that landed in
            # the first column ('Infected newborns are asymptomatic at birth.').
            # The indication starts at the next Capitalised Word — a lone
            # capital does not count, or 'Vitamin A' and 'Penicillin V' would
            # be cut in half.
            head = re.split(r'(?<=[a-z\)])\s(?=[A-Z][a-z])', name_block, maxsplit=1)
            name = head[0].strip(' ,;–-')
            # 'Pheno barbital' — the PDF hyphenated inside the cell. Rejoin it
            # only when the joined form is a medicine we can name AND the
            # second half is not a word in its own right, or 'Acetic acid' and
            # 'Ipratropium bromide' would be welded shut too.
            m_sp = re.match(r'^([A-Z][a-z]+) ([a-z]+)$', name)
            if (m_sp and (m_sp.group(1) + m_sp.group(2)).lower() in tokens
                    and m_sp.group(2) not in tokens):
                name = m_sp.group(1) + m_sp.group(2)
            indication = head[1].strip() if len(head) > 1 else None
            prose = (not (3 <= len(name) <= 60) or len(name.split()) > 5
                     or name.endswith('.')
                     or re.search(r'\b(are|is|was|were|should|must|may)\b', name, re.I))

            pname = drugs[parent][1] if parent is not None else None
            if not is_continuation(name, pname) and not prose:
                did = len(drugs) + 1
                drugs.append([did, name, norm(name), indication,
                              c[1] if len(c) > 1 else None,
                              c[2] if len(c) > 2 else None, ctx_no, ctx_cap,
                              r.strip()])
                parent = len(drugs) - 1
            elif parent is not None and not prose:
                # The tail of the row above. Its doses are real, so they are
                # kept — filed under the drug they actually belong to.
                p = drugs[parent]
                joined = (p[1].rstrip('- ') + name_block.strip()).lower()
                if p[1].endswith('-') or (name_block[:1].islower()
                                          and joined.replace(' ', '') in tokens):
                    p[1] = p[1].rstrip('- ') + name_block.strip()
                    p[2] = norm(p[1])
                else:
                    p[3] = ' '.join(filter(None, [p[3], name_block]))[:300]
                did = len(drugs) + 1
                drugs.append([did, p[1], p[2],
                              ' '.join(filter(None, [p[3] if p[3] != name_block else None,
                                                     name_block]))[:300],
                              c[1] if len(c) > 1 else None,
                              c[2] if len(c) > 2 else None, ctx_no, ctx_cap,
                              r.strip()])
            else:
                continue

            for j in range(3, len(c)):
                val = c[j]
                if not val or val in ('–', '-', '—'):
                    continue
                # Only label a dose with a band when the columns line up AND
                # the label really is a weight or age band. An unlabelled dose
                # is honest; a mislabelled one is dangerous.
                band = header[j] if len(c) == header_cols and j < len(header) else None
                if not band or not BAND_LIKE.search(band):
                    band = None
                doses.append((did, j - 3, band, val))

    # A row with no dosage, no formulation and no doses is a section heading
    # inside the table ('Analgesics', 'Antiseptics'), not a drug.
    dosed = {d for d, _, _, _ in doses}
    keep = [d for d in drugs if d[0] in dosed or d[4] or d[5]]
    # The annex reprints its header — and sometimes a whole row — on the next
    # page. An identical entry with identical doses is that reprint.
    by_drug = {}
    for d, o, bnd, v in doses:
        by_drug.setdefault(d, []).append((o, bnd, v))
    seen_rows, unique = set(), []
    for d in keep:
        sig = (norm(d[1]), d[3], d[4], d[5], tuple(by_drug.get(d[0], ())))
        if sig in seen_rows:
            continue
        seen_rows.add(sig)
        unique.append(d)
    keep = unique
    remap = {d[0]: i + 1 for i, d in enumerate(keep)}
    for i, d in enumerate(keep):
        d[0] = i + 1
    doses = [(remap[d], o, b, v) for d, o, b, v in doses if d in remap]
    return [tuple(d) for d in keep], doses


# ── 8. Differential diagnosis tables ───────────────────────────────────────
DIFF_CAPTION = re.compile(r'differential diagnos[ei]s\s+(?:of|for)\s+(.+?)\s*$', re.I)
# Rows that are a heading or a column label, not a diagnosis.
NOT_A_DIAGNOSIS = re.compile(
    r'^(a diagnosis|diagnosis|cause|causes|characteristics?|accompanying signs?|'
    r'in favour|signs?|symptoms?|features?|finding|history|examination|other)$', re.I)


def parse_differentials(tables):
    """Turn the book's "Differential diagnosis of X" tables into rows.

    Each row says: with this presenting symptom, this is a diagnosis to think
    of, and these are the findings that count in its favour. That is precisely
    what a clinician needs when the patient is in front of them, and it is the
    one thing a guideline's prose cannot give quickly."""
    out = []
    for t in tables:
        cap = (t['caption'] or '')
        m = DIFF_CAPTION.search(cap)
        if not m:
            continue
        symptom = re.sub(r'\s+', ' ', m.group(1)).strip(' .')
        for line in t['body_md'].split('\n'):
            row = line.strip()
            if not row.startswith('|') or SEP_ROW.match(row):
                continue
            c = cells(row)
            if len(c) < 2:
                continue
            name = re.sub(r'\*+', '', c[0]).strip()
            favour = re.sub(r'\s+', ' ', re.sub(r'\*+', '', ' '.join(c[1:]))).strip()
            if not name or not favour or len(name) > 70:
                continue
            if NOT_A_DIAGNOSIS.match(norm(name)) or len(norm(name)) < 3:
                continue
            pg = re.search(r'\(\s*p\.\s*(\d+)', name)
            # The PDF hyphenated inside the cell: "Congenital hypo- thyroidism".
            clean_name = re.sub(r'\s*\(\s*p\.\s*\d+\s*\)', '', name)
            clean_name = re.sub(r'(\w)-\s+(\w)', r'\1\2', clean_name).strip(' .,;')
            out.append((symptom, cap, clean_name, norm(clean_name),
                        int(pg.group(1)) if pg else None, favour))
    return out


# ── Schema ─────────────────────────────────────────────────────────────────
SCHEMA = """
PRAGMA journal_mode=DELETE;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE chapters (number INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE conditions (
  id INTEGER PRIMARY KEY, number TEXT, title TEXT, depth INTEGER,
  chapter_number INTEGER, chapter_title TEXT, page INTEGER, age_group TEXT,
  definition TEXT, causes TEXT, history TEXT, examination TEXT,
  clinical_features TEXT, differential TEXT, investigations TEXT,
  diagnosis TEXT, management TEXT, treatment TEXT, referral TEXT,
  follow_up TEXT, prevention TEXT, counselling TEXT, complications TEXT,
  monitoring TEXT, red_flags TEXT, cautions TEXT, notes TEXT, full_text TEXT,
  -- The book's tables carry a fifth of its clinical content (the differential
  -- diagnosis grids, the dosing rows). They are stored properly in `tables`;
  -- this copy exists only so a search for a word that appears solely inside a
  -- table still finds the condition it belongs to.
  tables_text TEXT);
CREATE TABLE tables (
  id INTEGER PRIMARY KEY, condition_id INTEGER REFERENCES conditions(id),
  number INTEGER, caption TEXT, header TEXT, body_md TEXT);
CREATE TABLE medicines (
  id INTEGER PRIMARY KEY, condition_id INTEGER REFERENCES conditions(id),
  name TEXT, dose TEXT, unit TEXT, per_kg INTEGER, route TEXT,
  frequency TEXT, duration TEXT, source_line TEXT);
CREATE TABLE drugs (
  id INTEGER PRIMARY KEY, name TEXT, name_normalized TEXT, indication TEXT,
  dosage TEXT, formulation TEXT, source_table INTEGER, source_caption TEXT,
  -- The row exactly as the book prints it. The PDF interleaved the dosage and
  -- formulation columns inside some cells ("25 mg/kg twice a daySyrup 250
  -- mg/5 mL"), and no amount of parsing untangles that safely. So the printed
  -- row travels with the parsed one, and the app can always show it.
  source_row TEXT);
CREATE TABLE drug_doses (
  id INTEGER PRIMARY KEY, drug_id INTEGER REFERENCES drugs(id),
  band_order INTEGER, band TEXT, dose TEXT);
-- Which annex drugs this condition's own treatment text names. This is the
-- link that takes a clinician from "Pneumonia" to the amoxicillin weight-band
-- table in one tap, instead of leafing through the annex.
CREATE TABLE condition_drugs (
  id INTEGER PRIMARY KEY, condition_id INTEGER REFERENCES conditions(id),
  drug_name TEXT, name_normalized TEXT);
CREATE INDEX idx_cd_cond ON condition_drugs(condition_id);
CREATE INDEX idx_cd_name ON condition_drugs(name_normalized);
-- The book's 44 "Differential diagnosis of X" tables, one row per diagnosis.
-- This is the most valuable thing in the book for a clinic: a mapping from
-- what the patient presents with to what it might be, written by clinicians
-- and stating, for each candidate, exactly what counts in its favour.
CREATE TABLE differentials (
  id INTEGER PRIMARY KEY, symptom TEXT, caption TEXT, diagnosis TEXT,
  diagnosis_normalized TEXT, page INTEGER, in_favour TEXT, condition_id INTEGER);
CREATE INDEX idx_dif_sym  ON differentials(symptom);
CREATE INDEX idx_dif_name ON differentials(diagnosis_normalized);
CREATE VIRTUAL TABLE differentials_fts USING fts5(
  diagnosis, symptom, in_favour, content='differentials', content_rowid='id',
  tokenize="unicode61");
CREATE INDEX idx_cond_title ON conditions(title);
CREATE INDEX idx_cond_chap  ON conditions(chapter_number);
CREATE INDEX idx_tbl_cond   ON tables(condition_id);
CREATE INDEX idx_med_cond   ON medicines(condition_id);
CREATE INDEX idx_med_name   ON medicines(name);
CREATE INDEX idx_drug_name  ON drugs(name_normalized);
CREATE INDEX idx_dose_drug  ON drug_doses(drug_id);
CREATE VIRTUAL TABLE conditions_fts USING fts5(
  title, number, chapter_title, clinical_features, treatment, management,
  full_text, tables_text, content='conditions', content_rowid='id',
  tokenize="unicode61");
CREATE VIRTUAL TABLE drugs_fts USING fts5(
  name, indication, dosage, formulation, content='drugs', content_rowid='id',
  tokenize="unicode61");
CREATE VIEW v_condition_full AS
  SELECT c.id, c.number, c.title, c.chapter_number, c.chapter_title, c.page,
         c.age_group, c.clinical_features, c.treatment, c.management, c.red_flags,
         c.cautions, c.full_text,
         (SELECT COUNT(*) FROM medicines m WHERE m.condition_id=c.id) AS medicine_count,
         (SELECT COUNT(*) FROM tables t WHERE t.condition_id=c.id) AS table_count
  FROM conditions c;
CREATE VIEW v_drug_full AS
  SELECT d.id, d.name, d.indication, d.dosage, d.formulation, d.source_table,
         (SELECT COUNT(*) FROM drug_doses x WHERE x.drug_id=d.id) AS band_count
  FROM drugs d;
"""

AGE_BY_CHAPTER = {5: 'newborn', 8: 'adolescent'}


def main(src, dst, emhslu=None):
    raw = open(src, encoding='utf-8', errors='replace').read()
    sha = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    lines = unwrap_prose_rows([clean(l).rstrip() for l in raw.split('\n')])

    numbered, unnumbered = parse_toc(lines)
    print(f'  TOC: {len(numbered)} numbered, {len(unnumbered)} named sub-sections')

    chapters = {}
    for n, e in numbered.items():
        if '.' not in n:
            try:
                chapters[int(n)] = e['title']
            except ValueError:
                pass

    # Where the contents block ends — anchoring only ever looks after it.
    body_start = max([e['toc_line'] for e in numbered.values()
                      if e['page'] <= 3] + [0])

    # Anchoring happens in two passes. The numbered sections go first: their
    # numbers are printed in the body, so they are unambiguous, and they carve
    # the book into regions. Only then are the named sub-conditions (Measles,
    # Kawasaki disease, Viral croup — the ones the chapter contents lists
    # without a number) looked for, each inside its own region.
    #
    # One pass over everything at once does not work: a title that cannot be
    # found drags the search cursor past the next few sections and silently
    # loses them. Confining each search to its parent region stops one miss
    # from cascading.
    numbered_outline = sorted((e for n, e in numbered.items() if '.' in n),
                              key=lambda e: (e['page'], e['toc_line']))
    anchors, cursor = [], body_start
    for e in numbered_outline:
        at = find_anchor(lines, max(cursor, body_start), e['number'], e['title'])
        if at is None:
            continue
        anchors.append(dict(e, line=at, kind='num'))
        cursor = at + 1
    n_num = len(anchors)

    named = 0
    for e in sorted(unnumbered, key=lambda e: (e['page'], e['toc_line'])):
        parent = None
        for a in anchors:
            if a['kind'] == 'num' and a['page'] <= e['page']:
                parent = a
            elif a['kind'] == 'num' and a['page'] > e['page']:
                break
        if parent is None:
            continue
        region_end = next((a['line'] for a in anchors
                           if a['kind'] == 'num' and a['line'] > parent['line']), len(lines))
        at = find_anchor(lines, parent['line'] + 1, None, e['title'], stop=region_end)
        if at is None:
            continue
        anchors.append(dict(e, line=at, kind='name', number=None))
        named += 1
    anchors.sort(key=lambda a: a['line'])
    print(f'  anchored in the body: {n_num}/{len(numbered_outline)} numbered, '
          f'{named}/{len(unnumbered)} named')

    tables = collect_tables(lines)
    print(f'  tables found: {len(tables)}')

    # The dosing annex is parsed first: its drug names become both the
    # cross-reference index and part of the vocabulary that keeps non-drugs out
    # of the medicines table.
    tokens = load_emhslu_tokens(emhslu)
    drugs, doses = parse_drug_tables(tables, tokens)
    annex_names = sorted({d[1] for d in drugs})
    vocab = with_annex(tokens, annex_names)
    print(f'  annex drugs: {len(annex_names)} names, {len(doses)} band doses; '
          f'vocabulary {len(vocab)} tokens')
    # Longest first, so "amoxicillin/clavulanate" is not swallowed by
    # "amoxicillin" when both appear in the same sentence.
    annex_lookup = sorted(
        ((re.split(r'[/,(]', n)[0].strip(), n) for n in annex_names),
        key=lambda p: -len(p[0]))
    annex_lookup = [(w, n) for w, n in annex_lookup if len(w) >= 5]

    if os.path.exists(dst):
        os.remove(dst)
    db = sqlite3.connect(dst)
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO chapters(number,title) VALUES (?,?)',
                   sorted(chapters.items()))

    n_med = n_tbl = n_link = 0
    for k, a in enumerate(anchors):
        start = a['line']
        end = anchors[k + 1]['line'] if k + 1 < len(anchors) else min(start + 400, len(lines))
        body = []
        for l in lines[start:end]:
            s = l.strip()
            if not s or s.startswith('|'):
                continue
            if is_toc_line(s):
                continue                      # a mini-contents block
            low = norm(s)
            if low == 'contents' or low == norm(BOOK_TITLE):
                continue
            # Running headers: the section name repeated in capitals at the
            # top of every page.
            if s.isupper() and len(s) < 72:
                continue
            body.append(s)
        full_text = bulletise('\n'.join(body)).strip()

        ch_no = None
        if a.get('number'):
            head = a['number'].split('.')[0]
            ch_no = int(head) if head.isdigit() else None
        elif k:
            for prev in reversed(anchors[:k]):
                if prev.get('number'):
                    h = prev['number'].split('.')[0]
                    ch_no = int(h) if h.isdigit() else None
                    break

        f = split_fields('\n'.join(body))
        depth = (a['number'].count('.') + 1) if a.get('number') else 3
        cur = db.execute(
            'INSERT INTO conditions(number,title,depth,chapter_number,chapter_title,'
            'page,age_group,definition,causes,history,examination,clinical_features,'
            'differential,investigations,diagnosis,management,treatment,referral,'
            'follow_up,prevention,counselling,complications,monitoring,red_flags,'
            'cautions,notes,full_text) VALUES (' + ','.join(['?'] * 27) + ')',
            (a.get('number'), a['title'], depth, ch_no, chapters.get(ch_no),
             a['page'], AGE_BY_CHAPTER.get(ch_no, 'child'),
             f.get('definition'), f.get('causes'), f.get('history'),
             f.get('examination'), f.get('clinical_features'), f.get('differential'),
             f.get('investigations'), f.get('diagnosis'), f.get('management'),
             f.get('treatment'), f.get('referral'), f.get('follow_up'),
             f.get('prevention'), f.get('counselling'), f.get('complications'),
             f.get('monitoring'), f.get('red_flags'), cautions(full_text),
             f.get('notes'), full_text))
        cid = cur.lastrowid

        mine = []
        for t in tables:
            if start <= t['line'] < end:
                db.execute('INSERT INTO tables(condition_id,number,caption,header,body_md) '
                           'VALUES (?,?,?,?,?)',
                           (cid, t['number'], t['caption'], t['header'], t['body_md']))
                mine.append(' '.join(filter(None, [t['caption'], t['body_md']])))
                n_tbl += 1
        if mine:
            db.execute('UPDATE conditions SET tables_text=? WHERE id=?',
                       ('\n'.join(mine), cid))

        src_text = '\n'.join(filter(None, [
            f.get('treatment'), f.get('management'), f.get('referral'), f.get('prevention')]))
        meds = parse_medicines(src_text or full_text, vocab)
        if meds:
            db.executemany(
                'INSERT INTO medicines(condition_id,name,dose,unit,per_kg,route,'
                'frequency,duration,source_line) VALUES (?,?,?,?,?,?,?,?,?)',
                [(cid,) + m for m in meds])
            n_med += len(meds)

        # Cross-reference: which annex drugs this section actually names.
        hay = ' ' + norm(src_text or full_text) + ' '
        linked = set()
        for word, full in annex_lookup:
            key = norm(word)
            if key in linked or not key:
                continue
            if re.search(r'\b' + re.escape(key) + r'\b', hay):
                linked.add(key)
                db.execute('INSERT INTO condition_drugs(condition_id,drug_name,'
                           'name_normalized) VALUES (?,?,?)', (cid, full, norm(full)))
                n_link += 1

    # Tables that fall outside any anchored section (the annexes) are kept too.
    claimed = {r[0] for r in db.execute('SELECT body_md FROM tables')}
    for t in tables:
        if t['body_md'] not in claimed:
            db.execute('INSERT INTO tables(condition_id,number,caption,header,body_md) '
                       'VALUES (NULL,?,?,?,?)',
                       (t['number'], t['caption'], t['header'], t['body_md']))
            n_tbl += 1

    db.executemany('INSERT INTO drugs(id,name,name_normalized,indication,dosage,'
                   'formulation,source_table,source_caption,source_row) '
                   'VALUES (?,?,?,?,?,?,?,?,?)', drugs)
    db.executemany('INSERT INTO drug_doses(drug_id,band_order,band,dose) '
                   'VALUES (?,?,?,?)', doses)

    diffs = parse_differentials(tables)
    for sym, cap, name, nname, pg, favour in diffs:
        # Point each differential at the section that describes it, so a
        # clinician can go from "it might be this" to the full guideline.
        cid = db.execute('SELECT id FROM conditions WHERE lower(title)=? OR '
                         '(page IS NOT NULL AND page=?) ORDER BY '
                         'CASE WHEN lower(title)=? THEN 0 ELSE 1 END LIMIT 1',
                         (name.lower(), pg, name.lower())).fetchone()
        db.execute('INSERT INTO differentials(symptom,caption,diagnosis,'
                   'diagnosis_normalized,page,in_favour,condition_id) '
                   'VALUES (?,?,?,?,?,?,?)',
                   (sym, cap, name, nname, pg, favour, cid[0] if cid else None))
    db.execute("INSERT INTO differentials_fts(rowid,diagnosis,symptom,in_favour) "
               "SELECT id,diagnosis,symptom,in_favour FROM differentials")

    db.execute("INSERT INTO conditions_fts(rowid,title,number,chapter_title,"
               "clinical_features,treatment,management,full_text,tables_text) "
               "SELECT id,title,number,chapter_title,clinical_features,treatment,"
               "management,full_text,tables_text FROM conditions")
    db.execute("INSERT INTO drugs_fts(rowid,name,indication,dosage,formulation) "
               "SELECT id,name,indication,dosage,formulation FROM drugs")

    n_cond = db.execute('SELECT COUNT(*) FROM conditions').fetchone()[0]
    for k, v in [
        ('title', 'Pocket book of primary health care for children and adolescents'),
        ('publisher', 'WHO Regional Office for Europe'),
        ('isbn', '978-92-890-5762-2'),
        ('edition', '2022'),
        ('source_file', os.path.basename(src)),
        ('source_sha256', sha),
        ('built_at', datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')),
        ('conditions', str(n_cond)),
        ('drugs', str(len(drugs))),
        ('scope', 'Paediatric and adolescent primary health care. '
                  'Complements the Uganda Clinical Guidelines 2023; does not replace them.'),
    ]:
        db.execute('INSERT INTO meta(key,value) VALUES (?,?)', (k, v))

    db.commit()
    db.execute('VACUUM')
    db.commit()

    filled = db.execute(
        'SELECT SUM(treatment IS NOT NULL), SUM(management IS NOT NULL), '
        'SUM(clinical_features IS NOT NULL), SUM(history IS NOT NULL), '
        'SUM(referral IS NOT NULL), SUM(cautions IS NOT NULL), '
        'SUM(LENGTH(full_text) > 200) FROM conditions').fetchone()
    print(f'  chapters      : {len(chapters)}')
    print(f'  conditions    : {n_cond}')
    print(f'  tables stored : {n_tbl}')
    print(f'  medicines     : {n_med}')
    print(f'  drugs / doses : {len(drugs)} / {len(doses)}')
    print(f'  drug links    : {n_link}')
    print(f'  differentials : {len(diffs)} rows, '
          f"{db.execute('SELECT COUNT(DISTINCT diagnosis_normalized) FROM differentials').fetchone()[0]} diagnoses, "
          f"{db.execute('SELECT COUNT(*) FROM differentials WHERE condition_id IS NOT NULL').fetchone()[0]} linked to a section")
    print(f'  fields        : treatment={filled[0]} management={filled[1]} '
          f'features={filled[2]} history={filled[3]} referral={filled[4]} '
          f'do-not={filled[5]} text>200ch={filled[6]}')
    print(f'  file size     : {os.path.getsize(dst) / 1024 / 1024:.2f} MB')
    db.close()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2],
         sys.argv[3] if len(sys.argv) > 3 else 'app/clinic/data/emhslu_2023.db')
