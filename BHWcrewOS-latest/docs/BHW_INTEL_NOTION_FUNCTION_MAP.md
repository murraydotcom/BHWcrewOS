# BHW Intel / Notion function map

Last reconciled: 2026-10-08

The administrator-only **BHW Intel Connections** page is the live status and routing map for functions that began in Notion. It reports aggregate connection health only and never displays patient content or PIN hashes.

## Still live from Notion

| Function | Notion source | CrewOS destination |
|---|---|---|
| Employee roster and hashed employee codes | Staff & Roles — Ops Hub | `/setup.html` and CrewOS authentication |
| Referral templates | Referral Templates | CrewOS referral form |
| Room rules | Rooms & Room Rules — Ops Hub | CrewOS scheduling validation |
| Staff availability | Availability — Crew Ops | CrewOS My Space availability form |
| Shared schedule | Schedule — Crew Ops | CrewOS schedule and booking actions |
| Staff resources | Resources — BHW | CrewOS Resources |
| Crew projects | Crew Projects — Crew Ops | CrewOS My Space projects |
| Specialist reference data | Specialist Referral Directory | Front Desk |

These databases contain staff/operations configuration or non-patient reference data. They remain runtime dependencies and are checked by `/.netlify/functions/intel-connections`. The page labels each dependency as read-only or read/write to match the current code path.

## Historical workflow handoff

| Legacy workflow | Current authority | Current interface |
|---|---|---|
| Healthcare Operations Dashboard | BHW Operations Cloud | Patient Requests and crewOS |
| Care-plan workflow | Health 360 / BHW Health Core | Health 360 Care Plans |
| Clinical Action Items Tracker | BHW Operations Cloud / Health Core | Patient Requests and clinical workflow |
| Website updates | BHW Operations Cloud | Website Content |

The status endpoint checks the three legacy Notion schemas but does **not** query their patient-bearing rows. Most historical rows lack a canonical patient relationship, so an automatic bulk import would risk attaching clinical or operational content to the wrong patient.

## Lab-analysis boundary

The CrewOS lab dashboard remains a synthetic contract preview unless both `LAB_INTELLIGENCE_PRODUCTION_READY=true` and a valid HTTPS `LAB_INTELLIGENCE_API_URL` are configured. Production activation also requires the Health Core controls for provider authentication, authoritative source documents, audit logging, and protected storage. Legacy Notion lab text is not treated as an authoritative clinical source.

## Environment dependencies

- `NOTION_TOKEN`
- `SESSION_SECRET`
- `OPERATIONS_CLOUD_API_URL`
- `RCM_CLOUD_API_URL`
- `LAB_INTELLIGENCE_PRODUCTION_READY` and `LAB_INTELLIGENCE_API_URL` only after controlled production approval

