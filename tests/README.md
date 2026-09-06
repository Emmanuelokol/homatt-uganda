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

`measure-*.js` and `audit-*.js` are not tests — they print a measurement (how
many of 30 dictations land in the right box, how many of the 750 essential
medicines the dose parser reads). Run them when changing the thing they
measure, and put the number in the commit message.

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
