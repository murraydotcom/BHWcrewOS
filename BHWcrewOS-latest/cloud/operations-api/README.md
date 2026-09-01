# BHW Operations API

This Cloud Run service is the Google-native system of record for operational
patient requests, their work tasks, and their communication history. It uses the
same protected Firestore database as the migrated patient registry, but it does
not own patient demographics, medications, clinical documentation, claims, or
HR data.

## Boundaries

- `patients` remains the authoritative migrated Google registry. This service
  only verifies and references `BHW####` document IDs.
- Medication content and medication-status routing stay in the separate patient
  HTML/medication service already under development.
- RCM is a downstream specialist destination. `targetSystem: "rcm"` creates an
  operational handoff marker; this API does not write claims, remits, or RCM
  workflow state.
- WelcomeToBHW is HR-only and is not called by this service.
- No Google Chat message or SMS is sent. Notification metadata is recorded with
  `automationEnabled: false`, `policy: "manual-only"`, and
  `deliveryState: "not-scheduled"` so automation can be added later.

## Authentication

- CrewOS routes use a five-minute HMAC token with audience
  `bhw-operations-cloud`, minted only after a valid CrewOS staff session.
- `POST /v1/intake/patient-requests` is server-to-server. Care Connect sends
  `Authorization: Bearer <CARE_CONNECT_INTAKE_SECRET>`,
  `X-BHW-Client-Id: care-connect`, and a stable `Idempotency-Key`.
- Direct browser/mobile Firestore access remains denied. Cloud Run uses its
  service account and Google Cloud IAM.

## Environment

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT` | BHW Google Cloud project |
| `FIRESTORE_DATABASE` | Named Firestore DB; currently `bhw-rcm-prod` |
| `CREWOS_OPERATIONS_TOKEN_SECRET` | Shared only with the CrewOS token exchange |
| `CARE_CONNECT_INTAKE_SECRET` | Shared only with the Care Connect server/bridge |
| `CARE_CONNECT_CLIENT_ID` | Optional; defaults to `care-connect` |
| `ALLOWED_ORIGINS` | Comma-separated exact CrewOS origins for staff browser calls |

Use Secret Manager references when setting both secrets on Cloud Run. The
service account needs only the Firestore permissions required for the listed
collections. Do not put either secret or a service-account key in the repo.

## Routes

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | Health check | Service readiness, no patient data |
| `GET /v1/contracts/communication-foundation` | CrewOS | Current enums/schema version |
| `POST /v1/intake/patient-requests` | Care Connect server | Atomic request + triage task + inbound communication + audit |
| `GET/POST /v1/patient-requests` | CrewOS | List or create operational requests |
| `GET /v1/patient-requests/:id` | CrewOS | Read one request |
| `PATCH /v1/patient-requests/:id/status` | CrewOS | Validated state transition and timestamp/audit update |
| `POST /v1/patient-requests/:id/tasks` | CrewOS | Add a linked task |
| `GET /v1/tasks` | CrewOS | Filter by status, team, or request |
| `PATCH /v1/tasks/:id/status` | CrewOS | Validated task transition and audit update |
| `GET/POST /v1/communications` | CrewOS | Read or record communications; never dispatches them |

The intake request must use a stable idempotency key. Replaying the same key and
same normalized body returns the original request. Reusing the key with different
content returns `409`.

## Firestore documents

All operational records are flat, versioned documents. `auditEvents` are
metadata-only: they include actor, resource, BHW ID, transition, and timestamp,
but never message bodies, names, phone numbers, or email addresses.

The additive index manifest in `firestore.indexes.json` must be merged with the
canonical indexes already deployed for the shared named database. Do not replace
the existing database index manifest wholesale.
