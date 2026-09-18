#!/usr/bin/env python3
"""Strip the page furniture the PDF conversion left in the line stream.

Every printed page contributes a fixed block:

    306                     <- the page number
    Uganda                  <- the running footer, one word per line
    Clinical
    Guidelines
    2023
    CHAPTER                 <- the running header, also one word per line
    4:
    Cardiovascular          <- the chapter title, one word per line
    Diseases

Left in place, "Guidelines" (1000 occurrences), "Uganda" (972) and "Clinical"
(971) swamp any attempt to find real field headers, and the chapter-title
fragments ("Diseases" 335, "Conditions" 180) look exactly like headings.

The block is stripped by anchor rather than by guesswork: the four-line
Uganda/Clinical/Guidelines/2023 run is unmistakable, and the chapter title that
follows is matched against the title the table of contents already gave us, so
we never eat a real line that happens to be one word long.
"""
import re

FOOTER = ['uganda', 'clinical', 'guidelines', '2023']


def _norm_word(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def furniture_spans(lines, chapter_titles):
    """Yield (start, end) half-open ranges covering every furniture block.

    chapter_titles maps chapter number (int) -> title, so the run of
    one-word-per-line title fragments can be consumed exactly.
    """
    # The running header prints the chapter title one word per line, but it
    # keeps punctuation the contents splits on: chapter 3 prints "HIV/AIDS" as
    # a single token.  Testing each printed fragment as a substring of the
    # squashed title survives that without loosening into "any short word".
    squashed = {n: _norm_word(t) for n, t in chapter_titles.items()}
    n = len(lines)

    def eat_header(end, ch=None):
        """Consume CHAPTER / 4: / <title fragments>, returning the new end."""
        if end >= n or lines[end].strip().upper() != 'CHAPTER':
            return end
        end += 1
        if end < n:
            m = re.fullmatch(r'(\d{1,2})\s*:?', lines[end].strip())
            if m:
                ch = int(m.group(1))
                end += 1
        want = squashed.get(ch, '')
        # Chapter 24 prints the colon on its own line ("CHAPTER / 24 / : /
        # Surgery, / Radiology"), and elsewhere it leads the first title word
        # (": Surgery,"), so punctuation is stepped over rather than ending the
        # run - but only while title words keep arriving, so a real line that
        # merely starts with a colon cannot drag the strip onward.
        took = 0
        while end < n:
            s = lines[end].strip().lstrip(':').strip()
            w = _norm_word(s)
            if not w and s in ('', ':'):
                nxt = _norm_word(lines[end + 1]) if end + 1 < n else ''
                if not (want and nxt and nxt in want):
                    break
                end += 1
                continue
            if w and want and w in want:
                end += 1
                took += 1
            else:
                break
        return end

    i = 0
    while i < n - 3:
        if [_norm_word(x) for x in lines[i:i + 4]] == FOOTER:
            start, end = i, i + 4
            # the page number printed just above the footer
            if start and re.fullmatch(r'\d{1,4}', lines[start - 1].strip()):
                start -= 1
            after = eat_header(end)
            if after == end and end < n and \
                    re.fullmatch(r'APPENDIX|ANNEX', lines[end].strip().upper()):
                after = end + 1
            yield start, after
            i = max(after, i + 1)
        elif lines[i].strip().upper() == 'CHAPTER':
            # a running header that lost its footer
            end = eat_header(i)
            if end > i + 1:
                start = i
                if start and re.fullmatch(r'\d{1,4}', lines[start - 1].strip()):
                    start -= 1
                yield start, end
                i = end
            else:
                i += 1
        else:
            i += 1


def page_index(lines, chapter_titles):
    """[(line_index, page_number)] for the start of each printed page.

    The page number is printed immediately above the footer of the page it
    ends, so the text after a block belongs to the following page.
    """
    out = []
    for a, b in furniture_spans(lines, chapter_titles):
        m = re.fullmatch(r'(\d{1,4})', lines[a].strip())
        if m:
            out.append((b, int(m.group(1)) + 1))
    return out


def page_at(index, i):
    """The printed page a line falls on, or None before the first marker."""
    lo, hi = 0, len(index)
    while lo < hi:
        mid = (lo + hi) // 2
        if index[mid][0] <= i:
            lo = mid + 1
        else:
            hi = mid
    return index[lo - 1][1] if lo else None


# Some pages print the footer as one line rather than four.
ONE_LINE_FOOTER = re.compile(
    r'^(uganda\s*clinical\s*guidelines\s*(2023)?|ministry\s+of\s+health)$', re.I)


def furniture_mask(lines, chapter_titles):
    """A set of line indices that are page furniture."""
    drop = set()
    for a, b in furniture_spans(lines, chapter_titles):
        drop.update(range(a, b))
    for i, l in enumerate(lines):
        if ONE_LINE_FOOTER.match(l.strip()):
            drop.add(i)
    return drop


# ── reversed text from rotated tables ──────────────────────────────────────
# The conversion emitted some rotated-table text backwards: 'ro' for 'or',
# 'dna' for 'and', 'YFISSALC' for 'CLASSIFY'.  Reversing a line is only safe
# when it clearly turns gibberish into English, and the test has to be strict:
# silently reversing a dose line would be a patient-safety bug.
_ENGLISH = set('''the and for with give dose days blood infection management clinical
features signs test child children adults oral daily history examination laboratory
investigations prevention health visit action patient treatment refer severe fever
pain skin water food mother baby years months weeks hours mg ml if of to in or is
are not use may can should every once twice'''.split())

_REVERSED_MARKERS = {'ro', 'dna', 'eht', 'fo', 'ot', 'fi', 'ni', 'rof', 'htiw', 'si', 'era'}


def looks_reversed(line):
    """True only when the line reads as English backwards and not forwards."""
    s = line.strip()
    if len(s) < 3:
        return False
    words = re.findall(r"[A-Za-z]{2,}", s)
    if not words:
        return False
    low = [w.lower() for w in words]
    fwd = sum(1 for w in low if w in _ENGLISH)
    rev = sum(1 for w in low if w[::-1] in _ENGLISH)
    marks = sum(1 for w in low if w in _REVERSED_MARKERS)
    # demand a clear win backwards, plus at least one unmistakable marker
    return rev > fwd and (marks or rev >= 2) and rev >= 1 and fwd == 0


def unreverse(line):
    return line[::-1] if looks_reversed(line) else line
