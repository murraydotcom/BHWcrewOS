# Dialpad to Health Core call documentation setup

## Intended outcome

After a completed call, a protected staff work item should be available with the
call reference, time, direction, review state, and available Dialpad recap.
Staff verify the patient, review the note, assign follow-up, and confirm completion.
FrontDeskOS and Patient Requests show the operational follow-up; Health Core
remains the clinical record. Nothing is automatically signed as a clinical note.

## Evidence reviewed

Reviewed CrewOS main at `2e743af33494204109a38a7d3400d802134796f8`
and Health Core main source on November 12, 2026 (America/New_York).

Existing components:

- `BHWcrewOS-latest/netlify/functions/dialpad-events.js` verifies a signed
  provider payload and forwards it to the Google Operations API.
- `BHWcrewOS-latest/cloud/operations-api/dialpad-service.mjs` normalizes SMS,
  missed calls, voicemails, and inbound recaps.
- `BHWcrewOS-latest/cloud/operations-api/workflow-service.mjs` stores
  communications and links operational work to the protected patient registry.
- Health Core `src/patient-messaging.mjs` has a separate, synthetic-only
  correspondence review contract. It is not a Dialpad call intake endpoint.

Source presence does not establish that a production revision is deployed,
credentials are configured, or the Dialpad account is subscribed.

## Synthetic diagnostic results on the current normalizer

No real account, patient, recording or outbound message was used.

| Input | Observed behavior | Needed for this feature |
| --- | --- | --- |
| Connected inbound hangup with duration, no recap | Returns null | Capture a completed-call record even if AI is unavailable |
| Outbound recap with call_id | Classified as delivery-status | Treat as voice recap, retain outbound direction and the patient-side number |
| Inbound recap | Classified as call-recap | Keep source text separate from the staff-reviewed note |
| Missed and recap events with the same call_id | Both use that call_id as providerMessageId | Handle lifecycle updates without dropping a later recap or creating duplicate work |

Additional source findings to address before activation:

- The webhook handler routes every outbound event through SMS delivery handling.
- Voice communication writes inherit the default SMS channel unless explicitly
  overridden, although the audit entry labels them as voice.
- Request association uses the patient's latest open request, rather than an
  explicit call-to-request relationship.
- A unique phone match is not confirmation of the caller's identity or the
  patient discussed. Shared, unknown and caregiver calls need staff review.
- Existing intake can invoke notification behavior. The call-documentation path
  needs explicit suppression of patient notifications.
- The older intake setup table mentions RCM_CLOUD_API_URL; the actual receiver
  requires OPERATIONS_CLOUD_API_URL. Use the code contract.

## Implementation before account activation

1. Correct voice event classification in both directions. Distinguish call end,
   missed call, voicemail, recap, action items, and SMS delivery updates.
2. Use the provider call ID for a stable call record and separate event identities
   for lifecycle updates. Preserve chronology and handle retries, concurrent
   deliveries and events arriving out of order.
3. Keep call records in an unverified staff review queue until identity is
   confirmed. Phone matches are candidates. No new Patient Registry record is
   created from a caller number.
4. Add an explicit, attributable call-note review contract and protected Health
   Core display. Retain original provider text, staff edits, reviewer, timestamps,
   revision and medical-record disposition. An AI recap is an unreviewed draft.
5. Use the existing operational queue for owner, next action, due point, status
   and completion evidence. Link a request explicitly; do not attach a new call
   to an unrelated latest-open request.
6. Provide the BHW call-note fields: caller/relationship, verification status,
   reason, relevant facts, action taken, outcome, unresolved need, next step,
   owner, due point, escalation/receiving clinician, and record-entry status.
7. Enforce the existing BHW0000 synthetic-only boundary during development.
   Patient messages, live subscriptions, clinical signing, automatic prescribing,
   billing and patient-visible release remain outside this setup change.

## Dialpad account setup after the synthetic workflow passes

Use a Company Admin account. Confirm API access and AI Recaps availability for
the actual office/department lines and users to be included. Choose the initial
test line and scope; do not subscribe the whole company by default.

- Review existing webhooks and subscriptions before creating another one.
- Generate or select a dedicated webhook signing secret in the approved secret
  store. Configure the same secret at the receiver and in Dialpad.
- The documented CrewHQ receiver is
  `https://crewhq.bhwmedical.org/.netlify/functions/dialpad-events`; verify its
  deployed handler and Google forwarding destination before registering it.
- The current receiver requires DIALPAD_WEBHOOK_SECRET and
  OPERATIONS_CLOUD_API_URL. The Google handler independently verifies the
  signature with its configured DIALPAD_WEBHOOK_SECRET.
- Register the webhook through POST /api/v2/webhooks, then create the scoped
  POST /api/v2/subscriptions/call subscription.
- For the call-note workflow, validate the account's supported call states for
  hangup, missed, voicemail, voicemail_uploaded, transcription, recap_summary,
  and recap_action_items. Enable only the states implemented and tested.
- Treat recap/transcription availability as asynchronous: a hangup event may
  arrive before a summary, and short calls or voicemail may have no AI recap.
- Keep API credentials and webhook secrets server-side. Never paste them into
  chat, a browser bundle, a PR, or a downloaded template.
- Do not enable patient notifications as part of receiving call records.

This document does not authorize deployment or a live subscription. Production
activation requires Amaris's approval under the existing project restrictions.

## Acceptance walkthrough

Use signed, fabricated provider events and only BHW0000 in isolated tests.

| Scenario | Required evidence |
| --- | --- |
| Completed inbound call without AI | One staff-review call record, voice channel, correct time and source |
| Completed outbound call and later recap | Correct patient-side number and direction; original call enriched |
| Missed call followed by voicemail/recap | No lost update; one explicit operational follow-up relationship |
| Shared/unknown/caregiver number | No automatic clinical attachment; staff identity-review path |
| Replayed or out-of-order event | No duplicate call/work item; no rollback of review or source chronology |
| Invalid/missing signature or disabled intake | Rejected without a write or notification |
| Staff edits and follow-up | Attributable reviewed revision plus explicit owner/action/due/status |
| Clinical content | Required clinician review and exact-version medical-record disposition |
| Closing work | Verified completion evidence; original source and review history preserved |

## What remains to verify in the environment

- The deployed CrewHQ/Operations API revision and Health Core review routes.
- Existing secret configuration, without exposing values.
- The Dialpad plan, admin/API access, scoped line/department IDs, existing webhook
  subscriptions, and AI Recap entitlement.
- The precise initial staff roles and approved patient-call feature scope.
- Synthetic write/read-back evidence across call receipt, review, Health Core
  display and FrontDeskOS follow-up.

## Official provider references

- https://developers.dialpad.com/docs/call-events
- https://developers.dialpad.com/reference/webhookscreate
- https://developers.dialpad.com/reference/webhook_call_event_subscriptioncreate
- https://help.dialpad.com/hc/en-us/articles/55028030876187-AI-Recaps
