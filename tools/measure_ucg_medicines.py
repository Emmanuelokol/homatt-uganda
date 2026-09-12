#!/usr/bin/env python3
"""Measure what the dose parser misses, against the national medicines list.

Recall is measured with a vocabulary we did not invent: the 2,424 items of the
Uganda Essential Medicines and Health Supplies List, already bundled with the
app.  For every condition, every EMHSLU medicine name that appears in the
guideline's own management text is a drug the book is naming.  Whether
parse_medicines captured it is then a fact, not an opinion.

    python3 tools/measure_ucg_medicines.py [ucg.db] [emhslu.db]
"""
import re
import sqlite3
import sys
from collections import Counter

import os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_ucg_db as B          # noqa: E402  (path set above)

UCG = os.path.join(HERE, '..', 'app', 'clinic', 'data',
                   'uganda_clinical_guidelines_2023.db')
EMH = os.path.join(HERE, '..', 'app', 'clinic', 'data', 'emhslu_2023.db')

# Names too generic to look for as words: they appear in prose about anything.
TOO_GENERIC = {
    'water', 'oxygen', 'glucose', 'dextrose', 'sodium', 'potassium', 'calcium',
    'iron', 'zinc', 'air', 'alcohol', 'compound', 'solution', 'powder', 'oil',
    'paraffin', 'starch', 'talc', 'gas', 'blood', 'plasma', 'saline', 'urea',
}


def vocab(emh):
    """Lower-cased EMHSLU medicine names worth searching for."""
    out = {}
    for (name,) in emh.execute(
            "SELECT DISTINCT name FROM emhslu_items WHERE item_type='medicine' "
            "OR item_type IS NULL"):
        n = re.sub(r'\s+', ' ', (name or '')).strip()
        if len(n) < 5:
            continue
        head = re.split(r'[,(/]', n)[0].strip().lower()
        if len(head) < 5 or head in TOO_GENERIC:
            continue
        out.setdefault(head, n)
    return out


def main():
    ucg = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else UCG)
    ucg.row_factory = sqlite3.Row
    emh = sqlite3.connect(sys.argv[2] if len(sys.argv) > 2 else EMH)
    names = vocab(emh)
    print('EMHSLU names searched for : %d' % len(names))

    # one compiled alternation, longest first so "sodium chloride" wins over "sodium"
    ordered = sorted(names, key=len, reverse=True)
    rx = re.compile(r'(?<![A-Za-z])(' + '|'.join(re.escape(n) for n in ordered) +
                    r')(?![A-Za-z])', re.I)

    total_mentions = 0
    caught = 0
    missed = Counter()
    missed_lines = {}
    per_condition = []

    for r in ucg.execute('SELECT id, number, title, management, full_text FROM conditions'):
        text = r['management'] or ''
        if not text.strip():
            continue
        mentioned = {m.group(1).lower() for m in rx.finditer(text)}
        if not mentioned:
            continue
        got = {row[0].lower() for row in ucg.execute(
            'SELECT name FROM medicines WHERE condition_id=?', (r['id'],))}

        def has(n):
            return any(n in g or g in n for g in got)

        hit = {n for n in mentioned if has(n)}
        gap = mentioned - hit
        total_mentions += len(mentioned)
        caught += len(hit)
        for n in gap:
            missed[n] += 1
            if n not in missed_lines:
                for line in text.split('\n'):
                    if re.search(r'(?<![A-Za-z])' + re.escape(n) + r'(?![A-Za-z])',
                                 line, re.I):
                        missed_lines[n] = (r['number'], r['title'], line.strip()[:96])
                        break
        if gap:
            per_condition.append((len(gap), r['number'], r['title'], sorted(gap)[:6]))

    print('drug mentions in management text : %d' % total_mentions)
    print('captured by parse_medicines      : %d  (%.1f%%)'
          % (caught, 100.0 * caught / max(1, total_mentions)))
    print('missed                           : %d  (%.1f%%)'
          % (total_mentions - caught,
             100.0 * (total_mentions - caught) / max(1, total_mentions)))

    print('\n-- most-missed medicines --')
    for n, c in missed.most_common(30):
        src = missed_lines.get(n)
        print('  %3d  %-26s %s' % (c, n[:26], (src[2] if src else '')))

    print('\n-- conditions losing the most --')
    for c, num, title, gap in sorted(per_condition, reverse=True)[:15]:
        print('  %2d  %-9s %-38s %s' % (c, num, title[:38], ', '.join(gap)))


if __name__ == '__main__':
    main()
