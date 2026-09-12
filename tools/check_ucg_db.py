#!/usr/bin/env python3
"""Acceptance checks for uganda_clinical_guidelines_2023.db.

The rebuild exists to stop a condition inheriting its neighbour's text, so the
checks are structural rather than a list of known-bad examples: every one of
them would have caught the Hairy Leukoplakia / Prostatitis / Painful Scrotal
Swelling faults without anyone having to notice those conditions first.

Run against the old and the new database to compare:

    python3 tools/check_ucg_db.py app/clinic/data/uganda_clinical_guidelines_2023.db
"""
import json
import re
import sqlite3
import sys
from collections import Counter

FIELDS = ['causes', 'clinical_features', 'differential', 'investigations',
          'management', 'prevention', 'complications', 'notes']


def norm(s):
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).split())


def check(path):
    db = sqlite3.connect(path)
    rows = db.execute(
        'SELECT id, number, title, chapter_number, chapter_title, icd10, page, '
        'full_text, ' + ','.join(FIELDS) + ' FROM conditions').fetchall()
    n = len(rows)
    out = {'conditions': n,
           'chapters': db.execute('SELECT COUNT(*) FROM chapters').fetchone()[0]}

    # 1. Every LINE of every parsed field must appear in that condition's own
    #    full_text.  The test is per line rather than per block because two
    #    headers can feed one column (Yellow Fever prints both "cause" and
    #    "Risk factors"), so a column is legitimately a join of passages that
    #    are not contiguous in the source.  A line that is absent, though, came
    #    from a different condition - which is the fault being tested for.
    stray = Counter()
    stray_lines = 0
    for r in rows:
        ft = norm(r[7])
        for k, v in zip(FIELDS, r[8:]):
            bad = [l for l in (v or '').split('\n')
                   if len(norm(l)) > 12 and norm(l) not in ft]
            if bad:
                stray[k] += 1
                stray_lines += len(bad)
    out['conditions_with_foreign_field_text'] = dict(stray)
    out['foreign_field_lines'] = stray_lines

    # 2. Every medicine's source_line must come from its own condition's text.
    #    This is the sharpest bleed detector: a drug attributed to the wrong
    #    disease is the fault with the worst consequence.
    bad_med = 0
    med_total = 0
    for cid, ft in db.execute('SELECT id, full_text FROM conditions'):
        f = norm(ft)
        for (src,) in db.execute(
                'SELECT source_line FROM medicines WHERE condition_id=?', (cid,)):
            med_total += 1
            if norm(src)[:80] not in f:
                bad_med += 1
    out['medicines'] = med_total
    out['medicines_from_another_condition'] = bad_med

    # 3. Duplicate field text across conditions - the signature of page slicing,
    #    where two neighbours are handed the same paragraphs.
    dup = Counter()
    for k, i in zip(FIELDS, range(8, 8 + len(FIELDS))):
        seen = {}
        for r in rows:
            v = norm(r[i])
            if len(v) < 60:
                continue
            seen.setdefault(v, []).append(r[1])
        dup[k] = sum(len(v) - 1 for v in seen.values() if len(v) > 1)
    out['duplicate_field_text'] = dict(dup)
    out['duplicate_field_text_total'] = sum(dup.values())

    # 4. Chapter integrity: every condition's chapter must exist and match its
    #    own number.  Chapter 9 was absent from the shipped database entirely.
    chap = {c for (c,) in db.execute('SELECT number FROM chapters')}
    missing = sorted({r[3] for r in rows if r[3] not in chap})
    out['conditions_with_unknown_chapter'] = sum(1 for r in rows if r[3] not in chap)
    out['missing_chapters'] = missing
    out['chapter_mismatch'] = sum(
        1 for r in rows
        if r[1].split('.')[0].isdigit() and int(r[1].split('.')[0]) != r[3])

    # 5. ICD-10 shape.  Anything stored must look like a real code; we would
    #    rather store nothing than something that will travel onto a claim.
    icd = [r[5] for r in rows if r[5]]
    good = [c for c in icd if re.fullmatch(r'[A-TV-Z]\d{2}(\.\d{1,2})?', c)]
    out['icd10_present'] = len(icd)
    out['icd10_malformed'] = len(icd) - len(good)

    # 6. Nothing empty, nothing duplicated.
    out['blank_titles'] = sum(1 for r in rows if not (r[2] or '').strip())
    out['blank_full_text'] = sum(1 for r in rows if not (r[7] or '').strip())
    out['duplicate_numbers'] = n - len({r[1] for r in rows})

    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    res = check(sys.argv[1])
    width = max(len(k) for k in res)
    for k, v in res.items():
        print('  %-*s : %s' % (width, k, v))
    print(json.dumps(res))


if __name__ == '__main__':
    main()
