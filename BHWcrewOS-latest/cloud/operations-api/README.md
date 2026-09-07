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
- Google Chat is a no-PHI mirror with role/service-line routing, actionable
  cards, and CrewOS deep links. CrewOS/Firestore remains authoritative.
- Patient SMS uses Dialpad only. State-specific templates avoid equating PA
  submission with approval or referral transmission with scheduling.
- Automation fails closed when disabled or unconfigured, and applies consent,
  suppression, quiet-hours, safety-hold, cooldown, and idempotency controls.

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
| `FRONT_DESK_INTAKE_SECRET` | Server-only secret used by the Front Desk referral bridge |
| `FRONT_DESK_CLIENT_ID` | Optional; defaults to `front-desk-os` |
| `ALLOWED_ORIGINS` | Comma-separated exact CrewOS origins for staff browser calls |
| `PATIENT_WORKFLOW_AUTOMATION_ENABLED` | Master SMS dispatch gate; anything except `true` suppresses sends |
| `PATIENT_PORTAL_URL` | HTTPS secure patient-page link used by no-PHI templates |
| `PATIENT_NOTIFICATION_RULES_JSON` | Optional rule enable/template/cooldown overrides |
| `SMS_TIME_ZONE` | Quiet-hours timezone; defaults to `America/New_York` |
| `SMS_QUIET_HOURS_START` / `SMS_QUIET_HOURS_END` | Quiet-hours window; defaults to `20:00` / `08:00` |
| `WORKFLOW_DISPATCH_AUDIENCE` | HTTPS audience for the Cloud Scheduler OIDC token |
| `WORKFLOW_DISPATCH_SERVICE_ACCOUNT` | Exact scheduler service-account email allowed to dispatch queued messages |
| `WORKFLOW_DISPATCH_SECRET` | Optional legacy shared-secret dispatcher authentication; prefer OIDC |
| `DIALPAD_TOKEN` / `DIALPAD_FROM` | Approved Dialpad SMS credentials/from number |
| `DIALPAD_WEBHOOK_SECRET` | Verifies signed Dialpad inbound/status callbacks |
| `DIALPAD_API_BASE` | Optional Dialpad API base; HTTPS only |
| `GOOGLE_CHAT_ENABLED` | Master Google Chat dispatch gate |
| `GOOGLE_CHAT_AUTH_AUDIENCE` | Audience used to verify Google Chat interaction tokens |
| `GOOGLE_CHAT_SPACES_JSON` | Team/service-line to `spaces/...` routing map |
| `GOOGLE_CHAT_DEFAULT_SPACE` | Optional safe fallback Chat space |
| `GOOGLE_CHAT_STAFF_ROLES_JSON` | Staff email to CrewOS role mapping for card actions |
| `GOOGLE_CHAT_CARD_UPDATES_ENABLED` | Gates API-based card edits after initial send |
| `CREWOS_REQUESTS_URL` | HTTPS deep-link base for Patient Requests |

Use Secret Manager references when setting both secrets on Cloud Run. The
service account needs only the Firestore permissions required for the listed
collections. Do not put either secret or a service-account key in the repo.

## Routes

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | Health check | Service readiness, no patient data |
| `GET /v1/contracts/communication-foundation` | CrewOS | Current enums/schema version |
| `POST /v1/intake/patient-requests` | Care Connect server | Atomic request + triage task + inbound communication + audit |
| `POST /v1/intake/front-desk-referrals` | Front Desk server bridge | Create one matched referral workflow record after document generation |
| `POST /v1/intake/front-desk-patient-requests` | Front Desk server bridge | Create one matched or unresolved inbound fax/email request in the authoritative queue |
| `POST /v1/intake/front-desk-referrals/:id/actions` | Front Desk server bridge | Record referral sent/ready/scheduled milestones without exposing the server secret |
| `GET/POST /v1/patient-requests` | CrewOS | List or create operational requests |
| `GET /v1/patient-requests/:id` | CrewOS | Read one request |
| `POST /v1/patient-requests/:id/actions` | CrewOS / Chat | Assign, start, milestone, resolve, reopen, escalate, or unassign |
| `POST /v1/patient-requests/:id/notify` | CrewOS | Apply the current safe template through the approved channel |
| `POST /v1/patient-requests/:id/messages` | CrewOS | Send an attested no-PHI manual SMS through Dialpad |
| `GET /v1/patient-requests/:id/communications` | CrewOS | Read inbound/outbound delivery and suppression history |
| `PATCH /v1/patient-requests/:id/status` | CrewOS | Validated state transition and timestamp/audit update |
| `POST /v1/patient-requests/:id/tasks` | CrewOS | Add a linked task |
| `GET /v1/tasks` | CrewOS | Filter by status, team, or request |
| `PATCH /v1/tasks/:id/status` | CrewOS | Validated task transition and audit update |
| `GET/POST /v1/communications` | CrewOS | Read or record compatibility communications |
| `GET /v1/notification-rules` | CrewOS | Read effective receipt/progress/waiting/completed rules |
| `PATCH /v1/notification-rules/:id` | Operations | Change one safe notification rule |
| `POST /v1/chat/events` | Google Chat | Verified app installation, messages, and card actions |
| `POST /v1/webhooks/dialpad` | Dialpad | Verified inbound SMS, STOP/START, and delivery updates |
| `POST /v1/workflow/dispatch` | Scheduler | Dispatch quiet-hours messages that are due |

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
