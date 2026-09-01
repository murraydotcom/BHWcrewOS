# Google-native patient communication foundation

## Decision and scope

CrewOS owns the operational request lifecycle. The protected Google patient
registry remains authoritative for patient identity. The separate medication
page/service owns medication display and medication-status routing. RCM remains
a downstream specialist destination for billing work. WelcomeToBHW remains an
HR-only system and has no dependency on this API.

This phase implements storage and contracts only. It does **not** send SMS,
email, Google Chat, or any other automatic patient notification.

```text
Care Connect / CrewOS / approved inbound adapter
                    |
                    v
          BHW Operations API (Cloud Run)
                    |
                    v
  patientRequests -- tasks -- communications -- auditEvents
                    |
          BHW#### patient reference
                    |
          existing protected patient registry
```

## Record contracts

Every document has `schemaVersion: 1`, immutable external ID fields, ISO-8601
timestamps, and pseudonymous `BHW####` references when a patient match is
verified.

### `patientRequests/{patientRequestId}`

Core fields:

- identity: `patientRequestId`, `bhwPatientId`, `patientMatchStatus`
- classification: `requestType`, `source`, `priority`, `summary`
- lifecycle: `status`, `statusReasonCode`, `receivedAt`, `statusChangedAt`,
  `triagedAt`, `startedAt`, `waitingSince`, `resolvedAt`, `closedAt`,
  `cancelledAt`, `dueAt`
- ownership/routing: `routing.targetSystem`, `routing.assignedTeam`,
  `routing.assignedTo`, `routing.ownerRole`, `routing.downstreamReference`
- linkage: `taskIds`, `communicationIds`, `communicationCount`,
  `lastCommunicationAt`
- notification readiness: `notificationMetadata.policy`,
  `automationEnabled`, `lastEligibleEvent`, `lastEligibleAt`, `deliveryState`,
  `lastPatientNotifiedAt`, `lastCommunicationId`
- provenance: `sourceMetadata`, `createdAt`, `createdBy`, `updatedAt`,
  `updatedBy`

The current notification settings are fixed to:

```json
{
  "policy": "manual-only",
  "automationEnabled": false,
  "deliveryState": "not-scheduled"
}
```

Changing a request status updates the appropriate timestamp and records the
future notification event type, but it never queues or sends a notification.

### `tasks/{taskId}`

Tasks link to one `patientRequestId` and carry `taskType`, `taskStatus`,
ownership, target system, due date, and lifecycle timestamps. The initial
request transaction always creates one open `triage` task. More tasks can be
added without changing the request schema.

`targetSystem: "rcm"` means the task is ready for a future RCM adapter. It does
not make RCM the task owner and does not write to claims or remits.

### `communications/{communicationId}`

Communications record what happened; this service is not a delivery provider.
The contract includes direction, channel, delivery/recording status, event type,
patient visibility, request status at the event, optional consent snapshot,
provider message ID, delivery timestamps, and bounded content.

An outbound communication can be recorded only after another system or staff
member has acted. Future Dialpad automation can use the same collection without
changing the request model.

### `auditEvents/{auditEventId}`

Audit documents intentionally exclude message bodies, names, phone numbers, and
email addresses. They contain actor, resource, BHW ID, event type, timestamp,
and the changed status/reason metadata.

### `intakeReceipts/{hash}`

The secure intake endpoint hashes the client/key scope and stores only a key
hash, normalized payload hash, created request ID, and timestamp. A retry with
the same key and body returns the original request; key reuse with different
content returns `409`.

## Lifecycle rules

Patient request transitions:

```text
received -> triaged -> in-progress -> resolved -> closed
                 |          |
                 |          +-> waiting-on-patient -> in-progress
                 |          +-> waiting-on-external -> in-progress
                 +-------------------------------> resolved

resolved or closed -> in-progress  (reopen)
active states -> cancelled
```

Task transitions:

```text
open -> in-progress -> done
  |          |
  +-> blocked+-> blocked
blocked -> open or in-progress
done/cancelled -> open  (reopen)
```

Invalid transitions return `409` and do not write an audit event.

## Care Connect secure intake contract

Care Connect should call the Cloud Run endpoint from its server or an approved
server-side bridge. A browser must not receive the intake secret.

```http
POST /v1/intake/patient-requests
Authorization: Bearer <secret from Secret Manager>
X-BHW-Client-Id: care-connect
Idempotency-Key: cc:synthetic-submission-0001
Content-Type: application/json
```

Synthetic example:

```json
{
  "bhwPatientId": "BHW0000",
  "patientMatchStatus": "matched",
  "requestType": "referral",
  "priority": "routine",
  "summary": "Patient asked for a referral update",
  "message": "Please let me know whether the referral was sent.",
  "requester": {
    "displayName": "Synthetic Patient",
    "preferredChannel": "portal"
  },
  "routing": {
    "targetSystem": "crewos",
    "assignedTeam": "front-desk"
  },
  "sourceMetadata": {
    "sourceRecordId": "synthetic-submission-0001",
    "sourcePage": "care-connect-patient-page"
  }
}
```

If Care Connect does not have a session-verified BHW ID, it must omit the ID and
send `patientMatchStatus: "unmatched"`. It must never guess an ID from a name.
The existing `portal-message` Netlify bridge follows this rule: it only supplies
a BHW ID when a server-side patient match finds an exact migrated ID; otherwise
the request enters the review queue as unmatched.

The intake transaction creates exactly one request, triage task, inbound portal
communication, three metadata-only audit events, and one idempotency receipt.

## CrewOS integration points

- `operations-cloud-config` exposes only a configured HTTPS Cloud Run base URL.
- `operations-cloud-token` exchanges a valid CrewOS session for a five-minute
  token with audience `bhw-operations-cloud`.
- CrewOS boards can adopt `GET /v1/patient-requests` and status/task endpoints
  one board at a time while Notion remains transitional.
- `portal-message` uses Cloud Run when both `OPERATIONS_CLOUD_API_URL` and
  `CARE_CONNECT_INTAKE_SECRET` are configured. If they are absent, its existing
  Notion queue path remains available during transition.

The existing Front Desk page is not switched in this phase. Configure Cloud
intake only when staff also have a supported way to view the Google queue, or
use the endpoints to build that view next.

## Deployment dependencies

1. Merge the additive indexes with the existing indexes for named Firestore
   database `bhw-rcm-prod`.
2. Create a least-privilege Cloud Run service account for the six collections
   used by this API.
3. Create two independent Secret Manager secrets: one for CrewOS staff tokens
   and one for Care Connect intake.
4. Deploy the `cloud/operations-api` container and set exact CrewOS origins.
5. Add `OPERATIONS_CLOUD_API_URL` and the matching secrets to CrewOS/Netlify.
6. Have Care Connect send a stable server-generated submission ID as the
   idempotency key.
7. Before retiring Notion, migrate open triage records with source IDs and run a
   reconciliation report. No migration script is included in this phase.

Do not enable patient notification automation until consent lookup, template
approval, Dialpad delivery callbacks, retry/dead-letter behavior, and operational
monitoring are implemented and tested.
