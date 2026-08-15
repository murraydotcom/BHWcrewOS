# Inbound intake setup (direct webhooks — no middleware)

How inbound patient communications reach the **Front Desk OS inbox**. There is
no Keragon / Make / Zapier in the loop — each channel posts directly to a
Netlify function that writes a row into the **Patient Request Triage Queue**
(Notion), which `bhw-front-desk.html` renders (Calls & voicemails / Texts &
portal / Faxes & other, bucketed by the row's `Source`).

```
Dialpad / iFax / Gmail  →  Netlify function  →  Triage Queue (Notion)  →  Front Desk inbox
```

Every inbound function **fails closed**: it returns `503` and writes nothing
until its shared secret is set. Setting the secret is only half of it — the
external service must also be pointed at the function URL and (for Dialpad)
sign each event with that same secret.

Env-var changes only take effect on the **next deploy**.

## Channels

| Channel | Function | Netlify secret | External config |
|---|---|---|---|
| Texts, missed calls, voicemails | `/.netlify/functions/dialpad-events` | `DIALPAD_WEBHOOK_SECRET` | Dialpad Event Subscriptions (SMS + call) → the function URL, webhook signed with the same secret |
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

Answered/outbound call *lifecycle* events are ignored. What becomes a queue row:
inbound texts, missed calls, voicemails (with Dialpad's voicemail transcript),
and — from the `recap_summary` state — the **Dialpad Ai action items** for a
call (the follow-ups it generated), surfaced instead of the raw transcript. If
a recap carries no action items, only its short recap summary is logged; calls
with neither are skipped so the inbox stays actionable.

## After configuring

Redeploy the site so the functions pick up the secret, then send a test (e.g.
text the Dialpad number). A row should appear in the Front Desk inbox within a
few seconds, matched to a patient by phone when the number is on the Master
List.

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

Front Desk inbox "Reply" sends a text from the practice line via Dialpad. Two
env vars, set as plain Functions-scoped values (not "secret"), then redeploy:

- `DIALPAD_TOKEN` — a Dialpad API key with SMS (and Fax) scope.
- `DIALPAD_FROM` — the sending number in E.164, e.g. `+14437625343`.

`frontdesk-data` passes the key via `?apikey=` (Dialpad sits behind Google Cloud
Endpoints, which reads the key from the query string) plus a Bearer header.
