#!/usr/bin/env python3
"""Cut a section's text into the columns the app reads.

The book labels each part of a condition with a short header on its own line
("Clinical features", "Investigations", "Management").  Splitting on those is
straightforward; the care is all in NOT splitting on things that merely look
like headers.

Three traps, all found by counting the whole book:

  * Flattened table header rows read as a run of field names on one line -
    "CLINICAL FEATURES INVESTIGATIONS", "CLASSIFICATION FEATURES",
    "Body Part FEATURES", "COMPLICATION TREATMENT".  Matching a header only
    when the line is EXACTLY a known header excludes all of them.
  * Prose and sub-headings that start with a header word - "Management of
    pneumonia" (11), "Management of stable angina" (7), "Refer to specialist".
    Exact matching excludes these too.
  * "Prevention" appears ~129 times as a real header, so a header cannot be
    rejected merely for being a common word.
"""
import re

# Every header spelling observed in the book, mapped to the column it feeds.
# Counts are from the whole book, after page furniture is stripped.
HEADERS = {
    # clinical_features
    'clinical features': 'clinical_features',        # 253 + 13 + 4
    'clinical feature': 'clinical_features',
    'features': 'clinical_features',                 # 6
    'signs and symptoms': 'clinical_features',
    'symptoms': 'clinical_features',
    'symptoms and signs': 'clinical_features',
    'clinical presentation': 'clinical_features',
    'presentation': 'clinical_features',
    'danger signs': 'clinical_features',
    'clinical features and diagnosis': 'clinical_features',
    # causes
    'cause': 'causes',                               # 72
    'causes': 'causes',                              # 154
    'causes/risk factors': 'causes',
    'risk factors': 'causes',                        # 21
    'aetiology': 'causes',
    'etiology': 'causes',
    'predisposing factors': 'causes',
    # differential
    'differential diagnosis': 'differential',        # 163
    'differential diagnoses': 'differential',
    'differentials': 'differential',
    # investigations
    'investigations': 'investigations',              # 195
    'investigation': 'investigations',               # 7
    'laboratory investigations': 'investigations',
    'diagnosis': 'investigations',                   # 3
    'diagnostic criteria': 'investigations',
    'case definition': 'investigations',
    # management
    'management': 'management',                      # 296 + 18 + 7
    'treatment': 'management',                       # 31 + 5 + 4
    'treatment loc': 'management',                   # 503
    'management loc': 'management',                  # 7
    'general management': 'management',
    'general principles of management': 'management',
    'goals of treatment': 'management',
    'adjunctive treatment': 'management',
    'supportive treatment': 'management',
    'monitoring': 'management',                      # 7
    # prevention
    'prevention': 'prevention',                      # 129
    'prevention and control': 'prevention',
    'prevention/health education': 'prevention',
    'prevention and health education': 'prevention',
    'health education': 'prevention',
    'prevention/health education for anaemia': 'prevention',
    # complications
    'complications': 'complications',                # 14
    'complication': 'complications',
    'complications and warning signs': 'complications',
    # notes
    'note': 'notes',                                 # 84
    'notes': 'notes',                                # 18
    'caution': 'notes',                              # 55
    'cautions': 'notes',
}

# Headers that introduce the level-of-care treatment table rather than plain
# prose.  The app looks for this marker, so it must survive into the text.
LOC_MARKERS = {'treatment loc', 'management loc'}

_TRAILING = ' :;.\t'

# The book also writes a header with the condition's name attached -
# "Management of Malaria", "Investigations for Malaria", "Treatment of
# uncomplicated malaria", "Prevention/Health Education for Anaemia". These are
# headers, not prose: without them the whole of severe malaria's treatment -
# including the "First line" and "Second line" wording the app ranks medicines
# by - falls outside the Management column and the package arrives unranked.
#
# The qualifier is bounded and the line must carry no sentence punctuation, so
# "Management of the patient depends on..." cannot match.
QUALIFIED = re.compile(
    r'^(management|treatment|investigations?|prevention|complications?|'
    r'clinical features|causes?|differential diagnosis|risk factors)'
    r'(?:\s*/\s*health education)?'
    r'\s+(?:of|for|in)\s+[A-Za-z][A-Za-z0-9 \'\-/()]{2,34}$', re.I)


def header_of(line):
    """The column this line heads, or None.

    Matching is exact (after case-folding and dropping a trailing colon), which
    is what keeps the flattened table rows - "CLINICAL FEATURES INVESTIGATIONS",
    "Body Part FEATURES", "COMPLICATION TREATMENT" - from being read as headers.
    The one relaxation is QUALIFIED above.
    """
    s = line.strip().strip(_TRAILING)
    if not s or len(s) > 48:
        return None
    key = re.sub(r'\s+', ' ', s).lower()
    hit = HEADERS.get(key)
    if hit:
        return hit
    m = QUALIFIED.match(key)
    return HEADERS.get(m.group(1).lower()) if m else None


def is_loc_marker(line):
    s = re.sub(r'\s+', ' ', line.strip().strip(_TRAILING)).lower()
    return s in LOC_MARKERS


def split(body_lines):
    """Cut a section's lines into {column: text}.

    Text appearing before the first header is the book's definition paragraph;
    it has no column of its own, so it is kept as the lead of full_text and
    also stored in notes where the app can show it.
    """
    out, order = {}, []
    cur = None
    lead = []
    for l in body_lines:
        col = header_of(l)
        if col:
            cur = col
            if col not in out:
                out[col] = []
                order.append(col)
            # the LOC marker is content the app looks for, not just a label
            if is_loc_marker(l):
                out[col].append(l.strip())
            continue
        (out[cur] if cur else lead).append(l)

    text = {k: '\n'.join(x.strip() for x in v if x.strip()).strip()
            for k, v in out.items()}
    return text, '\n'.join(x.strip() for x in lead if x.strip()).strip()
