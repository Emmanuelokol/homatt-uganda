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

## Dictating the Vitals

**Provider:** OpenAI Whisper, called from a Supabase Edge Function
**Scope:** the four vitals boxes only — never a diagnosis, never a medicine

### Setup required
| What | Where |
|------|-------|
| `OPENAI_API_KEY` | Supabase secret (already expected by `ai-proxy`) |
| `RECORD_AUDIO` | declared in `android/app/src/main/AndroidManifest.xml` |
| Edge Function | deploy `supabase/functions/transcribe` |

Without the secret the button reports "Dictation is not configured on this
server" rather than failing silently.

### How it works
The phone records a short clip, posts it to the `transcribe` Edge Function,
and gets back plain text. The key never reaches the phone — the same
arrangement as `send-notification` and `ai-proxy`. `clinic-dictate.js` then
parses the text and fills `itSbp`, `itDbp`, `itTemp`, `itWeight`, `itPulse`,
firing the same `input` events as typing so the abnormal-reading colouring and
the suggestion engine react identically.

### The rules it follows, and why
- **A value is taken only when the clinician said what it was** — a label
  ("temp", "pulse") or an unambiguous unit ("kg", "mmHg"). A bare "38.5" fills
  nothing. Guessing which box a number belongs to is how a temperature ends up
  in the weight field.
- **Every reading is range-checked** against what a human body can do, and one
  outside it is reported rather than stored: "Ignored temp 385 — outside
  30–45 °C".
- **Never a diagnosis, never a drug.** A misheard drug name becomes a
  prescription, and no recogniser is good enough at "artemether/lumefantrine"
  to be trusted with that.

### Known limits
- **It needs a connection.** Whisper runs on OpenAI's servers, so dictation is
  the one part of this app that does not work offline. The button says so.
- **Patient audio leaves the clinic.** That is inherent to the cloud provider
  and was a deliberate choice; the on-device alternative (whisper.cpp) needs a
  31–57 MB model, which is 3–6x the whole bundled clinical library, and runs at
  1–3x realtime on a mid-range phone.
- Cost is roughly 1 US cent per consultation at Whisper's per-minute rate; the
  Edge Function caps a clip at ~1 minute so a stuck microphone cannot run up a
  bill.

### Key files
| File | Purpose |
|------|---------|
| `app/clinic/js/clinic-dictate.js` | recording, the vitals parser, filling the boxes |
| `supabase/functions/transcribe/index.ts` | holds the key, calls Whisper, caps the clip |
