# Inbound intake setup (direct webhooks — no middleware)

How inbound patient communications reach the **Patient Requests** workflow.
There is no Keragon / Make / Zapier in the loop. Dialpad's signed event is
verified by the existing Netlify receiver and forwarded unchanged to the
Google Cloud Run workflow API, where it is verified again and written to the
Firestore-backed request and communication model. iFax/Gmail intake remains a
transitional Notion path until those channels migrate.

```
Dialpad → signed receiver → Cloud Run → patientRequests + communications → CrewOS / Chat
iFax / Gmail → Netlify function → transitional Notion triage
```

Every inbound function **fails closed**: it returns `503` and writes nothing
until its shared secret is set. Setting the secret is only half of it — the
external service must also be pointed at the function URL and (for Dialpad)
sign each event with that same secret.

Env-var changes only take effect on the **next deploy**.

## Channels

| Channel | Function | Netlify secret | External config |
|---|---|---|---|
| Texts, missed calls, voicemails | `/.netlify/functions/dialpad-events` → Cloud Run `/v1/webhooks/dialpad` | `DIALPAD_WEBHOOK_SECRET`, `RCM_CLOUD_API_URL` | Dialpad Event Subscriptions (SMS + call) → the function URL, webhook signed with the same secret |
| Faxes (consumer iFax delivers by email) | `/.netlify/functions/email-ingest` | `EMAIL_INGEST_SECRET` | `docs/gmail-ingest.gs` Apps Script forwards the fax emails with the secret |
| Faxes (iFax business webhook) | `/.netlify/functions/ifax-events` | `IFAX_WEBHOOK_SECRET` | iFax webhook → the function URL |

Base URL in production: `https://crewhq.bhwmedical.org`

## Dialpad (texts / missed calls / voicemails)

1. **API key** — Dialpad → Admin Settings → Company Settings → Authentication/API
   → create an API key (Company Admin required).
2. **Create the webhook** (returns an `id`):
   ```
   POST https://dialpad.com/api/v2/webhooks
   { "hook_url": "https://crewhq.bhwmedical.org/.netlify/functions/dialpad-events",
     "secret": "<DIALPAD_WEBHOOK_SECRET>" }
   ```
   The `secret` must equal the Netlify `DIALPAD_WEBHOOK_SECRET`. Dialpad signs
   each event as an HS256 JWT with it; `lib/triage.js` rejects any body that
   isn't correctly signed, so the endpoint can't be spoofed.
3. **Subscribe events** to that `webhook_id`:
   - Inbound SMS: `POST /api/v2/subscriptions/sms` `{ "webhook_id": …, "direction": "inbound", "enabled": true }`
   - Calls: `POST /api/v2/subscriptions/call` `{ "webhook_id": …, "enabled": true, "call_states": ["hangup","voicemail","recap_summary"] }`
   - Some Dialpad accounts also require a `target_type` / `target_id` (company or
     office) on the subscription — get IDs from `GET /api/v2/companies` /
     `GET /api/v2/offices`. Confirm field names against developers.dialpad.com.

Answered call lifecycle events without work are ignored. What becomes a Google-backed request or communication:
inbound texts, missed calls, voicemails (with Dialpad's voicemail transcript),
and — from the `recap_summary` state — the **Dialpad Ai action items** for a
call (the follow-ups it generated), surfaced instead of the raw transcript. If
a recap carries no action items, only its short recap summary is logged; calls
with neither are skipped so the inbox stays actionable.

## After configuring

Redeploy the site so the functions pick up the secret, then send a test (e.g.
text the Dialpad number with a synthetic/de-identified test contact). A request
should appear in the Google-backed Patient Requests command center and be
mirrored to its routed Chat space within a few seconds. CrewOS remains the
authoritative staff queue; Chat is an alert and quick-action surface. Shared or ambiguous phone numbers are logged as
unmatched communications and are never guessed.

### Secret must match on both sides

The single most common failure: the secret Dialpad **signs** events with (stored
on the Dialpad webhook, visible via `GET /api/v2/webhooks` under
`signature.secret`) must equal the Netlify `DIALPAD_WEBHOOK_SECRET`. If they
differ, `lib/triage.js` rejects every event as an invalid signature and nothing
reaches the queue — with no error the desk can see. When reusing an existing
webhook, read its `signature.secret` and set Netlify's env var to that exact
value (then redeploy), or recreate the webhook with the known secret.

### The env var must be readable by Functions (and needs a redeploy)

`dialpad-events` fails closed with **`503 DIALPAD_WEBHOOK_SECRET not set`** if the
secret isn't present in the function's runtime environment. Two gotchas that
produce a 503 even after "setting" the value:

- **Set it as a normal env var, scoped to Functions/Runtime.** A value that
  isn't in scope for functions reads back as `undefined` and 503s. (Symptom we
  hit: the var existed but the function still 503'd.)
- **Env-var changes only apply on the next deploy.** After setting/altering the
  secret, redeploy, then confirm in Netlify's function observability that
  `dialpad-events` returns `200`/`401` — not `503` — for incoming posts.

## Replying to patients (outbound)

The Google-backed Patient Requests command center sends no-PHI manual replies and
state-based notifications through Dialpad. Configure these values on Cloud Run:

- `DIALPAD_TOKEN` — a Dialpad API key with SMS (and Fax) scope.
- `DIALPAD_FROM` — the sending number in E.164, e.g. `+14437625343`.

The destination is read server-side from the Google Patient Master. The browser
never supplies a phone number. Consent, STOP suppression, quiet hours,
idempotency, and communication/audit writes are checked before each send.
