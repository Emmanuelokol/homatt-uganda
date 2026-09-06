# CLAUDE.md

## Post-Task Summary

After completing a task that involves tool use, provide a quick summary of the work you've done.

## Eagerness

By default, implement changes rather than only suggesting them. If the user's intent is unclear, infer the most useful likely action and proceed, using tools to discover any missing details instead of guessing. Try to infer the user's intent about whether a tool call (e.g. file edit or read) is intended or not, and act accordingly.

## Parallel Tool Calls

If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in parallel. Prioritize calling tools simultaneously whenever the actions can be done in parallel rather than sequentially. For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into context at the same time. Maximize use of parallel tool calls where possible to increase speed and efficiency. However, if some tool calls depend on previous calls to inform dependent values like the parameters, do not call these tools in parallel and instead call them sequentially. Never use placeholders or guess missing parameters in tool calls.

## Reduce Hallucinations

Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any claims about code before investigating unless you are certain of the correct answer - give grounded and hallucination-free answers.

## Push Notifications

**Provider:** OneSignal
**Plugin:** `onesignal-cordova-plugin` v5 (Capacitor-compatible Cordova plugin)
**Platform:** Android-first (FCM via OneSignal)

### Credentials Storage
| Secret | Location |
|--------|----------|
| OneSignal App ID | `android/app/src/main/res/values/strings.xml` (string `onesignal_app_id`) AND Supabase secret `ONESIGNAL_APP_ID` |
| OneSignal REST API Key | Supabase secret `ONESIGNAL_REST_API_KEY` only — never in code |

### GitHub Secrets Required
Add at: **GitHub → Settings → Secrets and variables → Actions**
- `ONESIGNAL_APP_ID` — OneSignal App ID
- `ONESIGNAL_REST_API_KEY` — OneSignal REST API Key v2
- `SUPABASE_ANON_KEY` — Supabase anon key (for calling Edge Functions from CI)

### How to Trigger Notifications
Always send via the Supabase Edge Function `send-notification` — never call OneSignal REST API directly from client code.

```javascript
const { data } = await supabase.functions.invoke('send-notification', {
  body: {
    userId: 'supabase-user-uuid',
    title: 'Appointment Confirmed',
    message: 'Your booking at Kampala Clinic is confirmed.',
    data: { screen: 'appointment', id: 'booking-uuid' }
  }
});
```

### Navigation Payload Schema
```json
{ "screen": "appointment",    "id": "<booking_id>" }
{ "screen": "prescription",   "id": "<prescription_id>" }
{ "screen": "lab_result",     "id": "<booking_id>" }
{ "screen": "shop_order",     "id": "<order_id>" }
{ "screen": "medicine_order", "id": "<order_id>" }
{ "screen": "dashboard" }
```
Screen → URL mapping lives in `app/js/onesignal.js` (`SCREEN_URLS`).

### User Identity Linking
- **On login:** `oneSignalLogin(supabase_user_id)` — called in `app/js/signin.js` after auth succeeds
- **On logout:** `oneSignalLogout()` — called in `app/js/profile.js` before `supabase.auth.signOut()`

### Key Files
| File | Purpose |
|------|---------|
| `app/js/onesignal.js` | OneSignal init, login/logout helpers, notification tap handler |
| `supabase/functions/send-notification/index.ts` | Edge Function — sends notifications via OneSignal REST API |
| `.github/workflows/notify-test.yml` | Manual workflow to test end-to-end notification delivery |

### Android Requirements
- `google-services.json` from Firebase Console → place at `android/app/google-services.json`
- Min SDK: 22 (set in `android/variables.gradle`)
- `POST_NOTIFICATIONS` permission already declared in `AndroidManifest.xml`

## Dictating the History and the Vitals

**Provider:** Deepgram (`nova-2-medical`) first, OpenAI Whisper as the fallback,
both called from a Supabase Edge Function
**Scope:** who the patient is, the complaint, the story, the background and the
four vitals boxes — never a diagnosis, never a medicine

### Setup required
| What | Where |
|------|-------|
| `DEEPGRAM_API_KEY` | Supabase secret — **never** in code or a message |
| `OPENAI_API_KEY` | Supabase secret (already expected by `ai-proxy`); the fallback |
| `RECORD_AUDIO` **and** `MODIFY_AUDIO_SETTINGS` | both declared in `android/app/src/main/AndroidManifest.xml` |
| Edge Functions | deploy `supabase/functions/transcribe` and `supabase/functions/structure` |

**Both** Android permissions are required, not just the obvious one. Capacitor's
`BridgeWebChromeClient.onPermissionRequest` asks Android for `RECORD_AUDIO` and
`MODIFY_AUDIO_SETTINGS` together when a page calls `getUserMedia`, and only lets
recording start when both come back granted. A permission that is not declared
can never be granted, so omitting `MODIFY_AUDIO_SETTINGS` makes the microphone
work perfectly in a browser and fail silently in the APK. Nothing in the web
code can detect or work around that.

With neither key the button reports "Dictation is not set up on this server"
rather than failing silently.

### How it works
The phone records a short clip and posts it to the `transcribe` Edge Function,
which returns plain text. The key never reaches the phone — the same
arrangement as `send-notification` and `ai-proxy`.

`clinic-dictate.js` then does two things with that text, in this order:

1. **Rules, on the phone, instantly.** They read the vitals, the name, the sex,
   the age, and split the prose into complaint / story / background. Measured
   over 30 realistic dictations: 30/30 with every word in the right box, 0 lost
   (`measure-story.js`). This runs with no second round trip, so it is what the
   clinician sees first.
2. **`structure`, if a model key exists.** It may improve the split and name the
   patient. It may not set a number, a diagnosis, a medicine or a fee — the
   reply is filtered against a whitelist on the server *and* on the phone, and
   a split that loses words is thrown away in favour of the rules.

Everything captured is then listed in one panel at the top of the intake screen
(`#itCheck`) for the clinician to confirm before proceeding. A field nobody
filled is marked; tapping a tile opens the box it belongs to.

### Where the button is, and why
`#itSpeak` sits at the very top of the intake screen — **before** the patient's
name — because that is the order it happens in. The clinician is holding a phone
in one hand and a cuff in the other; asking them to type a name before they can
say anything puts the slowest thing first. One sentence fills the name, the sex,
the age, the complaint, the story and the background.

### Showing that it is listening
While the microphone is open, `#itDictateLive` shows a blinking dot, a row of
bars, and the elapsed time. The bars are driven by an `AnalyserNode` reading the
**actual level** off the MediaStream, one bar per slice of the spectrum. That is
deliberate: a label alone looks identical on a working microphone and a dead
one, and a clinician who cannot tell will talk into nothing and lose the whole
consultation. If the bars do not move, it is not hearing you. An older WebView
with no `AudioContext` still gets the dot, the clock and the hint.

### Two buttons, two vocabularies
`transcribe` takes a `mode` of `vitals` or `story`, which chooses the vocabulary
the recogniser is told to expect. Biasing a history toward vitals makes it hear
numbers nobody said.

| button (id) | `attach` mode | `transcribe` mode | fills |
|-------------|---------------|-------------------|-------|
| "Say who it is and what they came with" (`itDictateStory`, tab 1) | `consult` | `story` | name, sex, age, `itChief`, `itSubjective`, `itBackground` |
| "Say the readings" (`itDictate`, tab 2) | `vitals` | `vitals` | `itSbp`, `itDbp`, `itTemp`, `itWeight`, `itPulse` |

`attach(btnId, sayId, mode)` also accepts `story` — prose only, no name or sex —
which is what tab 1 used before the two were joined into one dictation.

### Knowing when the service is cut off
An empty Deepgram account is not a glitch — it will not fix itself, and a
clinician who reads it as a bad signal will keep trying all morning. So the
faults are told apart and named:

| kind | what it means | who can fix it |
|------|---------------|----------------|
| `unconfigured` | the Edge Function is not deployed (404), or is deployed with no key (503) | whoever set the project up |
| `credit` | the account is out of money (402) | whoever pays the bill |
| `auth` | the key is wrong, revoked or never set (401/403 from Deepgram) | whoever holds the key |
| `signedout` | the caller's session expired (401/403 from Supabase) | the clinician, by signing in |
| `busy` | rate limited (429) | wait a moment |
| `server` | the function itself failed (5xx) | try later |
| `unreachable` | no reply at all | the connection |
| `mic-denied` / `mic-busy` / `mic-missing` | the phone's microphone | the clinician, in phone settings |

The first row is the one that used to be invisible. A clinic that has not
deployed `transcribe` yet has *never* had dictation, and telling them "could not
reach the dictation service" sends them to look at their internet for a week.
The status decides the message; the gateway's own words ("Requested function was
not found") are never shown to a nurse.

Two places show it:
- **On the phone**, the message appears under the button, and the last fault is
  kept in `localStorage` under `homatt_dictation_fault`.
- **In the admin**, Settings → *Dictation* has a **Check now** button. It posts
  `{ "probe": true }` to `transcribe`, which asks Deepgram whether the key is
  live and what is left on the account **without sending any audio**, so it
  costs nothing. Under $5 it warns while dictation still works; at zero it says
  the account is empty. It also shows what this device last ran into.

### The rules it follows, and why
- **Nothing spoken is ever lost.** In the story, every word ends up in the
  complaint, the history or the background; anything ambiguous goes to the
  history, where the clinician reads it back. A lost sentence is the fault that
  matters in prose, because it looks exactly like a sentence that was never
  said.
- **The chief complaint is one thing.** It is only set when the box is empty;
  "also complains of joint pain" on a second dictation joins the history.
- **Vitals replace, prose appends.** A re-taken temperature overwrites the old
  one; a second sentence adds to the story rather than wiping it.
- **A value is taken only when the clinician said what it was** — a label
  ("temp", "pulse") or an unambiguous unit ("kg", "mmHg"). A bare "38.5" fills
  nothing. Guessing which box a number belongs to is how a temperature ends up
  in the weight field.
- **Every reading is range-checked** against what a human body can do, and one
  outside it is reported rather than stored: "Ignored temp 385 — outside
  30–45 °C".
- **A model may only report a name it actually heard.** Asked to fill a form, a
  model will oblige; a plausible Ugandan name on a consultation nobody named is
  worse than an empty box, because it reads like a record. `saidAloud()` checks
  every word of a suggested name against the transcript, on the phone and on
  the server.
- **A model never touches a number.** The vitals come from rules that cannot
  hallucinate a temperature. `age` is the only number `structure` may return,
  and it is bounded.
- **Never a diagnosis, never a drug.** A misheard drug name becomes a
  prescription, and no recogniser is good enough at "artemether/lumefantrine"
  to be trusted with that.
- **A dropped negation cannot be detected.** "no chest pain" heard as "chest
  pain" reads perfectly well, means the opposite, and would feed the suggestion
  engine. Nothing in the code can see it. The defence is that the transcript is
  shown back word for word and the denials it *did* hear are listed to draw the
  eye — read it before moving on.

### Known limits
- **It needs a connection.** The recogniser runs on Deepgram's servers, so
  dictation is the one part of this app that does not work offline. The button
  says so.
- **Patient audio leaves the clinic.** That is inherent to the cloud provider
  and was a deliberate choice; the on-device alternative (whisper.cpp) needs a
  31–57 MB model, which is 3–6x the whole bundled clinical library, and runs at
  1–3x realtime on a mid-range phone.
- Cost is a fraction of a US cent per consultation on Deepgram's per-minute
  rate; the Edge Function caps a clip at ~1 minute so a stuck microphone cannot
  run up a bill.
- **A key pasted into a chat is a burnt key.** Rotate it, and put the
  replacement in Supabase secrets only.

### Key files
| File | Purpose |
|------|---------|
| `app/clinic/js/clinic-dictate.js` | recording, the level meter, the parsers, filling the boxes, naming a fault |
| `app/clinic/new-order.html` | `#itSpeak` at the top of the intake screen, and its styles |
| `app/clinic/js/clinic-intake.js` | the "Check this" panel at the top of the intake screen |
| `app/clinic/settings.html` | Settings → Dictation: the live "is it working?" check |
| `supabase/functions/transcribe/index.ts` | holds the keys, calls Deepgram/Whisper, caps the clip, answers the probe |
| `supabase/functions/structure/index.ts` | splits a transcript into fields; whitelisted server-side |

## The tests

`tests/` — 46 files, ~530 checks. No framework: each file starts a web server
over `app/`, opens a real page in Chromium with the network mocked, drives it,
and prints `PASS`/`FAIL` with the evidence.

```bash
cd tests && npm install && node run-all.js     # all of them, ~25 min
node run-all.js dictate                        # just the ones matching
```

`tests/README.md` says what each file protects and how to write another. Two
rules worth repeating here:

- **Never assert on a colour by name.** Measure the contrast ratio against the
  computed background, in all four skins and both themes. Four separate
  unreadable-text bugs got past eyes and were caught by a number.
- **`measure-*.js` files are not tests** — they print a number (30/30
  dictations placed correctly, 75% of doses read). Re-run them when changing
  what they measure and put the number in the commit message.
