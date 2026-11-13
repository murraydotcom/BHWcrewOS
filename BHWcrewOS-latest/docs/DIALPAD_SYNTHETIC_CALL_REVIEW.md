# Dialpad synthetic call documentation pilot

## Scope

This implementation is a BHW0000-only test of call capture, staff review, and linked operational follow-up. It is not a live Dialpad integration or a HealthCore clinical note. No production deployment, webhook subscription, account change, or patient message is part of this change.

The working screen is `/bhw-call-review.html`, linked from FrontDeskOS. Patient Requests link back to the specific call review. The Registry detail links to `/bhw-call-review.html?patient=BHW0000`, which shows only calls staff have confirmed for the reserved synthetic identity. Requests remain unmatched until that confirmation.

## Staff workflow

1. Open Call review using an authenticated CrewHQ session.
2. Load the synthetic test call. Connected calls can be reviewed even when there is no AI summary.
3. Review the separate source summary, source action items, and any voicemail transcription.
4. Document caller relationship, reason/relevant facts, action taken, outcome, next action, owner, and a future due time.
5. Confirm the BHW0000 identity and save. The screen makes a separate protected read to verify the saved submission before showing success.
6. Open the linked Patient Request to coordinate follow-up. Ownership, due date, and next action are shown there. Reopen a completed request before saving additional follow-up.

Later source events append to the same call record and flag the source as changed. They do not overwrite staff reviews, reset ownership, reopen a completed task, or send a message. Duplicate events and exact submission retries do not create extra calls or reviews. Concurrent edits require reload rather than silently replacing an intervening revision.

## Configuration and boundaries

`DIALPAD_CALL_REVIEW_ENABLED` is off by default. Setting it to `true` enables only this synthetic pilot. There is no real-patient activation switch.

Accepted call fixtures must have all of the following:

- `call_id` beginning with `bhw-synthetic-`;
- external number `+15555550199`;
- JSON-string `custom_data` containing `{"synthetic":true,"bhwPatientId":"BHW0000"}`;
- a recognized call state and inbound/outbound direction.

The enabled pilot rejects real call events. Do not enable it on an endpoint receiving a live Dialpad call subscription. Existing SMS processing is unchanged. When the pilot is disabled, the existing legacy webhook behavior is unchanged as well.

Existing JWT verification remains required on `/v1/webhooks/dialpad`. The Netlify forwarding receiver uses `OPERATIONS_CLOUD_API_URL` and the existing webhook secret; this change adds no credentials. Staff routes reuse the existing short-lived Google Operations token flow and require an allowed clinical/operations role. Billing-only and patient roles are denied.

## API and storage

| Route | Purpose |
| --- | --- |
| `GET /v1/call-reviews` | List up to 100 call reviews for authorized staff |
| `GET /v1/call-reviews?bhwPatientId=BHW0000` | List staff-confirmed synthetic patient history |
| `POST /v1/call-reviews/synthetic-fixture` | Create or replay the fixed synthetic test call |
| `POST /v1/call-reviews/:id/review` | Validate and append a staff review using revision and submission reference |

A Firestore transaction writes `patientCallReviews/{id}`, a create-only `revisions/{revision}` snapshot, one linked `patientRequests` record, one voice `communications` record, the existing request task, and a metadata-only audit entry. Call source text and complete staff reviews stay in the protected call collection; compatibility communication records and audit events contain no source narrative. The linked Patient Request contains the staff-reviewed reason and operational follow-up.

The reserved BHW0000 identity is validated directly; this is not a production Registry identity-matching implementation. Neither the browser nor this API writes a HealthCore chart, signs a clinical note, sends patient messages, or calls an external AI service. Browser drafts are memory-only. Direct Firestore client access must remain denied; the existing Operations service account owns database access.

Before any deployment, confirm the Operations service account can access the new collection and that no browser rules expose it. Test against an isolated synthetic database/revision first. Index and IAM configuration are not changed by this PR. The existing `BHW0000_ACCEPTANCE_ONLY` perimeter accepts only Blueprint routes; it is deliberately unchanged. Use a separately reviewed isolated call-review candidate rather than widening that perimeter.

## Validation

The focused Node tests exercise source ordering, duplicate delivery, concurrent recap events, synthetic-only gates, role checks, staff identity attestation, revision conflicts, exact retry behavior, immutable history, request/task preservation, webhook signatures, and authenticated API read-back using a transactional Firestore test double. They do not establish deployed Firestore or live Dialpad behavior.

Run from the repository root:

```sh
node --test BHWcrewOS-latest/test/call-review.test.mjs BHWcrewOS-latest/test/dialpad-service.test.mjs BHWcrewOS-latest/test/operations-workflow-api.test.mjs BHWcrewOS-latest/test/workflow-automation.test.mjs BHWcrewOS-latest/test/workflow-request-listing.test.mjs
npm --prefix BHWcrewOS-latest/cloud/operations-api run check
```

Browser acceptance was attempted in the development runtime, but Chromium could not start because the runtime denied its singleton socket. Visual layout and interactive browser acceptance therefore remain unverified. Module and inline-script syntax checks are separate from browser testing.

## Next release boundary

A live pilot requires a separately reviewed release: validate actual subscribed Dialpad event schemas, permit real Registry identity resolution with staff confirmation, confirm applicable account and data-handling configuration, test isolated Google persistence, and approve production activation. Company Admin access alone does not activate this code. This PR deliberately does not create the live event subscription.
