#!/usr/bin/env python3
"""The parts of the book that are not a condition, and had no section at all.

WHAT WAS MISSING, AND HOW MUCH
------------------------------
`ucg_spine.py` cuts the book on its own numbered headings, and it does that
well: measured against the source, the section spans are contiguous — one
section ends exactly where the next begins — so no clinical text is lost
between them, and the app holds essentially all of it.

What it cannot cut is everything printed OUTSIDE that numbered spine. The
spine starts at the first numbered heading and `build_ucg_db.back_matter_start`
deliberately stops it before the appendices, so two blocks of the book had no
section, no search entry and no way to be read:

    front matter   64,670 letters   abbreviations, and the Introduction
    back matter    27,087 letters   the four appendices and the references

"Front matter" undersells it. That block carries **Prescribing Guidelines**,
**INJECTIONS**, **PRESCRIPTION WRITING RULES**, controlled-medicine
prescriptions, prescribing in children and the elderly, medicine interactions,
patient counselling, **Antimicrobial Resistance**, Appropriate Medicines Use
and the Seven Steps in a Primary Care Consultation. A clinician looking up how
to write a legal prescription, or what the book says about AMR, found nothing.

The back matter carries **Appendix 3, the National Laboratory Test Menu** —
which tests a HC II, HC III, HC IV, general district hospital or national
referral hospital can actually run. That is a clinical question asked every
day, and the answer was in the book and not in the app.

HOW IT IS CUT
-------------
By the book's own headings, named here as anchors rather than by line number,
because a line number is a fact about one conversion of one file and a heading
is a fact about the book. Every anchor must be found exactly once inside its
range or the build fails loudly — a reference section that silently came out
empty would be worse than not having it, because it would look answered.

The result is one extra chapter. It is numbered 25 so it sorts after the
book's 24, and it is titled as what it is: reference, not a condition. Nothing
in it is a diagnosis and nothing in it carries a dose for a patient, so it is
deliberately kept out of the suggestion engine's index (see
`build_impression_index.py`, which reads chapters 1-24).
"""
import re

CHAPTER_NO = 25
CHAPTER_TITLE = 'REFERENCE: PRESCRIBING, ABBREVIATIONS AND APPENDICES'

# (number, title, start anchor, end anchor)
#
# The anchor is the heading line as the book prints it, matched whole and
# case-insensitively after whitespace is squashed. The end anchor is the
# heading of whatever comes next, so the ranges tile the block with no gap.
FRONT = [
    # The book's own table of contents sits between the Foreword and the
    # Preface and is deliberately NOT brought in: it is a list of page numbers
    # for a printed copy, and the app builds its own contents page from the
    # sections themselves, which is both complete and tappable.
    ('25.0',  'Foreword',
     'Foreword', 'Contents'),
    ('25.1',  'Preface and Acknowledgements',
     'Preface', 'Abbreviations'),
    ('25.2',  'Abbreviations and Acronyms',
     'Abbreviations', 'Introduction to Uganda Clinical Guidelines'),
    ('25.3',  'Introduction to the Uganda Clinical Guidelines',
     'Introduction to Uganda Clinical Guidelines', 'Primary Health Care'),
    ('25.4',  'Primary Health Care',
     'Primary Health Care', 'How to diagnose and treat in primary care'),
    ('25.5',  'How to Diagnose and Treat in Primary Care',
     'How to diagnose and treat in primary care', 'Appropriate Medicines Use'),
    ('25.6',  'Appropriate Medicines Use',
     'Appropriate Medicines Use', 'Antimicrobial Resistance (AMR)'),
    ('25.7',  'Antimicrobial Resistance (AMR)',
     'Antimicrobial Resistance (AMR)', 'Prescribing Guidelines'),
    ('25.8',  'Prescribing Guidelines, Including Injections',
     'Prescribing Guidelines', 'Prescription writing'),
    ('25.9',  'Prescription Writing, Controlled Medicines and Counselling',
     'Prescription writing', None),          # to the end of the front matter
]

BACK = [
    ('25.10', 'Appendix 1: Standard Infection Control Precautions',
     'Appendix 1', 'Appendix 2'),
    ('25.11', 'Appendix 2: Pharmacovigilance and Adverse Drug Reaction Reporting',
     'Appendix 2', 'Appendix 3'),
    ('25.12', 'Appendix 3: National Laboratory Test Menu by Level of Care',
     'Appendix 3', 'Appendix 4'),
    ('25.13', 'Appendix 4: References',
     'Appendix 4', None),                    # to the end of the book
]


def _squash(s):
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


def _find(lines, anchor, lo, hi, mask):
    """The line index of `anchor`, as a whole line, within [lo, hi)."""
    want = _squash(anchor)
    for i in range(lo, hi):
        if i in mask:
            continue
        if _squash(lines[i]) == want:
            return i
    return None


def sections(lines, mask, front_lo, front_hi, back_lo, back_hi):
    """Every reference section, in printed order, with its line span.

    front_lo..front_hi is the block before the first numbered heading;
    back_lo..back_hi is the block after the last one. Both half-open.

    Raises ValueError naming the anchor that could not be placed — a silent
    miss here produces an empty card that looks like an answer.
    """
    out = []
    for block, lo, hi in ((FRONT, front_lo, front_hi), (BACK, back_lo, back_hi)):
        for number, title, start, end in block:
            s = _find(lines, start, lo, hi, mask)
            if s is None:
                raise ValueError(
                    f'reference anchor not found: {number} "{title}" '
                    f'expected a line reading "{start}" between {lo} and {hi}')
            e = _find(lines, end, s + 1, hi, mask) if end else hi
            if e is None:
                raise ValueError(
                    f'reference end anchor not found: {number} "{title}" '
                    f'expected a line reading "{end}" after {s}')
            if e <= s:
                raise ValueError(
                    f'reference section {number} "{title}" has no text '
                    f'(start {s}, end {e})')
            out.append({'number': number, 'title': title, 'line': s, 'end': e,
                        # Same shape as a spine section, so these go through
                        # the identical insert rather than a second path.
                        'depth': number.count('.') + 1, 'icd10': '', 'page': None})
    out.sort(key=lambda v: v['line'])
    return out


def page_of(lines, i, mask, pidx):
    """The printed page a reference line falls on, if the index knows it.

    The front matter is numbered in roman numerals in the book, which this
    index does not carry, so these legitimately come back without a page and
    the card simply does not show one.
    """
    try:
        return pidx.get(i)
    except Exception:
        return None
