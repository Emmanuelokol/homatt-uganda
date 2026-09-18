# The suggestion engine (`impression_index.db`)

## What it does

On the New Treatment screen, as the nurse writes, the app suggests up to three
conditions worth considering — each with what in the record pointed to it, the
book and page it came from, and the tests that would confirm it.

## What it is not

**It does not diagnose, and the number beside each suggestion is not a
probability of disease.** No text match can know that. The figure is a *match
strength*: how strongly the findings written down line up with how the
guideline describes that condition. The screen says exactly that, every time,
and the clinician confirms the diagnosis — the app never does.

## Where the answers come from

| Source | Rows | What it contributes |
|---|---|---|
| WHO pocket book, 44 "Differential diagnosis of X" tables | 241 | A clinician-written map from presenting complaint to candidate diagnoses, each with the findings in its favour |
| Uganda Clinical Guidelines 2023 | 472 | Every condition, reduced to title, clinical features and investigations |
| `dx_tests` | 320 | The confirming tests, 246 of them as the clinic's own orderable test names |

Both books are reduced into a single **756 KB** index. The 3.3 MB children's
book and the 6 MB UCG file are not needed for this to work.

## How it works

713 short documents, scored with **BM25** in JavaScript:

- Fields are weighted by how much they mean. A symptom listed under "in favour
  of pneumonia" is evidence; the same word buried in a chapter is a hint.
  `diff`: diagnosis ×4, presenting symptom ×1, in-favour ×10.
  `ucg`: title ×5, clinical features ×14, investigations ×1.
- **IDF** is what makes it work at all. "Fever" appears in a third of the book
  and narrows nothing; "stiff neck" nearly names the diagnosis. Counting them
  equally put *Leprosy* above *Meningitis* for a patient with a stiff neck.
- Vitals become words: 39.4 °C is not something a book can match, "fever" is.
  40 °C and over adds "hyperpyrexia", a pulse of 120+ adds "tachycardia".
- **Lay speech is translated** to the words the books use — "shortness of
  breath", "running stomach", "hot body", "fits". Without this, "shortness of
  breath" becomes the useless words "short" and "breath", and anaemia loses to
  asthma.
- The final order is `0.62 × match + 0.38 × coverage`, and the percentage shown
  IS that number, so the list never shows 52% above 79%.
- A condition **this clinic has treated before** gets a small nudge (at most
  +0.06), from its own one-tap history. That is the clinic's own data — not an
  invented claim about Ugandan epidemiology, which these two books cannot
  support.
- **Sex and age gate the list before scoring.** 83 conditions can only happen
  to one sex; until the sex is recorded every one is held back, and the count
  is shown. Age is banded paediatric (<5) / child (5-12) / adult (>12), and a
  child's package never arrives with an adult dose ticked.

### Why not SQLite FTS5

Because it is not there. The SQLite build this app ships (sql.js) has **no
FTS5 module** — every `MATCH` query throws `no such module: fts5`. The
Guidelines page had been silently falling back to a `LIKE` scan for months
without anyone noticing. Rather than depend on a feature that does not exist,
the corpus is small enough to score in JavaScript: the index builds in well
under a second and a query takes milliseconds, on the phone, with no network.

## How well it works

Measured against benchmarks built from the books, not from examples chosen to
flatter it:

| Benchmark | Result |
|---|---|
| Given the findings the WHO book itself lists in favour of a diagnosis, is that diagnosis in the top 3? | **237 / 241 (98%)** |
| Given half of a UCG condition's clinical features, is that condition in the top 3, competing against all 535? | **290 / 306 (94%)** |
| Twelve presentations written by hand | 9 / 12 |

Both benchmarks supply the patient's sex, because the engine holds sex-specific
conditions back until it is recorded — measuring without it would measure the
gate, not the retrieval. With the sex blank, 83 conditions are withheld and the
screen says so.

The three hand-written misses are answered with a clinically adjacent
condition — *severe dehydration* for a dehydrated child with diarrhoea,
*otitis externa* for otitis media, *heart failure* for anaemia. They are
reported here rather than tuned away, because tuning against twelve examples I
wrote myself would improve the number and not the medicine.

`offline-test/test-intake.js` then checks that the **browser gives the same
answers as the tuned engine** — without that, the figures above would say
nothing about what a nurse actually sees.

## Two things deliberately not done

**Confirming tests come only from the guideline's own "Investigations"
section.** Scanning whole chapters was tried and abandoned: the malaria chapter
mentions "Normal CSF" and "Hb <5 g/dl" as defining features of *severe*
malaria, and a keyword scan turned those into "do a lumbar puncture" as the way
to confirm malaria. Where the guideline names no investigation, the screen says
so.

**Only named tests are orderable.** "Diagnosis is mainly by clinical features"
is a sentence, not a test; it is shown as the book's words and never added to a
lab order, because a patient must not be billed for it.

## Known gaps

- Malaria and urinary tract infection have **no parsed "Investigations"
  section** in the UCG database, so no confirming test is offered for either —
  the two commonest reasons a Ugandan clinic runs a test. This is a defect in
  the existing `uganda_clinical_guidelines_2023.db` parse, not in this engine,
  and fixing it means rebuilding that database.
- **About one UCG condition in six carries another condition's clinical
  features.** Judged by hand on a random sample of 20: Hairy Leukoplakia shows
  Kaposi's sarcoma, Nodding Disease shows migraine, Painful Scrotal Swelling
  shows conjunctivitis, Prostatitis shows renal colic. Two of them (Leprosy,
  Diphtheria) are worked around here by cutting the field at a runaway heading;
  the rest are not, and cannot be without rebuilding that database. This
  degrades the UCG half of the engine. The WHO differential half is unaffected
  and is the one verified at 98%. See `AUDIT_2026-09.md`.
