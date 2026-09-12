#!/usr/bin/env python3
"""Resolve the UCG 2023 heading spine.

The book's table of contents is authoritative for WHICH sections exist and in
what order.  The body text is authoritative for WHERE each one starts.  This
module matches the two, and it has to cope with the book disagreeing with
itself: headings wrap across lines (with and without a hyphen), titles are
reprinted with different wording, and a few printed numbers are simply wrong.

Nothing here guesses.  Every match is scored, and anything that cannot be
matched confidently is reported rather than quietly dropped.
"""
import html
import re
import sys
import unicodedata

SRC = ('/root/.claude/uploads/f3451427-e03d-514d-8f41-e3e6f96e4176/'
       '57d82386-Uganda_Clinical_Guidelines_2023.html')


# ── the line stream ────────────────────────────────────────────────────────
# PDF bullet and glyph leftovers (\x81 \x83 \x89 \x8d, private-use codepoints,
# zero-widths) render as tofu.  They are replaced with a space rather than
# removed, and the substitution is per-character so the line count is
# unchanged - the heading spine addresses text by line index, so anything that
# added or removed a line here would move every section boundary.
CTRL_RE = re.compile('[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏﻿�'
                     '-]')


def load_lines(path=SRC):
    src = open(path, encoding='utf-8', errors='replace').read()
    txt = html.unescape(re.sub(r'<[^>]+>', '\n', src)).replace('\xa0', ' ')
    txt = CTRL_RE.sub(' ', txt)
    return [l.strip() for l in txt.split('\n')]


# Words split across a line break by PDF hyphenation ("contrain-\ndicated").
# Applied per section, after slicing, for the same reason.
HYPHEN_JOIN = re.compile(r'(\w)-\n(\w)')


def dehyphenate(text):
    return HYPHEN_JOIN.sub(r'\1\2', text or '')


# ── the table of contents ──────────────────────────────────────────────────
TOC_RE = re.compile(r'^((?:\d+\.)+\d*|\d+)\s+(.{3,140}?)\s*\.{3,}\s*(\d{1,4})$')

# Four entries print a single dot instead of a dot leader, and the strict form
# above silently drops them - including the whole of chapter 9 and "3.1 HIV
# Infection and AIDS".  The loose form recovers them, but it also matches a
# dose range ("0.75 - 1.5") and a body heading whose ICD code ends in a digit
# ("... ICD10 CODE: B45.1"), so it is only ever applied inside the contiguous
# block of lines the strict form has already proved to be the contents.
TOC_LOOSE = re.compile(r'^((?:\d+\.)+\d*|\d+)\s+(.{3,140}?)\s*\.+\s*(\d{1,4})$')


# The book has 24 chapters, so a section number whose leading component is
# larger than that is a misprint.  One exists: "117.2.10 Counsel the Mother",
# printed that way in both the contents and the body, sitting between 17.2.9
# and 17.3.  Left alone it invents a chapter 117 and the condition loses its
# chapter name in the app, so the stray leading digit is dropped - but only
# when doing so yields a real chapter, never by guesswork.
MAX_CHAPTER = 24


def repair_number(num):
    head = num.split('.')[0]
    if not head.isdigit() or 1 <= int(head) <= MAX_CHAPTER:
        return num
    if len(head) > 1 and 1 <= int(head[1:] or 0) <= MAX_CHAPTER:
        return head[1:] + num[len(head):]
    return num


def toc_region(lines):
    """The half-open line range the table of contents occupies."""
    strict = [i for i, l in enumerate(lines) if TOC_RE.match(l)]
    return (min(strict), max(strict) + 1) if strict else (0, 0)


def parse_toc(lines):
    """number -> {title, page, order}.  First occurrence wins."""
    lo, hi = toc_region(lines)
    hi -= 1

    toc, order = {}, 0
    for i, l in enumerate(lines):
        m = TOC_RE.match(l)
        if not m:
            if not (lo <= i <= hi) or 'ICD' in l:
                continue
            m = TOC_LOOSE.match(l)
            if not m:
                continue
        num = repair_number(m.group(1).rstrip('.'))
        if num in toc:
            continue
        toc[num] = {'number': num,
                    'title': re.sub(r'\s+', ' ', m.group(2)).strip(' .'),
                    'page': int(m.group(3)),
                    'order': order,
                    'depth': num.count('.') + 1}
        order += 1
    return toc


# ── comparing titles the way a reader would ────────────────────────────────
_ABBREV = re.compile(r'\s*\([^)]{1,40}\)')          # "... (DKA) and ..."


def norm(s):
    s = unicodedata.normalize('NFKD', s)
    s = s.replace('&', ' and ')
    s = re.sub(r'[^A-Za-z0-9]+', ' ', s).lower()
    return ' '.join(s.split())


def norm_loose(s):
    """As norm(), but also drops parenthesised asides, so
    'Diabetic Ketoacidosis (DKA) and ...' meets 'Diabetic Ketoacidosis and ...'."""
    return norm(_ABBREV.sub(' ', s))


def title_score(toc_title, body_title):
    """0..1.  How much of the shorter title is covered by the longer one.

    The book reprints titles with words added ('(DKA)'), dropped ('Deep Vein')
    and misspelled ('Inflamatory'), so an exact test throws away real matches.
    Token overlap in order is forgiving of all three without being so loose
    that two different conditions look alike.
    """
    a, b = norm_loose(toc_title).split(), norm_loose(body_title).split()
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    inter = len(sa & sb)
    # coverage of the SHORTER title: a wrapped heading is a prefix of the
    # full title, and must not be punished for the part that is still to come.
    cover = inter / min(len(sa), len(sb))
    # a prefix match is strong evidence
    n = min(len(a), len(b))
    prefix = sum(1 for i in range(n) if a[i] == b[i]) / n
    return max(cover, prefix)


# ── heading candidates in the body ─────────────────────────────────────────
# A number, optionally followed by a dot, then the title.  The space after the
# number is optional because the conversion sometimes swallows it
# ("5.3.1Definition").
NUMBERED = re.compile(r'^(\d+(?:\.\d+)*)\.?\s*(\S.*)$')

# every way this book writes "ICD10 CODE:" that we have seen, plus slack for
# the ones we have not.  C?ICD covers the "CICD10" typo; 1[01] covers "ICD11".
ICD_TAIL = re.compile(r'\s*C?ICD\s*-?\s*1[01]\s*CODES?\s*[:\-]?\s*(.*)$', re.I)

# a heading that wrapped: the line ends mid-word with a hyphen, or simply ran
# out of room.  Joining is only attempted while scoring improves.
HYPHEN_END = re.compile(r'([A-Za-z])-$')


def strip_icd(text):
    """('Asthma', 'J45') from 'Asthma ICD10 CODE: J45'."""
    m = ICD_TAIL.search(text)
    if not m:
        return text.strip(), ''
    return text[:m.start()].strip(), m.group(1).strip()


# Some sections print the code on the line BELOW the heading rather than on it.
# Anchored at the start of the line, deliberately: the next non-blank line after
# a parent heading such as "1.1 Common Emergencies" is usually its first child
# ("1.1.1 Anaphylactic Shock ICD10 CODE: T78.2"), and taking the code out of
# that line would hand the parent its child's code - the same borrowing this
# rebuild exists to stop. Requiring the marker to open the line admits
# "ICD10 CODE: A01.00" under Typhoid and refuses the child headings.
ICD_OWN_LINE = re.compile(r'^\s*C?ICD\s*-?\s*1[01]\s*CODES?\s*[:\-]?\s*(.+)$', re.I)


def icd_below(lines, i, look=3):
    """The code printed on its own line just under the heading at i, or ''."""
    for k in range(1, look + 1):
        if i + k >= len(lines):
            break
        s = lines[i + k].strip()
        if not s:
            continue
        m = ICD_OWN_LINE.match(s)
        return m.group(1).strip() if m else ''
    return ''


def join_wrapped(lines, i, take=2):
    """The heading text at line i, plus up to `take` continuation lines.

    Yields progressively longer candidates so the caller can keep whichever
    scores best.  A hyphen at the end of a line is a broken word and is
    rejoined without a space; anything else joins with one.
    """
    out = [lines[i]]
    yield lines[i]
    cur = lines[i]
    for k in range(1, take + 1):
        if i + k >= len(lines):
            return
        nxt = lines[i + k].strip()
        if not nxt or TOC_RE.match(nxt):
            return
        m = HYPHEN_END.search(cur)
        cur = (cur[:-1] + nxt) if m else (cur + ' ' + nxt)
        out.append(nxt)
        yield cur


def candidates(lines):
    """Every line that could be a numbered heading -> (idx, number, rest).

    The contents is skipped wholesale by line range rather than by re-matching
    TOC_RE, because the four entries printed with a single dot are not caught
    by the strict pattern and would otherwise be mistaken for body headings -
    pointing those sections at page ii of the book instead of their real text.
    """
    lo, hi = toc_region(lines)
    for i, l in enumerate(lines):
        if not l or lo <= i < hi:
            continue
        m = NUMBERED.match(l)
        if not m:
            continue
        yield i, repair_number(m.group(1)), m.group(2)


# ── matching ───────────────────────────────────────────────────────────────
ACCEPT = 0.60          # below this we do not believe the match


def resolve(lines, toc, verbose=False):
    """Match every TOC entry to a body line.  Returns (spine, unmatched)."""
    # Bucket candidate lines by their printed number so the common case is a
    # direct lookup, but keep a title index for the cases where the book
    # misprints the number (20.2.25.1 for 20.2.5.1, 21.2.5 for 21.2.6).
    by_num = {}
    cands = list(candidates(lines))
    for i, num, rest in cands:
        by_num.setdefault(num, []).append((i, rest))

    spine, unmatched = {}, []
    for num, entry in toc.items():
        # A chapter opener carries no number in the body - it is printed as a
        # bare title ("Ear, Nose & Throat Conditions") while the page's running
        # header contributes stray lines like "1:" and "24 : Surgery".  Hunting
        # for it finds the running header instead, so chapters are taken from
        # the contents and from each section's own leading number.
        if entry['depth'] == 1:
            continue
        best = None                      # (score, idx, title, icd, how)

        # 1. the number as printed matches the number in the contents
        for i, rest in by_num.get(num, []):
            for cand in join_wrapped(lines, i):
                body = NUMBERED.match(cand).group(2)
                title, icd = strip_icd(body)
                s = title_score(entry['title'], title)
                if best is None or s > best[0]:
                    best = (s, i, title, icd, 'number')

        # 2. the book misprinted the number: find the title instead, and
        #    require it to sit between its neighbours in the book's order.
        if best is None or best[0] < ACCEPT:
            for i, cnum, rest in cands:
                if cnum == num:
                    continue
                # only consider a number of the same depth, near this one
                if cnum.count('.') != num.count('.'):
                    continue
                if cnum.split('.')[0] != num.split('.')[0]:
                    continue
                for cand in join_wrapped(lines, i):
                    body = NUMBERED.match(cand).group(2)
                    title, icd = strip_icd(body)
                    s = title_score(entry['title'], title)
                    if s >= 0.85 and (best is None or s > best[0]):
                        best = (s, i, title, icd, 'title:printed-%s' % cnum)

        if best and best[0] >= ACCEPT:
            spine[num] = dict(entry, line=best[1], body_title=best[2],
                              icd10=best[3], score=round(best[0], 3),
                              how=best[4])
        else:
            unmatched.append((num, entry['title'],
                              round(best[0], 3) if best else None))

    return spine, unmatched


# A heading printed in the body but absent from the contents.  Thirteen of
# these exist, and left unclaimed each one's text is silently swallowed by the
# section above it - the very fault this rebuild exists to remove.  Verified by
# reading all thirteen: they include 2.1.5.2 Cryptococcal Meningitis, 23.2.2.1
# Nursing Caries and 23.2.4.1 Post-Extraction Bleeding, each with its own
# Causes and Clinical features.
ORPHAN = re.compile(r'^(\d+(?:\.\d+){1,3})\.?\s*([A-Z][A-Za-z].{2,70})$')


def find_orphans(lines, spine, drop=()):
    """Body headings the contents never listed."""
    claimed = {v['line'] for v in spine.values()}
    seq = sorted(spine.values(), key=lambda v: v['line'])
    bounds = [(v['line'], b['line']) for v, b in zip(seq, seq[1:])]
    if seq:
        bounds.append((seq[-1]['line'], len(lines)))

    out = []
    for start, end in bounds:
        for i in range(start + 1, end):
            if i in claimed or i in drop:
                continue
            m = ORPHAN.match(lines[i].strip())
            if not m:
                continue
            num = repair_number(m.group(1))
            if num in spine:
                continue
            title, icd = strip_icd(m.group(2))
            out.append({'number': num, 'title': title.strip(),
                        'body_title': title.strip(), 'icd10': icd,
                        'line': i, 'page': None, 'score': 1.0,
                        'how': 'orphan', 'depth': num.count('.') + 1,
                        'order': None})
    return out


def main():
    lines = load_lines()
    toc = parse_toc(lines)
    spine, unmatched = resolve(lines, toc)
    orphans = find_orphans(lines, spine)
    for o in orphans:
        spine[o['number']] = o

    sections = {n: e for n, e in toc.items() if e['depth'] > 1}
    print('TOC entries      :', len(toc), '(%d chapters, %d sections)'
          % (len(toc) - len(sections), len(sections)))
    print('matched to body  :', len(spine))
    print('unmatched        :', len(unmatched))
    byhow = {}
    for v in spine.values():
        byhow[v['how'].split(':')[0]] = byhow.get(v['how'].split(':')[0], 0) + 1
    print('how              :', byhow)
    print('with ICD on line :', sum(1 for v in spine.values() if v['icd10']))

    print('\n-- unmatched --')
    for num, title, s in sorted(unmatched,
                                key=lambda t: [int(x) for x in t[0].split('.')]):
        print('  %-10s %-55s best=%s' % (num, title[:55], s))

    # order sanity: body line order should follow book order.  Orphans carry no
    # contents order, so they are checked by line position only.
    seq = sorted((v for v in spine.values() if v['order'] is not None),
                 key=lambda v: v['order'])
    bad = [(a['number'], a['line'], b['number'], b['line'])
           for a, b in zip(seq, seq[1:]) if b['line'] < a['line']]
    print('\nout-of-order pairs:', len(bad))
    for t in bad[:20]:
        print('   %s@%d then %s@%d' % t)

    # weak matches are the ones a human should look at
    weak = sorted((v for v in spine.values() if v['score'] < 0.9),
                  key=lambda v: v['score'])
    print('\nweakest matches (%d below 0.90):' % len(weak))
    for v in weak[:25]:
        print('  %.2f %-9s toc=%-40s body=%-40s' %
              (v['score'], v['number'], v['title'][:40], v['body_title'][:40]))


if __name__ == '__main__':
    sys.exit(main())
