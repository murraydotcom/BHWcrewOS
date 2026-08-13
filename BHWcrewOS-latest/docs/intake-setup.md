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
   - Calls: `POST /api/v2/subscriptions/call` `{ "webhook_id": …, "enabled": true, "call_states": ["hangup","voicemail"] }`
   - Some Dialpad accounts also require a `target_type` / `target_id` (company or
     office) on the subscription — get IDs from `GET /api/v2/companies` /
     `GET /api/v2/offices`. Confirm field names against developers.dialpad.com.

Answered and outbound events are ignored by the function; only inbound
texts, missed calls, and voicemails become queue rows.

## After configuring

Redeploy the site so the functions pick up the secret, then send a test (e.g.
text the Dialpad number). A row should appear in the Front Desk inbox within a
few seconds, matched to a patient by phone when the number is on the Master
List.
