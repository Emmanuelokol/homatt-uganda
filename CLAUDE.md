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

**Setting the key is not enough — the function has to exist.** The two are
separate, and only one of them is visible in the Supabase dashboard's Secrets
page. `DEEPGRAM_API_KEY` sat correctly in Secrets for days while `transcribe`
had never been deployed at all, and the app could not say so: the gateway's 404
for a missing function carries no CORS headers, so the browser refuses to show
the reply to JavaScript and `fetch()` just rejects — identical, from inside the
page, to having no signal.

Both are now checked from **Settings → Dictation → Check now**, which says which
of the two is missing. And the deploy workflow no longer has a hand-written list
of functions: it deploys every directory under `supabase/functions/`, so a new
one cannot be forgotten again.

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

### What is actually recorded
The clip is labelled with what the phone **really** produced, not with a
constant. `MediaRecorder.mimeType` decides it, because that label is what the
Edge Function forwards to Deepgram as the `Content-Type` — a WebView that
records MP4 and is announced as WebM asks the recogniser to decode a container
that is not there. Opus-in-WebM is asked for first (best fit, smallest upload
on mobile data) and the list falls back through ogg, mp4 and aac; a WebView with
no `isTypeSupported` at all still records with whatever the phone picks.

`getUserMedia` asks for mono, echo cancellation, noise suppression and gain
control as **ideal**, never as required — a hard constraint a phone cannot meet
fails the whole call with `OverconstrainedError`, and a noisier recording is
enormously better than none. If the shape of the request is rejected outright,
it asks again the plain way before giving up.

`start(1000)` rather than `start()`: if the WebView is pushed out of the
foreground mid-sentence, what was already said has been handed over instead of
being lost with the recorder. `onerror` puts the button back and says so —
without it the button stayed lit over a recorder that had already died.

### Getting the words right, which is the whole point
Accuracy is decided long before the recogniser sees anything. Five things in
the capture chain were losing words, and four of them hurt a quiet speaker
worst:

- **The browser's noise suppressor was ON.** It is built for telephone calls,
  not machine transcription, and it is a **gate**: it decides what is speech
  and what is room, and removes the rest *before* the recogniser ever sees it.
  A tired clinician half a metre from the phone at the end of a clinic is
  exactly what it throws away. `noiseSuppression: false` and
  `echoCancellation: false` now. A recogniser is trained on noisy audio; it
  copes with a fan far better than with a sentence deleted before it arrived.
  **Turning these back on "to clean the audio up" is the well-meant change that
  would break dictation** — `test-speak-first.js` asserts they stay off.
- **Automatic gain stays ON.** It lifts a quiet speaker, which is what we want.
- **The sample rate was forced to 16 kHz**, making the phone resample from its
  native 48 kHz with whatever resampler it had. Opus works at 48 kHz internally
  regardless, so it cost quality and bought nothing. No longer constrained.
- **The bitrate had no floor.** Some Android WebViews default mono Opus to a
  call bitrate, and a heavily compressed quiet consonant is one the recogniser
  has to guess at. `makeRecorder()` asks the recorder what it chose and rebuilds
  it only if that is under 64 kbps — a floor, never a ceiling, so a phone that
  already chose better is never dragged down.
- **The recording stopped at 30 seconds, silently.** That limit was set when
  the button only took a blood pressure; it now takes the name, sex, age,
  complaint, story, denials, background and readings, and a clinician saying
  all that at a natural pace runs past 30 seconds easily. Everything after the
  cut was never recorded. Now 120 s for the story, 45 s for vitals — and when
  it does fire, **it says so**, because a missing tail is otherwise invisible.

### Making a quiet voice loud enough to hear
Turning the gate off gives the recogniser the real signal. It does nothing
about the real signal being too quiet, so the microphone is routed through
`enhance()` before encoding — high-pass 85 Hz, compressor, makeup gain, and a
limiter — and it is the conditioned audio that is sent.

Measured through the real graph (`tests/measure-audio.js`):

| speaker | raw RMS | conditioned | lift |
|---|---|---|---|
| very quiet | 0.0038 | 0.0483 | 12.6× |
| quiet | 0.0115 | 0.1376 | 12.0× |
| normal | 0.0383 | 0.2354 | 6.1× |
| loud | 0.0958 | 0.2524 | 2.6× |

A 25× spread of input arrives as a 5× spread; both quiet levels are rescued
from under the 0.012 the app calls silence; nothing clips.

**The limiter is not optional.** The first attempt used a makeup gain with no
ceiling and drove *two of the four levels into clipping* — which is far worse
for a recogniser than quietness, because it shatters exactly the consonants
that tell "no" from "so". The measurement caught it; the settings were swept
against it rather than guessed.

The level meter still reads the **raw** microphone, not the conditioned signal,
so "is it hearing anything" keeps answering for the microphone rather than for
the gain, and the 0.012 silence threshold keeps its meaning.

If the WebView has no `AudioContext`, or anything in the graph throws, the raw
microphone is recorded exactly as before. A quiet dictation beats none.

### Which model does the transcribing
`DEEPGRAM_MODEL` (Supabase secret, default `nova-2-medical`). nova-2-medical is
tuned for dictated American medical notes; what this app actually hears is
Ugandan-accented conversational English in a noisy room, and which model wins on
that is a question about real audio, not one to settle by argument. Set the
secret to `nova-3` or `nova-2-general` and compare — no code change, no deploy.
The keyword parameter follows the model (`keyterm` for nova-3, `keywords` for
nova-2), so switching does not silently drop the Ugandan name boosting.

### Showing that it is listening
While the microphone is open, `#itDictateLive` shows a blinking dot, a row of
bars, the elapsed time, and — in words — whether anything is being heard. A
label alone looks identical on a working microphone and a dead one, and a
clinician who cannot tell will talk into nothing and lose the whole
consultation.

Three things had to be right before the meter told the truth:

- **`ctx.resume()`.** A new `AudioContext` starts *suspended* under the
  autoplay policy, and a suspended analyser returns silence for ever. Every bar
  sat flat on microphones that were working perfectly. This was the whole "it is
  not hearing me" complaint, and it is one line.
- **Only the speech band.** Averaging the whole spectrum across seven bars put
  most of them in frequencies a human voice never reaches, so the right-hand
  bars stayed dead however loudly anyone spoke. Bars now cover ~0–4 kHz.
- **A logarithmic scale.** Loudness is logarithmic and a phone at arm's length
  in a clinic is quiet; a linear `/140` left ordinary speech barely moving.

The **decision** ("is it hearing anything?") comes from RMS on the time-domain
data, not the bars — `_live.peak`, 0…1. Ordinary speech at arm's length measures
0.05–0.3; below 0.012 is under a quiet room. After two and a half seconds of
that the hint turns red and says so, while there is still time to do something
about it, and a recording that never rose above it is refused with the likeliest
cause named rather than sent off to be transcribed for money.

That refusal is trusted **only when the meter actually ran** (`meterRan()`). On
a WebView with no `AudioContext` the peak is zero because nothing measured it,
and refusing every recording there would be a worse fault than the one it
guards against.

### The words, before they are filed
After a consultation dictation, `#itHeardBox` shows the transcript **word for
word in an editable box**, with *Use these words* and *Say it again*. Correcting
a word clears the three prose boxes and re-runs the placement from the start, so
a fix reaches every field it belongs in rather than one of them.

This is the only defence against the fault nothing in the code can see: a
recogniser that turns "no chest pain" into "chest pain" produces a sentence that
reads perfectly well and means the opposite. A clinician reading it back can
catch that; no amount of parsing can.

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
| `unconfigured` | the Edge Function is not deployed, or is deployed with no key (503) | whoever set the project up |
| `credit` | the account is out of money (402) | whoever pays the bill |
| `auth` | the key is wrong, revoked or never set (401/403 from Deepgram) | whoever holds the key |
| `signedout` | the caller's session expired (401/403 from Supabase) | the clinician, by signing in |
| `busy` | rate limited (429) | wait a moment |
| `server` | the function itself failed (5xx) | try later |
| `unreachable` | no reply at all | the connection |
| `mic-denied` / `mic-busy` / `mic-missing` | the phone's microphone | the clinician, in phone settings |

The first row is the one that used to be invisible, and it is worth
understanding why, because the same trap is waiting for the next Edge Function.

A function that has never been deployed answers **404 from the Supabase gateway
with no CORS headers on it**. The browser therefore refuses to hand the reply to
JavaScript at all: `functions.invoke` comes back with a `FunctionsFetchError`
that has no status, no body, nothing. From inside the page that is *identical*
to having no signal — so the app said "could not reach the dictation service",
and a clinic went looking at their internet while dictation had simply never
been installed.

`faultFrom()` now asks a second question when there is nothing to read: it
fetches `${SUPABASE_URL}/auth/v1/health` with `mode: 'no-cors'`. The reply is
opaque and unreadable, but whether the *promise* resolves still answers "can
this phone reach Supabase at all?" — and that is the whole question. Server
answering + function silent = not deployed. Nothing answering = the connection.

Where a status IS readable it decides the message, and the gateway's own words
("Requested function was not found") are never shown to a nurse.

Two places show it:
- **On the phone**, the message appears under the button, and the last fault is
  kept in `localStorage` under `homatt_dictation_fault`.
- **In the admin**, Settings → *Dictation* has a **Check now** button. It posts
  `{ "probe": true }` to `transcribe`, which asks Deepgram whether the key is
  live and what is left on the account **without sending any audio**, so it
  costs nothing. Under $5 it warns while dictation still works; at zero it says
  the account is empty. It also shows what this device last ran into.

### Reading how people actually talk
Clinicians do not dictate textbook sentences. Measured over 27 real phrasings —
Ugandan English, half-finished clauses, "yeah" mid-sentence, the recogniser's
own commas (`measure-speech.js`): **name 27/27, sex 27/27, age 27/27,
complaint 27/27, 0 words lost, 0 diagnoses leaked into a field.**

What made the difference:

- **The name cue is a slot, not a phrase.** "Name of the person is Emmanuel
  Opal" — the commonest opening of all — did not match `name is`, because of
  the three words in the middle. Also handled: "Patient name Okello John" (no
  verb), "We have Mukasa Peter here", "Am seeing Achieng Mary". Cue words that
  get glued to the front of a capture ("this patient is **called** Grace") are
  peeled off rather than making the name unusable, and trailing filler
  ("Mukasa Peter **here**") is trimmed.
- **Weak cues, anchored to the symptom vocabulary.** "with", "has", "having",
  "feeling" are far too common to mark a complaint on their own — but "with a
  rash" and "has fever" are exactly how one is said aloud. They are trusted
  only when a **known symptom** follows immediately, so nothing that is not
  already a symptom can be promoted into a complaint. That alone took the
  complaint from 18/27 to 25/27.
- **An optional article must be a whole word.** `(?:a|an|the)?` inside the cue
  ate the "a" of "**a**bdominal", leaving "bdominal pain" — which is not a
  symptom, so the complaint was silently dropped. `(?:(?:a|an|the)\s+)*` fixes
  it. Worth remembering: an optional group with no boundary will eat the start
  of the next word.
- **Ages as they are said**: "he is 52", "she's 27", "the age is 45", "a young
  man of 22", "a baby of six months". A bare number is still never an age —
  it has to be a number a *person* is said to be, or it is how a temperature
  becomes an age.

### Ugandan names, which are the hardest part
An English-trained recogniser faced with "Okello" or "Nakato" returns the
nearest English word it knows — "Emmanuel **Opio**" came back as "Emmanuel
**Opal**". Nothing in the audio can fix that, so there are three defences,
in the order they apply:

1. **Boosted at the recogniser.** `BOOST_NAMES` in `transcribe` feeds Deepgram
   ~75 common Ugandan name stems (Luganda, Acholi/Lango, Iteso, Basoga,
   Runyankole) as `keywords`, at a modest weight. Boosting raises the odds of a
   word the model would otherwise rank below a common English one. Names that
   are *also* English words — Grace, Mercy, Innocent, Gift, Patience — are
   deliberately left out: they are already recognised, and boosting them would
   make every "grace period" a patient. Story mode only; a vitals reading has
   no names in it.
2. **Spelt out, when it matters.** "The name is spelt O-K-E-L-L-O" — hyphenated
   runs are joined on sight; space-separated letters are joined only after a
   spelling cue, or "I am a" would become "Iama".
3. **Matched against the clinic's own records, on the phone.** `closeNames()`
   compares the heard name to the ~400 recent patient names already in memory
   for the unpaid-visit check — no extra request, and nothing leaves the
   device. A shared word plus one near-miss word (edit distance ≤ 2) is the
   shape of a misheard surname, so "Emmanuel Opal" offers "Emmanuel Opio".
   It **offers**; it never renames. A wrong auto-correct on a name is a record
   about the wrong person, which is worse than a misspelling.

`.it-how` on the intake screen tells the clinician the rest — say the word
"name", say "male"/"female" rather than relying on he/she, give the age its
unit, label every reading, keep the denials, and never say the disease.

### The summary reads as a record, not a transcript
Once the name, sex and age are in their own boxes, repeating them in the story
is noise. `dropPersonBits()` removes a clause only when it is **nothing but**
scaffolding, and keeps it the moment it contains a symptom or a denial — so the
way it fails is by keeping too much, which is untidy and safe. The words are
not lost: the transcript is shown verbatim in the correction box and again
under "What was heard, word for word".

*Say it again* is a **re-take**: it clears the three prose boxes first. Without
that, a second attempt appended, and the story read "Name of the person is
Emmanuel Paul.. Name of the person is Emmanuel Opal."

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
- **A key pasted into a chat is a burnt key.** Rotate it — and read the next
  section first, because rotating it in the wrong place undoes itself.

### Rotating the Deepgram key, and the trap in it
**Supabase is not the only place the key lives.** Both deploy workflows carry
it from GitHub:

```
keep DEEPGRAM_API_KEY "$DEEPGRAM_API_KEY"     # deploy-edge-function.yml:59
supabase secrets set "${args[@]}" --project-ref "$SUPABASE_PROJECT_REF"
```

`keep` sets a secret only when the GitHub value is **non-empty**, and leaves
the project's own value alone when it is empty. So:

- If `DEEPGRAM_API_KEY` **is** in GitHub → Actions → Secrets, then setting a
  new key in the Supabase dashboard works until the next push, and the next
  push **silently puts the old, burnt key back**. Rotate it in **GitHub**.
- If it is **not** in GitHub Secrets, Supabase is the only home and setting it
  there is enough.

Safe either way: set the new key in **both**, in this order.

1. Deepgram dashboard → new API key. Do not delete the old one yet.
2. GitHub → Settings → Secrets and variables → Actions → `DEEPGRAM_API_KEY`.
3. `supabase secrets set DEEPGRAM_API_KEY=<new> --project-ref <ref>`, or push
   anything so the deploy action carries it across.
4. **Settings → Dictation → Check now**, and read the key tag (below).
5. Only once the tag shows the NEW key: delete the old one in Deepgram.

**How to see WHICH key is live.** "Dictation is working" reads identically for
the burnt key and its replacement, which is what makes a half-finished rotation
so easy to believe in. The probe now returns `keyTag()` — the last four
characters and nothing else — and Settings shows it beside the provider. Four
characters of a 40-character key name it without being usable; the key itself
never leaves the Edge Function.

### Key files
| File | Purpose |
|------|---------|
| `app/clinic/js/clinic-dictate.js` | recording, the level meter, the parsers, filling the boxes, naming a fault |
| `app/clinic/new-order.html` | `#itSpeak` at the top of the intake screen, and its styles |
| `app/clinic/js/clinic-intake.js` | the "Check this" panel at the top of the intake screen |
| `app/clinic/settings.html` | Settings → Dictation: the live "is it working?" check |
| `supabase/functions/transcribe/index.ts` | holds the keys, calls Deepgram/Whisper, caps the clip, answers the probe |
| `supabase/functions/structure/index.ts` | splits a transcript into fields; whitelisted server-side |

## The floating microphone

**File:** `app/clinic/js/clinic-speak.js` · **on:** dashboard, messages,
settings, new-order · **settings:** Settings → *The floating microphone*

A microphone button that follows the clinician around the app. Tap it anywhere,
say who the patient is and what they came with, check the summary, tap a
condition — and the treatment opens already filled in, at the one-tap package.

### Why it floats
The dictate button on the intake screen is the right place when you are already
there. You usually are not: you are on the dashboard or in a patient's history
when someone walks in. Four taps to reach a microphone are four taps during
which you are not listening to them.

### Why it is see-through
It sits on top of screens people are reading. At rest it is faint enough to
read a table through and solid enough to find; `--sp-rest` comes from the
clinic's own setting (25–100%), and it goes **fully solid the moment it is
recording** — that is the one instant a clinician must be able to see it is on.
It can be moved to the other side or turned off entirely: a floating thing that
cannot be got out of the way is a nuisance, not a feature.

### One microphone path, not two
It calls `HomattDictate.listen()` — the same recorder, the same format
negotiation, the same level meter, the same fault messages as the intake
screen. `useLiveElements()` points the meter at whichever screen is asking.
Two separate implementations would drift, and the second one would be the one
nobody measured.

### What it costs
The suggestion engine needs `impression_index.db` (786 KB) and the SQLite WASM
— **not** the 4 MB guidelines book, which is only needed for the one-tap
package on the treatment screen. Both are cached by the service worker
cache-first, so a clinic pays for them the first time the widget is used and
never again. Nothing is loaded on page open.

### The handoff
Everything crosses in `localStorage` under `homatt_speak_handoff`, never in the
URL — a query string carrying a patient's name and complaint ends up in
history, in a shared phone's address bar, and in any log in between. The intake
screen consumes it exactly once, ignores anything older than ten minutes, and
**fills empty boxes only**: a screen with a patient half entered is a different
patient, and their words are not ours to overwrite.

### What it is not allowed to do
Exactly what the intake screen is not allowed to do. The conditions it lists
are suggestions from the books, each with a match strength, the findings that
point to it and the page it came from; the panel says *not a diagnosis, you
decide*; none is preselected; and nothing is written anywhere until a person
taps one.

## Walking the journey, which is how these four were found

`tests/test-journey.js` · by hand: `tests/probe-journey.js`

Reading the code found none of these. Driving the real screens end to end —
type a treatment, tap a suggestion, hand off from the widget, open the package
— found all four in one pass, and they were all in the part of the journey no
single file owns.

### A lab test was ordered, and charged, with nothing on screen to show it
Confirming a suggestion pushes the tests the book names into `state.labTests`,
which is what gets **priced** and saved as `lab_tests_ordered`. It never called
`window._wizRefreshAfterAutofill()`, so the tray stayed hidden, no chip lit and
the lab fee did not move. The test was on the visit and on the bill, and the
clinician had seen nothing happen. One line, and it is the kind of line that is
invisible in review and obvious the moment you tap the button.

### Changing your mind still charged for the diagnosis you discarded
Tapping a second condition added its tests and left the first one's behind. A
clinician comparing two suggestions silently accumulated billable tests.
`_dxTests` now remembers what a *confirmed suggestion* put there — and only
that, so a test the clinician ticked themselves, or one the package brought, is
never taken away again.

### A handoff could put two patients in one record
"Fills empty boxes only" was written to protect a half-entered patient, and it
does protect the boxes that are full. What it did not do is notice that the
words belong to somebody else: with **Okello John** and **headache** already
typed, a handoff for **Nakato Sarah** wrote her story, her temperature of 39.5
and her diagnosis of malaria into the empty boxes. One record, two people, and
nothing on screen to say so.

The two are now told apart before anything is written — a name that disagrees,
or a complaint that disagrees — and where they disagree a person decides:
*clear this and use what was said*, or *keep what is on the screen*. The same
patient half entered is not a disagreement, so the ordinary case still just
fills the empty boxes.

### A child's package printed the same warning three times, mid-sentence
The "This is a child — nothing is ticked" block had been pasted into the
unpriced-medicines sentence twice more, so a child whose clinician ticked an
unpriced medicine read: *"2 ticked medicine"*, then a block saying nothing was
ticked, then *"s are not priced in your stock, so"*, then the same block again.
Three copies, a sentence cut in half mid-word, and the two halves contradicting
each other — on the one screen where a dose is being decided for a child.

### And one thing that was not a bug, but was still wrong
"Pneumonia" is five sections in the book, three split by age: an infant up to
2 months, a child of 2 months to 5 years, and children over 5 with adults. The
app asks which — correctly, because only a person can choose — but it offered
all five **unmarked**, while the age was already on the screen above. That is
how the adult page gets opened for a three-year-old.

The sections that fit the recorded age are now marked *for this age* and sorted
first; ones that cannot apply are marked *not this age group*. Nothing is
removed and nothing is chosen. The matcher is deliberately narrow — it reads a
range only from titles that are talking about a **person's** age, so
"Postpartum Examination of the Mother Up to 6 Weeks" (which counts weeks since
delivery) is left alone rather than marked wrong for an adult woman.

## Part payment, and the screen it actually belongs on

`app/clinic/js/ucg-autofill.js` (`PAY_OPTS`, `#ucgPartWrap`) ·
`app/clinic/new-order.html` (the fees card) · `tests/test-journey.js`

**There are TWO payment rows in a treatment**, and this is worth knowing before
changing either: the fees card on the wizard screen (`.pay-chips`), and the one
inside the one-tap package panel (`#ucgPay`, built from `PAY_OPTS` in
`ucg-autofill.js`). A clinician saving straight from the package never sees the
first one. Changing only the wizard's row looks like nothing happened.

"Pending" could only ever say the whole bill was unpaid, so a patient who hands
over part of it left two untrue choices: **Paid**, and the clinic loses the
debt; or **Pending**, and the clinic loses the money it is holding. Either way
the whole amount went to the owing list.

Both rows now offer **Part payment**. Tapping it opens a box for the figure and
says, as it is typed:

> Paid UGX 20,000 out of UGX 60,000 — UGX 40,000 still owing.

**The amount decides the status, not the chip.** Nothing entered is still
`pending`, part of it is `partial`, and entering the whole bill is simply
`paid` — so a slip of the finger cannot record a bill as settled, and a clinic
cannot lose a debt by mistapping. `'partial'` was already a valid
`payment_status`; the migration that added `record_payment` added it too.

## Why the installed app never changed

`app/clinic/clinic-sw.js` · `tools/make_version_json.py` ·
`tests/test-selfupdate.js` · Settings → *App version*

A clinic reported seeing none of the work: "I have not seen any updates in
clinic portal, do you want me to download the app every time I update?"

They were right, and it was not a bug in any of it. `capacitor.config.json`
has `"webDir": "app"` and **no `server.url`**, so the Android build bakes this
entire folder into the APK. Inside it `self.registration.update()` re-fetches
the worker from its OWN origin — the installed file — so it always finds
itself. The web version at GitHub Pages updated on every push; the installed
app could not change until somebody downloaded a new APK.

### Why not simply point the app at the website
Because `localStorage`, IndexedDB and the offline outbox of unsynced
consultations are **per-origin**. Setting `server.url` moves the app from
`https://localhost` to the Pages origin, and every consultation a clinic had
recorded but not yet synced becomes invisible on the first launch. An update
that silently strands a day of work is worse than no update.

### What it does instead
The worker fetches the newer build from where the web version lives and writes
it into **this** origin's cache. The origin never changes, so nothing local
moves. `version.json` (generated from clinic-sw.js, so it can never disagree
with the worker beside it) names the build and lists its files; the 4 MB books
are only sent when `dataVersion` says the book itself was rebuilt.

It is staged: nothing is swapped in until every file has arrived, so a
connection that dies half-way leaves the working app exactly as it was. The
worst case is the one we already had — no update.

### The four things that quietly undid it
Every one of these was found by driving it, and each on its own was enough to
put the old version straight back:

- **`CACHE` cannot answer "what am I running?"** It is a constant inside the
  worker, and the worker is part of the APK, so it reads v168 for ever no
  matter what has been fetched over the top. The applied build is kept in
  IndexedDB instead.
- **The background revalidate.** Navigations refresh from the network — and
  for an installed app "the network" is the old file inside the APK. It has to
  be checked again when the fetch *completes*, not when it starts, because an
  update can finish while the request is still in flight.
- **The shell repair.** `ensureShellCached(cache, force)` re-fetches every
  shell file to repair a damaged cache. Forced, it skips the cache check
  entirely — and the page asks for it on load, so the update was being walked
  back file by file on the very next page open.
- **A worker woken for one request.** It has not run `activate`, so it does
  not yet know the local origin is behind. Every path that can overwrite now
  waits on the same promise before deciding.

**The rule underneath all four: once an install has taken a newer build, its
own origin is the stale one.** Anything that "refreshes from the network" has
to know that, or it will helpfully restore the old app.

### The header nobody had checked, and the test that hid it
The mechanism rests on one thing that cannot be verified from a development
machine: whether the host sends **`Access-Control-Allow-Origin`**. A worker on
`https://localhost` reading another origin is a cross-origin fetch, and without
that header the browser refuses to hand over the response — which arrives here
as an ordinary network failure, **indistinguishable from having no signal**.

`test-selfupdate.js` served its stand-in web host **with CORS switched on**, so
it passed while proving nothing about the real one. Run the same test with the
header off and both assertions fail:

```
FAIL  it finds the newer build and takes it   — reason: "no connection"
FAIL  the app now serves the NEW build        — (old)
```

A test that only passes against a permissive mock proves less than it looks
like it proves. The first stand-in is now served **deliberately unreadable**,
and the update has to arrive anyway — from `UPDATE_SOURCES[1]`,
`raw.githubusercontent.com`, which exists to be read by programs and says so in
its headers. Each source is tried in turn for `version.json`, and every file of
the build then comes from whichever one answered.

### What this still costs, once
The mechanism is in the worker, and the worker ships inside the APK — so it
takes **one more APK install** to get it. After that one, the portal updates
itself, and Settings → *App version* says which build it is running and lets
somebody check on demand.

## Every word, in every colour

`tests/measure-contrast.js` (the survey) · `tests/test-readable.js` (the guard)
· `tools/tokenise_colours.py` (the sweep)

Four skins × two themes is **eight** combinations. A colour written as a
literal instead of a token is readable in the one the author was looking at and
invisible in the other seven, and no amount of looking finds that. A number
does:

| | unreadable text |
|---|---|
| the treatment screen, before | **49** |
| all six screens, after | **0** of 4,632 measured |

Worst offenders: *"Total charged"* at **1.06:1**, *"Clinic stock"* at
**1.01:1**, *"Drug 1"* and the dictate icon at **1.46:1**.

### The sweep, and why it is safe
`tools/tokenise_colours.py` made **388** replacements. It is safe by
construction: every literal it replaces is EXACTLY the light-mode value of the
token replacing it (`--text` is #1A1A1A, `--text-lt` is #5F6368, `--border` is
#E0E0E0, `--surface` is #FFFFFF), so light mode renders identically and only
dark mode changes. It skips rules already scoped to `[data-theme="dark"]`,
skips `--token:` definitions, skips the service worker's self-contained offline
page (which never loads clinic.css, so a token there would resolve to nothing),
and writes fallbacks — `var(--text-lt, #5F6368)` — so a missing token can never
blank a colour.

### The screen the sweep could not see, which was the one being complained about
"0 unreadable" was true of the **pages** and said nothing about the screen a
clinician actually photographed. The one-tap package panel's stylesheet is
**injected by `ucg-autofill.js` at runtime**, and the panel only exists while
it is open — so a page sweep walks straight past it. Measured properly
(`tests/measure-panel-contrast.js`, six skin/theme combinations, 1,542
elements): **36 unreadable, three of them at 1:1** — literally invisible:

| what | ratio | which is |
|---|---|---|
| `.ucg-chip` "Malaria RDT" | **1:1** | the empty dark pills in the photograph |
| `.ucg-paychip.on` "⏳ Pending" | **1:1** | the chip showing only its emoji |

`--brand-tint` is a background and `--brand-ink` is the text that goes on it —
defined as a pair, per skin. Both chips used **`--primary-d`**, a darker *fill*
variant, which in the "dark" skin is the same value as `--brand-tint`. Dark
grey on dark grey.

**And a specificity bug hiding behind it.** `.ucg-drug .nm span` is (0,2,1) and
beats `.ucg-rank.r-first` (0,2,0), so a generic grey won over *every* rank and
stock colour — FIRST LINE, ALTERNATIVE and "not in your stock" all came out the
same faint grey whatever they were meant to be, and no amount of correcting the
colours would have shown until the selector was fixed. Now `span.ucg-rank.…`,
which ties the specificity and wins on order.

`test-readable.js` opens the panel and measures inside it, so this screen can
never drift back out of view again.

### Four faults a sweep cannot see, found by measuring
- **`--primary` used as a WORD.** In the "dark" skin `--primary` is `#2C3035`,
  a near-black chrome fill, and 53 places used it as a text colour — 1.46:1 on
  that skin's own near-black surface. **`--primary-ink`** now carries "the brand
  colour as text" and follows `--deep-ink` in dark mode, which every skin
  already defines.
- **White on a `--primary` fill.** `--on-primary` exists for exactly this and
  flips to black in dark mode; 32 places hardcoded `#fff` and sat at 3.3:1.
- **`--deep` is not `--primary`.** It stays dark in midnight, dark and clay,
  but the forest dark theme redefines it to a *light* green — so neither white
  nor black clears the bar on all four. **`--on-deep`** is defined beside it,
  per skin.
- **`--info` and `--danger` as words.** Fill colours again: `#1565C0` is 2.97:1
  and `#D32F2F` 3.81:1 on a dark card. `--info-ink` joins the `--danger-ink` /
  `--warning-ink` that were already there.

**The rule worth keeping: a fill colour and the text that sits on it must be
defined as a PAIR, in the same place, for every skin.** Every failure above is
the same mistake — a fill token borrowed for words, or a word colour written
next to a fill that changes underneath it.

## Staying signed in

`app/clinic/js/clinic.js` · `tests/test-signin-sticks.js`

Clinics were being put back on the sign-in page in the middle of a working day,
on phones that had never signed out.

**What I could and could not prove.** I have NOT reproduced the exact symptom
from here — `test-signin-sticks.js` drives the real Supabase library with only
the network mocked, and the old code passes every case in it. So what follows
is a set of faults that are real in the code and would each produce that
symptom, not a demonstrated cure. If it happens again, the app now says why
(below), and that answer is worth more than another guess.

### getSession() gives the same answer to two different questions
`supabase.auth.getSession()` returns `{ session: null }` **without throwing**
both when there is no sign-in at all and when there is a perfectly good refresh
token it could not reach the server to exchange. The guard read that null as
"this localStorage was faked", deleted the session and redirected — so the
`catch()` branch commented "Network error — allow offline access" could never
run, because nothing had been thrown.

"You are not signed in" and "I could not check right now" must not have the
same consequence: one is a security measure, the other is a clinician losing
the patient in front of them. The guard now asks, in order — is there a session
(yes: only a *different user* is grounds to leave); is there a stored sign-in at
all (no: genuinely out); is the phone offline (yes: stay, the whole app is
built to work without a connection); and only then asks the server, where only
an explicit refusal counts.

### A refresh token is used ONCE, and this app opens several pages
Each page makes its own Supabase client. Two renewing in the same moment means
the slower one is told **"Invalid Refresh Token: Already Used"** for a token
that was good a second earlier. That is indistinguishable, at the call site,
from a real expiry. So a refusal is now re-checked once after a short pause: if
another page has since written a fresh session to the same storage, it was a
race and nobody is disturbed.

### A timer does not run in a suspended WebView
The library renews on a timer. Android suspends the WebView, so a phone that
spent the morning in a pocket wakes holding an expired token and the first
thing the clinician taps is what discovers it. `_keepSignedIn()` renews when
the app returns to the front, when focus comes back, and when the connection
returns — five minutes before expiry rather than after, and never as grounds
for signing anybody out.

### And when it does happen, the app says why
"It logs me out sometimes" is not something anybody can chase. Every exit now
goes through `_signOutBecause()`, which records the reason, the time and
whether the phone had a connection; the sign-in page reads it back — *"You were
asked to sign in again 3 minutes ago because the server refused the saved
sign-in. The phone had no connection at the time."* The next report will name
the cause instead of describing the symptom.

## How a suggestion is worked out

`app/clinic/js/clinic-impression.js` · benchmark: `tests/measure-impression.js`
· rules and the negation scoper: `tests/test-guards.js` · before/after by hand:
`tests/probe-guards.js`

**Everything the clinician recorded feeds it** — the complaint, the readings,
the story and the background — and the readings are turned into the words the
books actually use (`temp 40.2` → `hyperpyrexia`, `fever`; `pulse 130` →
`tachycardia`). Scoring is BM25 over 729 documents, so a rare word counts for
far more than a common one, and no field is privileged once its words are in.

### The term budget, which is where the order matters
Only **22 search terms** are used. More is both slower and noisier: every extra
common word dilutes the ones that discriminate. So which 22 is a real decision.

The complaint and the vitals go in whole — together rarely more than eight
words, and the two things the clinician is surest of. What is left used to go
to the story until it ran out, and only then to the background. Measured on
four realistic dictations (`tests/measure-terms.js`), that meant:

| dictation | background terms reaching the engine |
|---|---|
| short | 1/1 |
| ordinary | 2/2 |
| **wordy** | **0/11** ← "known peptic ulcer disease" never arrived |
| **very wordy** | **3/10** |

A wordy story ate the whole budget. The remainder is now **shared**: the
background is offered a third of what is left, and whatever either does not use
goes to the other. Same four dictations: 1/1, 2/2, **7/11**, **7/10** — and the
wordy abdominal-pain case now returns **Peptic Ulcer Disease** first instead of
"Worms".

The WHO differential benchmark is unchanged by the sharing at **239/241 in the
top 3 (99.2%)**, which is the point of having it: it proves the change did not
cost anything elsewhere.

### A denial used to count as evidence FOR the thing denied
This was the worst fault in the engine and nothing in the interface could show
it. `toks()` drops "no" (the regex is `[a-z]{3,}`) and "not"/"without" (STOP),
so **"no rigidity, no guarding, no rebound" reached the scorer as the terms
`rigidity`, `guard`, `rebound`** — three rare, high-IDF words. Measured:

| what the clinician wrote | Peritonitis |
|---|---|
| "no rigidity, no guarding, no rebound tenderness" | **79%, first** |
| "rigidity, guarding and rebound tenderness" | 57%, fifth |

Writing down a careful **negative** examination made the emergency look *more*
likely than writing down a positive one. Every denial in the record did this,
not only these three.

`denials()` is a small NegEx over the query: find a cue (no, not, denies,
denied, without, never, nil, none, nothing, negative for, free of), read
forward a bounded window, stop at the first thing that closes it. What closes
it is where the accuracy lives:

- **Punctuation, and the next cue.** "No rigidity, no guarding" is two denials,
  not one running one.
- **A new clause** — but/however/except, and any verb that starts one
  (has, is, complains, says, noted, present). "No vomiting **but has**
  diarrhoea" keeps the diarrhoea.
- **…except an auxiliary sitting directly on the cue**, because "never **had**
  convulsions" is one denial and "no vomiting **and has** diarrhoea" is not.
- **A determiner after a conjunction**: "no fever **and the** mother says…"
  ends the list of denied things. Without this the window ate "mother".
- **A word said plainly somewhere else is not denied.** "Pain in the lower
  abdomen, no pain on passing urine" must not lose the word "pain". So the
  tokens dropped are the denied ones *minus everything affirmed anywhere*.

It fails by **under-negating** — a comma ends the scope, so "no fever, cough or
vomiting" only drops the fever. That is the safe direction: leaving a word in
is the noise we already had, while over-negating deletes findings that were
never denied.

It runs on the **query only**. The books are indexed exactly as they were
written, because "in the absence of peritonitis there is no rigidity/rebound
tenderness" is Acute Pancreatitis describing *itself*, and rewriting the book
to suit a phone would be a far larger and worse change.

`_denials()` is exported so `test-guards.js` can test it directly, including
hostile input: a cue with nothing after it ("abdominal pain, no") used to be
able to reset the scan to zero and **loop for ever**, which on a phone is a
frozen screen. It is now word-indexed and the index only moves forward.

### The rigidity guard
When rigidity or guarding is recorded **absent**, peritonitis and appendicitis
are put below 10% and out of the three the clinician reads. The screen names
them, quotes the words that did it, and says a soft belly does not rule a
surgical abdomen out.

**Which conditions.** An explicit list of `title_normalized` values, never a
text match — searching the documents for "peritonitis" or "rebound" catches
Typhoid Fever, Ectopic Pregnancy, PID, Acute Pancreatitis and Peptic Ulcer
Disease, because each describes peritonitis as a complication of *itself*. A
text-matching rule would suppress the ruptured ectopic in the same breath as
the peritonitis.

The list started at six and was cut to **three** — peritonitis, appendicitis,
acute appendicitis. What came off matters more than what stayed, and each has
a test:

| taken off | because |
|---|---|
| ectopic pregnancy | an **unruptured** one has a soft abdomen, and that is the only window in which she can still be saved cheaply |
| intestinal obstruction | distended, tympanitic and soft until it strangulates; the book names no peritoneal sign |
| intussusception | in a screaming infant guarding cannot be assessed at all, so "no guarding" is usually an artefact |
| acute pancreatitis | the book says, in as many words, "in the absence of peritonitis there is no rigidity/rebound tenderness" |
| spontaneous bacterial peritonitis | carries the word, is not a surgical abdomen, has a soft belly by rule |

**When the guard must NOT fire.** A soft belly is not a safe belly, and this is
the part that keeps the rule from killing someone. Peritonitis is present
without rigidity in advanced HIV, in the elderly, in the malnourished, on
steroids — and, the lethal one, in **late decompensated disease, where the
abdomen goes from rigid to flaccid as the patient deteriorates**. At the point
of maximum danger the guarding is gone. Late presentation is the Ugandan norm.

Nor can any parser tell "examined, and it was soft" from "not examined" from
"could not assess". The string is identical.

So the demotion is suspended, with a red note saying why, on any of:
under five · systolic < 100 · **shock index** (pulse ÷ systolic ≥ 0.9, which
catches the compensating 22-year-old at 110/115 that neither "pulse over 120"
nor "systolic under 90" can see) · pulse ≥ 120 · pulse pressure ≤ 25 ·
temperature < 36 (hypothermia in a belly is late sepsis, and must read as
*more* dangerous than fever) · or the record itself saying board-like abdomen,
rebound, distension, bilious vomiting, HIV, a previous laparotomy, a missed
period, collapse — or **"not passing stool or flatus"**, **"absent bowel
sounds"**, which are checked against the text **as written** rather than the
denial-stripped text, because those danger signs are *phrased* as negatives and
stripping them would delete the finding along with the reassurance.

### Reproductive priority
A woman with lower-quadrant pain plus vaginal discharge or pain on passing
urine is grouped toward the gynaecological and urinary causes, and the bowel
parasites are left out unless the bowel is part of the story.

**Ectopic pregnancy is deliberately in the RAISED list.** It shares the trigger
exactly — sexually active woman, lower abdominal pain, spotting, urinary
frequency — and treating a discharge as evidence *for* PID and therefore
*against* ectopic is the classic fatal error. The screen asks, every time the
rule fires: has she missed a period, is the pain worse on the right, is the
temperature over 38 — ectopic, appendicitis, malaria.

**Schistosomiasis is in the raised list, not the parasite list**, and this is
the single most important entry on either. Its own UCG text (p.161) reads *"In
females: low abdominal pain and abnormal vaginal discharge"* and *"Frequent and
painful micturition"* — this rule's trigger, word for word, produced by a worm,
endemic around Victoria, Albert and the Nile. Filed as a parasite it would have
been hidden by the very presentation that should raise it, PID antibiotics
would do nothing, and untreated female genital schistosomiasis raises HIV risk.

**Getting the parasites back** takes more than diarrhoea. Amoebiasis has five
presentations in the book and only one is dysentery: a liver abscess is right
sub-costal pain, fever, chills and weight loss with **no diarrhoea at all**,
and an amoeboma is a mass with constipation. So the suppression is lifted by
diarrhoea or dysentery *or* by tenesmus, worms seen, right sub-costal or liver
pain, weight loss, night sweats, a mass, or constipation. Suppression keyed on
the absence of a symptom must never be applied to a condition whose worst form
does not have that symptom.

Pinworm is **not** on the parasite list either — in a girl it causes
vulvovaginitis and dysuria, so it is a real answer to this presentation.

**What must not trigger it**, each with a test: a man; upper or epigastric
pain; an ear, eye, nose or wound discharge; "discharged from hospital"; a
*denied* discharge; and — the trap — a child with **chest in-drawing**, because
`SAY_AS` rewrites that to "lower chest **wall** indrawing" and a rule that
tested for "lower" plus "pain" would fire on a paediatric pneumonia. The site
word is always required to be an abdominal one.

`SAY_AS` also rewrites "passing urine" → "urination" **before** "pain(ful)
urin\*" → "dysuria", so "pain when passing urine" arrives as "pain when
urination" and never becomes dysuria on its own. The dysuria predicate has to
catch that itself, and it is the commonest way a patient says it.

### When there is almost nothing to go on
The percentage is worked out against the rest of the list, not against the
disease, so **the top suggestion always carries a big-looking number**. That
was survivable while a denial padded the query out; now that denials are
removed, a careful negative examination can leave two words standing —
"abdominal pain" — and two generic words return a confident-looking list of
nonsense. Under four search terms the screen now says so and prints the words
it actually used.

Two words were also added to `STOP` on the same measurement: **`present`**
("bowel sounds present" is not a finding to search on) and the **number words
one…ten** (the engine has no sense of time, so "for two days" is pure noise).
Both are neutral on the WHO benchmark at 239/241 and both improve the thin
queries the negation scoper now produces.

### What it does NOT do
It has no sense of **time**. "Fever for two days" and "fever for two months"
score the same, though they are different diseases. Duration is in the story
the clinician reads, but it is not weighed. The same goes for the order events
happened in — "vomiting then headache" and "headache then vomiting" are the
same bag of words to it. Worth knowing before trusting the ordering of the
list, and worth doing one day.

## The clinician portal

`app/clinic/clinician/` · `supabase/migrations/20260911_clinician_portal.sql` ·
`tests/test-clinician.js`, `tests/test-clinic-clinicians.js`,
`tests/test-clinician-gating.js` · SQL: `tests/run-sql.sh`

A clinician is a person, not a seat at one clinic. They sign up once, hold
their own profile and their own work record, and attach **temporarily** to a
clinic by scanning its QR code.

### The one rule the whole design exists to keep
**Patient identity never travels with the clinician.** `clinician_activity` —
the table that follows somebody from clinic to clinic — has no patient name, no
phone, no patient id, and *no column that could hold one*. It records that
Malaria was treated, at which clinic, on which day. That is a professional
record. A list of the people somebody treated is a medical record, and it
belongs to the clinic that made it.

This is structural, not a policy: there is nothing to leak, and the change to
stop in review is the one that adds a column. The owner *can* see who a
clinician treated — through `clinic_clinician_detail()`, reading the clinic's
own `clinic_diagnoses`, inside their own clinic only.

### Where the clinical work happens — not here
Once attached, the clinician is sent into the **ordinary clinic portal**: the
same intake screen, the same suggestion engine, the same treatment wizard, the
same offline outbox, carrying `staffRole: 'visiting_clinician'`. A second copy
of the treatment screen would be a second thing to keep correct, and the second
one is always the one nobody measured. The clinician portal is three screens —
sign up, your own record, and joining a clinic.

### Why it lives inside `/clinic/`
`clinic-sw.js` registers with scope `'./'`, so it can only intercept, serve,
cache and self-update files under `/clinic/`. At `/clinician/` these pages
would have loaded from whatever shipped in the APK and could **never change** —
the exact fault the self-update mechanism exists to fix. They are in `SHELL`.

### The handshake
| | the CODE | the ACCESS it grants |
|---|---|---|
| how long | 24 hours | whatever the owner chose (1 day – 1 year) |
| why | a photograph of the screen is worthless next week | a month's work should not need a new code every morning |

Eight characters, no `0 O 1 I L` because it gets read off a screen and typed by
somebody whose camera would not focus. Single-use by default. A wrong code and
a spent code return the **identical sentence**, so guessing tells an attacker
nothing about which clinics exist.

Scanning uses `BarcodeDetector`, which is already in the Android WebView — no
library, no download. Where it is missing the typed code is the route, which is
why typing has its own heading and its own card rather than being a fallback
bolted on the end.

### What a visiting clinician cannot reach
Cut: the money, the payments ledger, quick sale, restock and adding stock, the
monthly reports, settings. Kept: treatments, patient history, bookings,
medicines — and the stock **list**, read-only (`stockview`). Whether the
amoxicillin is on the shelf is a clinical question; what it cost is not.

**The money leaves the record, not only the screen.** The fees card is hidden,
so every fee would be whatever the form defaulted to — and a default is not a
price anybody agreed to. Left alone it goes on the clinic's books as a real
charge against a real patient, set by somebody who never saw the number. The
wizard zeroes every money field when `!clinicCan('payments')`. Hiding the card
alone would have been the bug.

`clinicRole()`'s fail-safe hands out FULL access when the role is missing, which
is right for a clinic's own staff and exactly wrong for a guest — so it is
inverted when the session says `clinician: true`.

### Sub-account creation is gone, from both portals
It made an account that belonged to the clinic: the clinic chose the email, set
the password, and who treated whom was a name typed into a box. Somebody who
worked at three clinics had three logins and no history of their own, and a
clinic that let one go still held their password. Joining is the QR code now.
The list of existing logins stays, and `create_staff_account` is left in the
database, so nothing already working breaks — but nothing calls it.

### The SQL is tested against a real Postgres
`./tests/run-sql.sh` starts one, applies the migrations, applies this one twice
to check the idempotency every migration here claims, and drives it: sign up
with no clinic, be refused a code as a clinician, mint one as the owner, scan
it, treat two people, read the log back, end the job, carry the rating to the
next clinic. **51 checks.** The browser tests mock the network and never reach
a database, so nothing they do could check an RLS policy, a security-definer
RPC or a trigger — and this feature's whole security model is those three
things.

The walls are checked by reading the tables **directly**, not through the RPCs:
those are `security definer` and so never see RLS at all.

### Logging is a trigger, not a client call
`trg_log_clinician_activity` on `clinic_diagnoses`. A log the phone is asked to
write is missing exactly when it matters — the consultation replayed from the
offline outbox, the one the app crashed after, the screen somebody adds next
year and forgets to wire up. The row goes in beside the treatment or not at
all, and a failure to log can never cost a clinic the consultation it was
logging.

### The QR encoder, and why it is written out
`app/clinic/clinician/js/qr.js` · `tests/measure-qr.js`

The code is shown to somebody standing in the room, which is the moment nothing
is set up and the connection is worst. A CDN library works perfectly on the
laptop it was written on and shows an empty box in Gulu. Byte mode, versions
1–10, all four correction levels, ~9 KB.

Verified against python-qrcode: **51 payloads × 8 masks = 408 symbols, every
module compared, 408/408 identical**, and the mask-penalty scorer agrees on 96
of 96 scores. A wrong encoder does not look wrong — it draws a tidy square that
will not scan — and the measurement found three bugs that reading never would:

- the 15 format bits laid down least-significant first (13 modules of 441);
- format bit 7 written at `(size-8, 8)` and then overwritten by the always-dark
  module, so one bit of the format simply did not exist (1 module);
- alignment patterns skipped wherever the centre was already occupied, which is
  right up to version 6 and from version 7 drops the six patterns crossing the
  timing line, shifting every data module after them (hundreds).

The third only appeared because the comparison covered all ten versions rather
than the one this feature actually uses.

## Speaking is optional

`homatt_voice_off` · Settings → *Dictation* · `tests/test-voice-optional.js`

One switch turns off **all three** microphones: the big one at the top of
intake, the one beside the vitals, and the floating one. A switch that
quietened one and left two would be worse than none — somebody who asked not to
have voice recognition would still be looking at microphones and would
reasonably conclude the setting does nothing.

Per device, not per clinic: the phone with the broken microphone, the one in
the noisy room, and the clinician who would rather type are one phone's
business. Default is on. Hidden rather than greyed out — a disabled microphone
still asks to be pressed and still takes up the top of the screen.

The test's most important assertion is not that the buttons go: it is that
every box they used to fill can still be typed into by hand, and that hiding
the readings button did not take the readings with it.

## Looking a word up in the book

`app/clinic/js/guidelines.js` · `tests/measure-search.js` ·
`tests/test-guidelines-search.js`

A clinician typed **Family** into the guideline search and was told "Nothing
in this book matches". Chapter 15 of the Uganda Clinical Guidelines **is**
"FAMILY PLANNING (FP)". The book was not missing it; the search could not see
it.

### Every index in every book is FTS5, and the engine has no FTS5
`conditions_fts`, `drugs_fts`, `differentials_fts`, `emhslu_fts` are all
`CREATE VIRTUAL TABLE … USING fts5`. The SQLite compiled into
`js/vendor/sql-wasm.wasm` has FTS3 and FTS4 and **not FTS5** — `grep fts5` on
the file returns nothing. So `MATCH` threw `no such module: fts5` on every
search ever run in this app, a `catch` swallowed it, and what actually ran was
the fallback: `title LIKE '%term%'`.

A section could therefore only be found if the typed word was in its **own
heading**. Nothing in the body of the book was reachable, and neither was the
chapter a section sits in — which is the whole reason "family planning",
"immunisation" and "nutrition" read as missing. **This is the trap to
remember: a `try/catch` around a query turns a missing engine feature into a
silently worse product, and the app cannot tell you.**

The fix is not a bigger binary. 551 rows are already in memory; scoring them
in one pass needs no module, takes a few milliseconds, and can weigh a heading
against a chapter against a passing mention, which `rank` cannot. One search
path now, for every book, and it is the one the tests measure.

| | words a clinician types, of 45 |
|---|---|
| title-only fallback (what shipped) | **27** |
| scanning the book (now) | **45** |
| things that worked and stopped working | **0** |

Recovered: family · family planning · immunisation · oncology · radiology ·
bed nets · mosquito · rehydration · referral · weight band · chest indrawing ·
coartem · artemether · ceftriaxone · metformin · 19.2 · 15.2

**It is fast enough to type into.** Timed in the real WASM against the real
book: 1.8 ms for a single letter, 8.2 ms for "family", 8.7 ms for "chest
indrawing". A clinic phone several times slower than the machine that measured
it still lands inside the 120 ms the box already waits before searching. Two
things keep it there, and both matter: the WHERE filters before the score is
computed, so 551 rows are scanned once and a dozen are scored; and nothing is
`lower()`ed, because SQLite's LIKE is already case-insensitive for ASCII and
lowering a 21,000-character `full_text` per row per token is the one change
that would make this slow enough to feel.

Four things the measurement made visible that reading never would:

- **A section NUMBER must not be tokenised.** "19.2" became the tokens "19"
  and "2", and "19" matched the heading "COVID-**19** Disease" at full heading
  weight, which outranked Malnutrition. A number now goes straight to the
  section that has it.
- **The start of a word beats the middle of one.** "ORS" put "Refractive
  Err**ors**" first. Every short name a clinician types has this problem.
- **A chapter is an answer.** "Family planning" is a chapter, not a condition,
  so the chapter is offered and opens the contents page there.
- **A brand name is not in the book.** Coartem, Panadol, Septrin, Flagyl,
  jiggers, piles — `SAY_ALSO` is consulted **only when the book's own words
  return nothing**, and the screen says which word it substituted. It changes
  what can be found and nothing else; no card ever shows an alias as the
  book's wording.

### Two ways a card could open with nothing on it
Reported together as "no context", and they are different faults:

- **53 sections are headings with no text of their own** — 19.2 Malnutrition,
  19.1 Nutrition Guidelines in Special Populations, 15.2 Overview of Key
  Contraceptive Methods. The book prints the heading and then its
  sub-sections, and all the text is in those. The card said the content "is in
  the sections listed under it" and then listed nothing, anywhere. It now
  lists them, in the book's own numbering, tappable.
- **12 more parsed only their SECONDARY fields** and rendered as a title with
  two or three grey folded panels and not one readable word. "Clinical
  Features of HIV" was one of them, and the parse had captured **8 of its 203
  distinct words**. Measured for all twelve: `full_text` holds everything the
  parsed fields hold and **2–195 words more**, so where the substance was not
  found the book's own text is now shown in full.

The rule underneath the second one: **ask whether the extraction found the
substance, not whether it found anything.** `hasPrimary` is clinical features,
investigations, management, treatment steps or medicines — a differential and
a note are not a section.

## Which condition a dose belongs to

`app/clinic/js/ucg-sections.js` · `tests/measure-doses.js` ·
`tests/test-doses.js`

The one-tap package reads `medicines WHERE condition_id = ?` and offers every
row as that condition's drug — dose, tick box, price, onto the visit and onto
the bill. So "is this drug printed under this heading?" is the question.

| over all 1,008 medicine rows | |
|---|---|
| source line verbatim in its own section | 1008 of 1008 |
| dose readable in that line | 980 of 980 |
| route readable in that line | all |
| **printed under a different heading** | **28** |

**The first three rows are why this was invisible.** Every row is a real line
of the real book, and every row is inside the `full_text` of the condition it
is filed under — because that condition's text ran past its own end and
swallowed the sections after it. Three rows of 551 do it:

| the row | swallowed | rows |
|---|---|---|
| **9.2.4.1 Postnatal Psychosis** (21,058 chars where its neighbours are two or three thousand) | Anxiety, Depression, Postnatal Depression, Suicidal Behaviour, Bipolar Disorder, Psychosis | 26 |
| **9.1.1.1 Postnatal Psychosis** — a *second* row with the same title | Alcohol Use Disorders | 1 |
| **6.5.4.3 Hepatic Encephalopathy** | Oesophageal Varices | 1 |

On screen that meant a woman who had just given birth, and is breastfeeding,
was offered a package built from **lithium, carbamazepine, clozapine,
alprazolam, fluoxetine and bupropion** — four sections' drugs, none of them
hers, each with a dose and a tick.

**How a boundary is found, and the two things that were nearly wrong.** A
numbered heading part-way down the text that is a section of the book — either
one with a row of its own, or one of the seven the import buried with no row
(Oesophageal Varices, Alcohol Use Disorders, Adenoid Disease…), decided by the
same test the contents page uses, so the two can never disagree about what a
section is.

- **The title must match the words on the page.** "Benzathine penicillin
  **2.4** MU IM single dose" wrapping onto a new line is indistinguishable
  from a heading numbered 2.4, and without the title check it condemned the
  whole genital ulcer disease page and took congenital syphilis with it.
- **…but the number alone is not enough either**, and that hid two of these.
  The extraction mis-numbered part of the book: the row numbered `6.5.4.2` is
  titled "Spontaneous Bacterial Peritonitis" while the heading printed at
  6.5.4.2 reads "Oesophageal Varices". Looking the number up, finding a title
  that did not match, and stopping there missed a boundary that was plainly in
  the text. A mismatch has to fall through to the second question, not to
  `null`.

It fails by finding too **few** boundaries, which is the state we were already
in.

Nothing is deleted. The package takes them out of what it offers and names
them, with the section they belong to, at the top of the guideline notes — a
drug that silently disappears is its own kind of wrong. The guideline screen
is reference rather than prescribing, so it keeps every row and labels the
ones the book prints elsewhere.

### The change the measurement told me not to make
The package lays out guideline text with its own rule; the guideline screen
uses the `ranToMargin` rule that was measured at 0 words lost. Making the two
the same is the obvious change, and `tests/measure-panel-text.js` says it is
the wrong one:

| | the panel's rule | the screen's rule |
|---|---|---|
| sentences cut in half | **0** | 1,723 |
| sentences welded together | **110** | 180 |
| letters lost | 0 | 0 |

The screen is fed raw wrapped pages, where line length is evidence of a
wrap. The panel is fed the already-split fields — short bullets and list
items — where it is evidence of nothing. **Same job, different input, and the
input decides.** Recorded because the next reader will propose it again.

## The tests

`tests/` — 63 files, ~870 checks (plus 13 `measure-*.js`, which print numbers
rather than pass or fail). No framework: each file starts a web server
over `app/`, opens a real page in Chromium with the network mocked, drives it,
and prints `PASS`/`FAIL` with the evidence.

```bash
cd tests && npm install && node run-all.js     # all of them, ~25 min
node run-all.js dictate                        # just the ones matching
./tests/run-sql.sh                             # the SQL half, real Postgres
node tests/measure-qr.js                       # the QR encoder vs a reference
```

**Give every test its own port.** They are separate processes run in sequence,
so a duplicate looks harmless — and then one of them starts finding an empty
page and failing only inside the suite, never on its own.
`grep -ho "PORT = [0-9]*" test-*.js | sort | uniq -d` answers it.

`tests/README.md` says what each file protects and how to write another. Two
rules worth repeating here:

- **Never assert on a colour by name.** Measure the contrast ratio against the
  computed background, in all four skins and both themes. Four separate
  unreadable-text bugs got past eyes and were caught by a number.
- **Composite the background, do not take it at face value.** Dark-mode inputs
  are a 6% white wash over a dark card; reading `rgba(255,255,255,.06)` as
  opaque white reported a perfectly readable box as 1.16:1 — and would just as
  easily hide a real failure behind a passing number.
- **A rule that hides a clinical suggestion needs a test for what it must NOT
  hide, not only for what it hides.** Every condition taken off the rigidity
  guard's demotion list has its own assertion in `test-guards.js`, because the
  next person to read that list will see three entries and reasonably wonder
  why obstruction and ectopic are missing. The test answers them.
- **Walk the journey, do not only read it.** Four faults in the treatment
  process — an invisible charge, a bill that kept a discarded diagnosis's
  tests, a record describing two patients, and a warning printed three times
  mid-sentence — were all invisible in the code and obvious within one pass of
  `probe-journey.js` driving the real screens.
- **`measure-*.js` files are not tests** — they print a number (30/30
  dictations placed correctly, 75% of doses read). Re-run them when changing
  what they measure and put the number in the commit message.
- **A metric that the current code satisfies by construction proves nothing.**
  `measure-panel-text.js` counts "sentences cut in half" as exactly the pairs
  the shipped rule joins, so the shipped rule scores 0 whatever it does. The
  file says so in its own header. A comparison is only worth reading when the
  thing being measured could have come out badly.
- **Be willing to publish the measurement that says no.** The panel's layout
  rule was going to be replaced with the guideline screen's, because two rules
  for one job drift. The numbers said the screen's rule would cut 1,723
  sentences in half here. The change was dropped and the number kept, so
  nobody spends the afternoon rediscovering it.
- **A `try/catch` around a query can hide a missing engine, not a missing
  row.** Every FTS index in every book is FTS5 and the shipped WASM has none,
  so `MATCH` threw on every search for the life of the app and the catch
  quietly downgraded it to `title LIKE`. It passed every test, because the
  tests searched for words that were in titles.
- **Check the test is looking at the page it thinks it is.** Three clinician
  screens all reported a confident pass at 36 elements each — the same 36,
  because the session sent every one of them to the sign-up page. A count that
  is suspiciously equal across different screens is the tell.
- **Some of this cannot be tested from the browser at all.** RLS policies,
  security-definer RPCs and triggers are never reached by a test that mocks the
  network. `tests/run-sql.sh` applies the real migrations to a real Postgres and
  drives them; it is also the only thing that checks the "idempotent" every
  migration in this repo claims, by applying it twice.
