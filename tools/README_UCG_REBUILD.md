# Rebuilding the Uganda Clinical Guidelines database

`uganda_clinical_guidelines_2023.db` is cut from the book's own headings.
Earlier builds cut it by page range, and that one decision caused most of the
faults the clinical audit found.

```
python3 tools/build_ucg_db.py <UCG_2023.html> app/clinic/data/uganda_clinical_guidelines_2023.db
python3 tools/check_ucg_db.py app/clinic/data/uganda_clinical_guidelines_2023.db
python3 tools/build_impression_index.py      # depends on the database above
```

---

## Why it had to be rebuilt

A condition used to be defined as "the page the contents names, through to the
page the next condition starts on". A printed page carries the tail of one
condition and the head of the next, so a condition inherited its neighbour's
text. Measured across the shipped database, **179 field values were duplicated
between neighbouring conditions** — the signature of the fault. What that
looked like in the app:

| condition | what the app showed | whose text it was |
|---|---|---|
| Hairy Leukoplakia | "painless purplish swelling on the skin" | Kaposi's sarcoma |
| Painful Scrotal Swelling | "purulent discharge from one or both eyes" | conjunctivitis |
| Prostatitis | "colicky loin pain radiating to the iliac fossa" | renal colic |
| Nodding Disease | "aura: visual or sensory symptoms" | migraine |

The same slicing picked the `icd10` column by taking the first ICD-shaped token
found on the page, which usually belonged to whichever condition was printed
above. Nine of twelve well-known conditions carried the wrong code.

## How the sections are found now

`ucg_spine.py` matches the book's table of contents to its body text.

The contents is authoritative for **which** sections exist and in what order;
the body is authoritative for **where** each one starts. Matching the two is
most of the work, because the book disagrees with itself:

- **Headings wrap**, with a hyphen (`Hyperosmolar Hyper-`) and without.
- **Titles are reprinted differently** — words dropped (`Deep Vein`), an
  abbreviation inserted (`(DKA)`), spelling changed (`Inflamatory` in the
  contents vs `INFLAMMATORY` in the body).
- **Printed numbers are sometimes wrong.** The book prints `20.2.25.1` for
  `20.2.5.1`, and prints `21.2.5` for `21.2.6` — where the line actually
  numbered `21.2.6` is a different condition. Number and title each have to be
  able to win, so a title scoring ≥ 0.85 can override the number.
- **Four contents entries print a single dot** instead of a dot leader, and the
  strict pattern dropped them silently — including the whole of **chapter 9**
  (Mental, Neurological and Substance Use Disorders) and `3.1 HIV Infection and
  AIDS`. Chapter 9 was missing from the shipped `chapters` table entirely, so
  every mental-health condition showed a blank chapter name.
- **Thirteen sections are printed in the book but absent from the contents**,
  among them `2.1.5.2 Cryptococcal Meningitis`, `23.2.2.1 Nursing Caries` and
  `23.2.4.1 Post-Extraction Bleeding`. Anchoring only to the contents would let
  each one's text be swallowed by the section above it — the very fault being
  fixed — so they are recovered as orphans and verified individually.
- **One number is a typo in both places.** `117.2.10 Counsel the Mother` is
  printed that way in the contents *and* the body, sitting between `17.2.9` and
  `17.3`. Left alone it invents a chapter 117.

Chapters are not matched against the body at all. A chapter opener carries no
number there, while the running header contributes stray lines like `1:` and
`24 : Surgery` — hunting for the opener finds the running header instead.

Result: **551 sections, all matched, none unmatched, none out of order.**

## What the cleaning does

`ucg_clean.py` strips the furniture every printed page contributes:

```
306                     <- page number
Uganda                  <- running footer, one word per line
Clinical
Guidelines
2023
CHAPTER                 <- running header, also one word per line
4:
Cardiovascular          <- chapter title, one word per line
Diseases
```

That is 10,119 lines, 7.4% of the file. Left in, `Guidelines` (1000
occurrences), `Uganda` (972) and the chapter-title fragments (`Diseases` 335,
`Conditions` 180) drown out the real field headers and look exactly like
headings themselves. The block is stripped by anchor, not by guesswork: the
four-line footer is unmistakable, and the chapter title that follows is matched
against the title the contents already gave us. **No spine heading is ever
inside the stripped range** — `check_ucg_db.py` would catch it if one were.

Control characters and PDF bullet glyphs are replaced with a space rather than
removed, so the line count never changes; the spine addresses text by line
index, and adding or removing a line would move every boundary. Hyphenation is
rejoined per section, after slicing, for the same reason.

## What the fields are cut on

`ucg_fields.py` splits a section on its own labelled headers. Matching is
**exact** — the line must be nothing but a known header — and that single choice
excludes three traps found by counting the whole book:

- Flattened table header rows read as a run of field names on one line:
  `CLINICAL FEATURES INVESTIGATIONS`, `Body Part FEATURES`,
  `COMPLICATION TREATMENT`.
- Prose and sub-headings beginning with a header word:
  `Management of pneumonia` (11), `Management of stable angina` (7).
- `Prevention` appears ~129 times as a genuine header, so a header cannot be
  rejected for being a common word.

The one relaxation is a header with the condition's name attached —
`Management of Malaria`, `Investigations for Malaria`, `Treatment of
uncomplicated malaria`. These are real headers, and without them severe
malaria's `management` column held 516 characters of a 13,000-character
section: the "First line" and "Second line" wording the app ranks medicines by
fell outside it, and the package arrived with no ranking at all. Recognising
them takes that column to 5,075 characters and the ranking comes back. The
qualifier is bounded and the line must carry no sentence punctuation, so
`Management of the patient depends on…` cannot match.

A section with no headers at all — `Recommended First Line Regimens` is six
thousand characters of ARV combinations printed as a table — keeps its text in
`full_text`, and the app falls back to that.

The book's **back matter** (appendices, references, index) carries no heading
the spine recognises, so the final section is cut at the first `Appendix` /
`References` line. Without it, `Techniques for Regional Anaesthesia` — eighteen
lines of clinical text — arrived with eight hundred, ending in a list of web
addresses.

## ICD-10

Codes are read from the payload printed on each section's **own heading line**,
and nothing is inferred. Print variants handled: `ICD10 CODE:`, `ICD 10 CODE:`,
`ICD10 CODES:`, `ICD11CODE:` (Brucellosis) and `CICD10 CODES:` (Liver
Cirrhosis). Six sections print codes with the letter prefix missing
(`70.31, 70.11, 71.51`); those are left **empty rather than guessed at**,
because a wrong code travels onto forms, claims and returns and is worse than
no code.

Some sections print the code on the line *below* the heading instead of on it —
Typhoid Fever (`A01.00`) and Meningitis (`A39.0` and three more) among them.
Those are recovered, but only when the marker **opens the line**. That
restriction is the whole safety of the rule: the next non-blank line after a
parent heading like `1.1 Common Emergencies` is usually its first child,
`1.1.1 Anaphylactic Shock ICD10 CODE: T78.2`, and a looser rule would hand the
parent its child's code — the very borrowing this rebuild exists to stop.
`Common Emergencies`, `Bacterial Infections` and the other parents correctly
end up with no code at all. **278 of 551** sections carry one.

| condition | was | now |
|---|---|---|
| Appendicitis | K85 *(acute pancreatitis)* | **K35** |
| Peptic ulcer disease | K86.0 *(chronic pancreatitis)* | **K27** |
| Measles | A80.3 *(polio)* | **B05** |
| Prostatitis | N23 *(renal colic)* | **N41** |
| Painful Scrotal Swelling | P39.1 *(neonatal conjunctivitis)* | **N45** |
| Uncomplicated Malaria | B50.0 *(**cerebral** malaria)* | **B50.9** |
| Asthma / Pneumonia | none | **J45 / J13** |

## What changed for the app

Counts fell, and that is the point — the old totals were inflated by text
belonging to other conditions.

| | before | after |
|---|---|---|
| conditions | 535 | 551 |
| chapters | 23 (**no chapter 9**) | 24 |
| duplicated field text | **179** | **0** |
| conditions with an unknown chapter | 18 | 0 |
| medicines | 1232 | 847 |
| file size | 6.2 MB | 4.0 MB |

Three consequences worth knowing:

1. **A parent heading no longer holds its children's drugs.** `5.2.9 Pneumonia`
   is a parent: the book prints its definition, causes and investigations
   there, and the regimens under `5.2.9.1 …in an Infant` and so on. The app
   already offers the children when a parent has no package of its own.
2. **`2.5.2.1 Uncomplicated Malaria` genuinely contains only symptoms** — the
   book prints the treatment inside `2.5.2.2`. The app borrows it, and the
   borrowed set is the oral one: artemether/lumefantrine 20/120 mg, AS/AQ,
   quinine. **No IV artesunate, phenobarbital, furosemide or bicarbonate** —
   those stay on the severe page, which is where the book puts them.
3. **The shortlist is ordered by the book's own order**, not by how many
   medicines each section holds. Counting medicines put *Management of
   Complications of Severe Malaria* first, precisely because it is the least
   ordinary thing in the list.

## Getting a rebuilt book onto a phone

The databases are cached **cache-first and never re-downloaded**, and the
service worker migrates cached responses forward on upgrade — so bumping the
cache name alone would pin a clinic to the copy it first installed. Two things
must move together:

- `DATA_VERSION` in `app/clinic/clinic-sw.js`
- the `?v=` on the `.db` URLs in `guidelines.js`, `ucg-autofill.js` and
  `clinic-impression.js`

The migration deliberately leaves behind any `/data/*.db` whose URL carries a
different version, so the new file is fetched on the next online visit.

## Known and not fixed

**Drug names that wrap, or follow their dose, are not extracted.** In
`Dehydration in Children under 5 years` the book prints
`give Zinc supplementation Child <6 months:` on one line and `10 mg once a day
for 10 days` on the next, and writes `Give 100 ml/kg of Ringer's Lactate` with
the dose before the name. `parse_medicines` expects name-then-dose on one line
and finds neither.

This is a pre-existing limit of the dose parser, not something the rebuild
introduced — and the old database "compensated" for it by hoovering up
neighbouring text, which is how that condition came to list a drug **named
`oral`** twice, from source lines belonging to a different section. Producing
nothing is better than producing that.

Fixing it means making dose extraction more aggressive, which trades one kind
of error for another, in the component that decides what a patient is handed.
It belongs in its own change, with its own audit, not bolted onto a boundary
fix.
