#!/usr/bin/env python3
"""
Build impression_index.db — the small file the New Treatment screen reads to
suggest what a patient's findings might mean.

WHY A THIRD FILE
----------------
The suggestion engine works best off the WHO pocket book's 44 "Differential
diagnosis of X" tables: a clinician-written map from what the patient presents
with to what it might be, and what counts in each candidate's favour. But that
book is 3.3 MB, and New Treatment is the screen a nurse opens twenty times a
day on a phone paying for every megabyte.

So the differentials — and the confirming tests for each diagnosis — are lifted
into their own index, a fraction of the size. The Uganda Clinical Guidelines
database is already open on that screen for the one-tap package, so it costs
nothing extra; this index is the only new download.

Nothing here is new content. Every row is copied from a database that was
itself checked line by line against its source book.

Usage:
  python3 build_impression_index.py [who_child.db] [ucg.db] [out.db]
"""
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

SCHEMA = """
PRAGMA journal_mode=DELETE;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

-- Everything the suggestion engine reads, as plain rows.
--
-- No FTS5 virtual tables here, deliberately. The SQLite build that ships with
-- this app (sql.js) has no FTS5 module at all — every MATCH query against it
-- throws "no such module: fts5" and falls silently back to a LIKE scan. Rather
-- than depend on a feature that is not there, the whole corpus is small enough
-- (776 short documents) to be scored in JavaScript, which is both honest and,
-- at this size, faster.
--
--   kind 'diff' : f1 = diagnosis, f2 = presenting symptom, f3 = what is in its favour
--   kind 'ucg'  : f1 = title,     f2 = clinical features,  f3 = investigations
CREATE TABLE docs (
  id INTEGER PRIMARY KEY, kind TEXT, title TEXT, title_normalized TEXT,
  page INTEGER, src TEXT, cond_id INTEGER, has_features INTEGER,
  f1 TEXT, f2 TEXT, f3 TEXT);
CREATE INDEX idx_docs_kind ON docs(kind);
CREATE INDEX idx_docs_name ON docs(title_normalized);

-- What confirms it. One row per diagnosis per book, so the screen can show
-- "to be sure, do these" straight under each suggestion.
-- named = 1 means `tests` already holds the clinic's own test names, ready to
-- order. named = 0 means it is the guideline's prose, for reading only — it
-- must never be added to a lab order, let alone billed for.
CREATE TABLE dx_tests (
  id INTEGER PRIMARY KEY, diagnosis_normalized TEXT, diagnosis TEXT,
  book TEXT, page INTEGER, tests TEXT, named INTEGER DEFAULT 0);
CREATE INDEX idx_tests_name ON dx_tests(diagnosis_normalized);
"""

# Sections that are not a diagnosis. Offering "Malaria Prevention and Control"
# as an impression is noise, and worse, it crowds out the real answer.
NOT_DX = re.compile(r'\b(prevention|control|prophylaxis|side effects?|management of|'
 r'check for|counsell?ing|education|programme|policy|guidelines?|introduction|'
 r'general principles|classification|definitions?|assessment of|follow[- ]up of|'
 r'monitoring of|rational use|storage|disposal|immuni[sz]ation|vaccination|'
 r'screening|health promotion|overview|approach to|dosing chart|chart|schedule|'
 r'surgery|dosage|treatment of)\b', re.I)
# Two UCG sections carry the NEXT condition's features appended to their own —
# leprosy ends up describing meningitis. Cut the field where the runaway
# heading starts, or leprosy outranks meningitis for a patient with a stiff neck.
RUNAWAY = re.compile(r'^[ \t]*(case definition|diagnosis|investigations?|management|'
 r'treatment|prevention|complications?|causes?|differential|referral|notes?|'
 r'prognosis)\b[ \t]*:?[ \t]*$', re.I | re.M)


def trim_field(t):
    if not t:
        return t
    m = RUNAWAY.search(t)
    return t[:m.start()].strip() if (m and m.start() > 30) else t


# A line of "Investigations" that is a real test, not a sentence about them.
TEST_SPLIT = re.compile(r'[\n;•]|(?<=[a-z])\.\s+(?=[A-Z])')
NOT_A_TEST = re.compile(
    r'^(as (above|below|indicated)|if (available|indicated|possible)|none|'
    r'not (routinely )?(required|indicated|necessary)|depending|other|others|'
    r'refer|consider|see |according|where available)\b', re.I)


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', re.sub(r'\s*\(.*?\)', '', (s or '').lower())).strip()


def load_lab_map(js_path='app/clinic/js/ucg-autofill.js'):
    """The clinic's list of NAMED lab tests, read from the app's own code.

    ucg-autofill.js already holds the one true mapping from what a guideline
    says ("blood slide", "mRDT") to what the clinic orders and charges for
    ("Thick Blood Smear", "Malaria RDT"). Copying that list here would let the
    two drift apart, and a suggested test that the package cannot order is
    worse than no suggestion. So it is read out of the JavaScript at build
    time — one list, two users."""
    out = []
    try:
        src = open(js_path, encoding='utf-8').read()
        block = re.search(r'var LAB_MAP = \[(.*?)\n  \];', src, re.S)
        if not block:
            return out
        for m in re.finditer(r"\[\s*/(.+?)/([a-z]*)\s*,\s*'([^']+)'\s*\]", block.group(1)):
            try:
                out.append((re.compile(m.group(1), re.I if 'i' in m.group(2) else 0), m.group(3)))
            except re.error:
                pass
    except OSError:
        pass
    return out


LAB_MAP = load_lab_map()


def named_tests(*sources):
    """The named tests a piece of guideline text is really asking for, in the
    order the text mentions them."""
    found = []
    for src in sources:
        if not src:
            continue
        for rx, name in LAB_MAP:
            hit = rx.search(src)
            if not hit or any(f[0] == name for f in found):
                continue
            found.append((name, hit.start()))
        if found:
            break
    found.sort(key=lambda f: f[1])
    return [f[0] for f in found][:6]


def tests_from(text):
    """Turn an Investigations field into a short list a nurse can act on."""
    out, seen = [], set()
    for part in TEST_SPLIT.split(re.sub(r'\*+', '', text or '')):
        t = re.sub(r'\s+', ' ', part).strip(' -–~•.:')
        if not (4 <= len(t) <= 120) or NOT_A_TEST.match(t):
            continue
        k = norm(t)[:40]
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(t)
        if len(out) >= 6:
            break
    return out


def main(who_path, ucg_path, out_path):
    who = sqlite3.connect(who_path); who.row_factory = sqlite3.Row
    ucg = sqlite3.connect(ucg_path); ucg.row_factory = sqlite3.Row
    if os.path.exists(out_path):
        os.remove(out_path)
    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)

    n_dif = 0
    for r in who.execute('SELECT symptom, caption, diagnosis, diagnosis_normalized, '
                         'page, in_favour FROM differentials'):
        db.execute('INSERT INTO docs(kind,title,title_normalized,page,src,cond_id,'
                   'has_features,f1,f2,f3) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   ('diff', r['diagnosis'], r['diagnosis_normalized'], r['page'],
                    'WHO ' + re.sub(r'\.\s*Differential.*', '', r['caption'] or ''),
                    None, 1, r['diagnosis'], r['symptom'], r['in_favour']))
        n_dif += 1

    # The Uganda guidelines, as short documents: the title, the clinical
    # features, the investigations. Not the full chapter text — that is where
    # the noise lives, and it is 6 MB.
    n_ucg = 0
    for r in ucg.execute('SELECT id, title, page, clinical_features, investigations, '
                         'full_text FROM conditions'):
        if NOT_DX.search(r['title'] or ''):
            continue
        feats = trim_field(r['clinical_features'])
        has = 1 if feats else 0
        if not feats:
            feats = re.sub(r'\s+', ' ', (r['full_text'] or ''))[:1200]
        db.execute('INSERT INTO docs(kind,title,title_normalized,page,src,cond_id,'
                   'has_features,f1,f2,f3) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   ('ucg', r['title'], norm(r['title']), r['page'], 'UCG 2023',
                    r['id'], has, r['title'], feats, r['investigations'] or ''))
        n_ucg += 1

    # Confirming tests — ONLY from the guideline's own "Investigations"
    # section.
    #
    # Scanning the whole chapter instead was tried and abandoned: the malaria
    # chapter mentions "Normal CSF" and "Hb <5 g/dl" as the defining features
    # of SEVERE malaria, and a keyword scan turned those into "do a lumbar
    # puncture" as the way to confirm malaria. Sending a febrile patient for a
    # lumbar puncture is not a small mistake. Where the guideline names no
    # investigation the screen says so, which is the honest answer.
    n_t = n_named = 0
    seen = set()
    for book, conn, cite in (('who', who, 'WHO pocket book'), ('ucg', ucg, 'UCG 2023')):
        for r in conn.execute('SELECT title, page, investigations FROM conditions '
                              'WHERE investigations IS NOT NULL'):
            if NOT_DX.search(r['title'] or ''):
                continue
            named = named_tests(r['investigations'])
            prose = tests_from(r['investigations'])
            if not named and not prose:
                continue
            key = (book, norm(r['title']))
            if not key[1] or key in seen:
                continue
            seen.add(key)
            db.execute('INSERT INTO dx_tests(diagnosis_normalized,diagnosis,book,'
                       'page,tests,named) VALUES (?,?,?,?,?,?)',
                       (norm(r['title']), r['title'], cite, r['page'],
                        '\n'.join(named or prose), 1 if named else 0))
            n_t += 1
            n_named += 1 if named else 0

    for k, v in [
        ('built_at', datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')),
        ('sources', 'WHO pocket book of primary health care for children and '
                    'adolescents (differential tables); Uganda Clinical Guidelines 2023 '
                    '(investigations)'),
        ('differentials', str(n_dif)),
        ('ucg_conditions', str(n_ucg)),
        ('dx_tests', str(n_t)),
        ('note', 'Suggestions only. Every row is copied from a guideline; nothing '
                 'here is generated. A suggestion is never a diagnosis.'),
    ]:
        db.execute('INSERT INTO meta(key,value) VALUES (?,?)', (k, v))

    db.commit()
    db.execute('VACUUM')
    db.commit()
    print(f'  differentials : {n_dif}')
    print(f'  ucg documents : {n_ucg}')
    print(f'  dx_tests      : {n_t}  ({n_named} with named, orderable tests)')
    print(f'  lab map       : {len(LAB_MAP)} test names read from ucg-autofill.js')
    print(f'  file size     : {os.path.getsize(out_path)/1024:.0f} KB')
    db.close()


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0] if a else 'app/clinic/data/who_child_2023.db',
         a[1] if len(a) > 1 else 'app/clinic/data/uganda_clinical_guidelines_2023.db',
         a[2] if len(a) > 2 else 'app/clinic/data/impression_index.db')
