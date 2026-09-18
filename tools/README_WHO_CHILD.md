# The children's guideline database (`who_child_2023.db`)

## What it is

A searchable, offline copy of the **WHO Pocket book of primary health care for
children and adolescents** (WHO Regional Office for Europe, ISBN
978-92-890-5762-2), bundled with the clinic app next to the Uganda Clinical
Guidelines 2023.

The Uganda guidelines remain the national standard and the app's default. This
book is there for the one thing the UCG cannot answer in a single step:

> *This child weighs 11 kg. How much amoxicillin do I give?*

The book prints a dose for every weight band. The app shows the band — it never
works a dose out for itself.

## What is in it

| Table | Rows | What it holds |
|---|---|---|
| `conditions` | 234 | One per section, with the book's own headings split into columns (history, examination, investigations, diagnosis, treatment, referral, follow-up …) |
| `tables` | 251 | Every table in the book, kept verbatim as markdown |
| `drugs` | 176 rows, 153 medicines | The dosing annex: name, indication, dosage, formulation — plus the printed row it came from |
| `drug_doses` | 597 | One row per drug × weight band |
| `condition_drugs` | 352 | Which annex drugs each condition's treatment text names |
| `medicines` | 43 | Medicines named in a section, with a per-kg dose |
| `chapters` | 9 | |
| `conditions_fts`, `drugs_fts` | | FTS5 search |
| `meta` | | Provenance: source filename, SHA-256, build date, counts |

## How to rebuild it

```bash
python3 tools/build_who_child_db.py <the-book.md> app/clinic/data/who_child_2023.db
```

The third argument is the EMHSLU database used as a medicines vocabulary; it
defaults to `app/clinic/data/emhslu_2023.db`.

The source markdown is **not** committed — it is a WHO publication, and the
Uganda guidelines source is not committed either. Provenance is recorded
instead: `meta.source_sha256` pins the exact file the database was built from.

## The two rules the builder keeps

**1. Nothing is invented.** Every dosing cell is stored exactly as printed.
Where the PDF stacked several formulations into one cell (`5 mL ½ –`), the
stack is kept whole rather than guessed apart. A wrongly split paediatric dose
is a poisoning. For the same reason a dose is only ever labelled with a weight
band when the table's columns line up — an unlabelled dose is honest, a
mislabelled one is dangerous.

**2. Nothing safety-critical is dropped.** The book's `DO NOT` warnings are
lifted into their own `cautions` column so the app can always show them, above
the fold, rather than leaving them buried in a section that might be collapsed.

## What the conversion had to repair

The PDF→markdown conversion damaged the text in ways that would have quietly
corrupted the data:

- **Bullets vanished** into a stray control byte (`\x84`, 2197 of them) and a
  lone letter `u` (a Wingdings arrow read as a letter). Left alone, a list of
  findings arrives as one run-on sentence.
- **Drop capitals moved to the end of the line** — `he role of the primary
  health care provider T`.
- **Long table cells wrapped into extra rows**, so `Benzylpenicillin` arrived
  as a row called `Benzyl` followed by one called `penicillin`, each carrying
  half the doses. Those tails are reattached, never dropped.
- **Chapter contents lists appear in three different shapes**, one of them a
  markdown table. Anchoring a section to a contents line instead of to its real
  heading leaves it with no text at all — which is what happened to the whole
  of Chapter 4 before this was caught.
- **Two-column pages turned prose into one-cell table rows**, which would have
  been skipped as tabular data.

**Two drugs in one sentence.** `Adrenaline (see epinephrine) Cefotaxime 50
mg/kg` is one line of a table. Reading `50 mg/kg` as adrenaline's dose would
have put a fivefold overdose on the screen, so a number is discarded whenever
another drug name sits between it and the drug it would be filed under.

One thing could **not** be repaired: in some annex cells the PDF interleaved
the dosage and formulation columns, giving text like `25 mg/kg twice a
daySyrup 250 mg/5 mL`. No parsing untangles that safely, so the app shows the
parsed fields *and* the printed row beneath them, and says so.

## How it was verified

Checked against the source text, not assumed:

| Check | Result |
|---|---|
| Every dose cell appears verbatim in the source | 597 / 597 |
| Every dosage and formulation field appears verbatim | 314 / 314 |
| Every stored table block appears in the source | 251 / 251 |
| Every `treatment` line appears verbatim | 833 / 833 |
| Every `history` line appears verbatim | 826 / 826 |
| Every `examination` line appears verbatim | 703 / 703 |
| Every `investigations` line appears verbatim | 349 / 349 |
| Every `referral` line appears verbatim | 319 / 319 |
| Every `follow_up` line appears verbatim | 239 / 239 |
| Every `clinical_features` line appears verbatim | 231 / 231 |
| Every DO NOT warning appears verbatim | 151 / 151 |
| Every medicine's source sentence appears verbatim | 43 / 43 |
| Weight bands are real bands, never invented | 16 distinct, all `n–<n kg` or `Adult` |

Nothing in this database is paraphrased. Every figure and every sentence is a
substring of the book.

Plus `offline-test/test-who.js`, which drives the real page in a real browser
and checks an 11 kg child lands on the row the database says it should.

## Known limits

- 195 of 197 numbered sections and 39 of 59 named sub-conditions anchor to
  their own row. The rest are inside their parent section's text and are still
  found by search — `otitis media`, `malnutrition`, `dehydration` and
  `anaphylaxis` all return the section that covers them.
- Interleaved dosage/formulation cells, as above.
