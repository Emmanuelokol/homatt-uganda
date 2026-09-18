# The tests

Every one of these opens the real pages in a real browser, with the network
mocked. There is no unit-test framework: each file starts a small web server
over `app/`, loads a page, drives it the way a clinician would, and prints one
line per thing checked.

```
PASS  speaking the readings fills the four boxes  — {"t":"38.5","s":"120",…}
FAIL  a bare number is never assigned to a box
```

That format is the whole contract. `run-all.js` counts the lines.

## Running them

```bash
cd tests
npm install                      # playwright only
npx playwright install chromium  # skip if the machine already has Chromium
node run-all.js                  # all of them
node run-all.js dictate pay      # only files whose name contains these
node test-dictate.js             # one, with its full output
```

`chrome.js` finds a browser: `HOMATT_CHROME` if set, then any Playwright
download, then a system Chrome/Chromium. It says what to do when there is none.

The whole suite takes about 25 minutes, most of it in `test-datacost.js`, which
sits idle for 90 seconds at a time on purpose — the thing it is proving is that
an open screen does **not** talk to the server, and you cannot prove that
quickly.

## What each one is for

| file | what it protects |
|------|------------------|
| `test-dictate.js` | the vitals parser, the story split, and that a model can never set a number or name a patient it did not hear |
| `test-dictation-status.js` | the clinic being told when the speech service is out of credit, rather than "try again later" |
| `test-intake.js`, `test-who.js`, `test-safety.js` | the intake screen, danger signs, and who the patient is |
| `test-guidelines.js`, `test-twodx.js`, `test-shortlist.js` | the suggestion engine reading the bundled books |
| `test-emhslu.js`, `test-spelling.js` | the medicine list and how names are matched |
| `test-stock*.js`, `test-batches.js`, `test-deduct.js`, `test-sell-liquids.js` | stock, batches and what leaves the shelf |
| `test-billing.js`, `test-pay.js`, `test-owed.js`, `test-onetap-money.js` | money |
| `test-offline-figures.js`, `test-newitem-offline.js`, `test-stale.js` | what the app does with no connection |
| `test-datacost.js` | that an idle screen does not spend mobile data |
| `test-look.js`, `test-tidy.js`, `test-compact.js`, `test-patient-record.js` | the four looks, dark mode, and that every word is readable |
| `test-noreferral.js` | the words the app is not allowed to use on screen |
| `test-version.js` | the service worker's cache list matching what the pages actually ask for |
| `test-clinician.js` | a clinician signing up with no clinic, their own record, and joining one by code |
| `test-clinic-clinicians.js` | the owner's side — the QR, who joined, who they treated, ending it, the reference |
| `test-clinician-gating.js` | what a visiting clinician cannot reach, and that the money leaves the saved record as well as the screen |
| `test-voice-optional.js` | all three microphones going away together, and every box they filled still being typeable |
| `test-guidelines-browse.js` | the contents page, the sections the import buried, and text laid out rather than dumped |
| `test-guidelines-search.js` | that a word anywhere in the book can be found — not only a word in a heading — and that a bare heading lists what is under it |
| `test-doses.js` | that a drug is only ever offered for the condition the book prints it under, and the cases where that rule must NOT fire |

Two of these are not browser tests at all:

| | |
|---|---|
| `run-sql.sh` | starts a real Postgres, applies the real migrations, and drives the RLS policies, the security-definer RPCs and the trigger. Nothing that mocks the network can reach any of those. |
| `measure-qr.js` | compares the QR encoder against python-qrcode, every module of every symbol, 10 versions × 4 levels × 8 masks. |

`measure-*.js` and `audit-*.js` are not tests — they print a measurement (how
many of 30 dictations land in the right box, how many of the 750 essential
medicines the dose parser reads). Run them when changing the thing they
measure, and put the number in the commit message.

Three worth knowing about, because they answer questions that reading cannot:

| | |
|---|---|
| `measure-search.js` | what a clinician can and cannot find. It also reports whether the shipped WASM has FTS5 — it does not, which is why every search in this app quietly ran as `title LIKE` until it was measured. |
| `measure-doses.js` | every one of the 1,008 medicine rows against the book text it came from: is the line really in that section, is the dose readable in that line, and is the section printed under that heading at all. |
| `measure-panel-text.js` | **a measurement that says no.** It was written to justify replacing the package's layout rule with the guideline screen's, and it showed that rule would cut 1,723 sentences in half here. The change was dropped and the number kept. |

## Writing another one

Copy the top of any file. The parts that matter:

- **Say what the clinician gets, not what the function returns.** `PASS  a
  dictated abnormal reading is coloured like a typed one` is a sentence someone
  can disagree with. `PASS  parseVitals returns object` is not.
- **Print the evidence** as the third argument, so a failure is diagnosable
  without a debugger.
- **Mock Supabase at `page.route`**, and abort everything else — a test that
  reaches the real internet fails at the wrong time for the wrong reason.
- **Never assert on a colour by name.** Measure the contrast ratio against the
  computed background, in all four skins and both themes. Three separate
  unreadable-text bugs got through eyes and were caught by a number.
## A known flake, so nobody chases it as a regression

`test-dictate.js` crashes roughly one run in four with:

```
CRASH page.evaluate: Execution context was destroyed, most likely because
      of a navigation
```

always at the same place — the first `speak()`, which holds one `evaluate()`
open for about 460 ms while it drives the dictate button. It stops the file at
14 of 52 checks, which reads exactly like a real regression in dictation.

It is not one, and that was measured rather than assumed:

- the identical crash, at the identical step, happens on the code from **before**
  the clinician-portal branch (checked out in a worktree at 1ac2510: 5 full runs,
  1 crash, out of 6 — against 5 and 3 of 8 on the branch);
- driving that exact click sequence on its own — stub the microphone, stub
  MediaRecorder, click, wait, click — succeeded 8 times out of 8;
- nothing navigates: a probe listening on `framenavigated` recorded only the
  `goto` itself, and `pwa-install.js` deliberately does **not** reload on
  `controllerchange`.

So the app is not reloading itself under a clinician; the harness is losing the
renderer. Re-run the file on its own before believing it.

**Do not "fix" it by waiting for `load` instead of `domcontentloaded`.** That was
tried: it made the crash go from intermittent to **every single run**, because
waiting longer lands the evaluate squarely in the window where the context goes.

- **Give it a port nobody else uses.** They run as separate processes in
  sequence, so a duplicate looks harmless — and then one of them starts finding
  an empty page and failing only inside the suite, never on its own.
  `grep -ho "PORT = [0-9]*" test-*.js | sort | uniq -d` should print nothing.
- **Check it is looking at the page it thinks it is.** Three clinician screens
  once reported a confident pass at exactly 36 elements each — the same 36,
  because a shared session sent every one of them to the sign-up page. A count
  that is suspiciously equal across different screens is the tell.
