# BHW Intel / Notion exit map

Last reconciled: 2026-10-08

The administrator-only **BHW Intel Connections** page is the protected cutover and status center for functions that began in Notion. It reports aggregate connection health only and never displays patient content or PIN hashes.

## Operational controls moving to CrewHQ Database

| Function | Temporary import source | Permanent CrewOS destination |
|---|---|---|
| Employee roster and hashed employee codes | Staff & Roles — Ops Hub | CrewHQ Database, `/setup.html`, and CrewOS authentication |
| Referral templates | Referral Templates | CrewHQ Database and the CrewOS referral form |
| Room rules | Rooms & Room Rules — Ops Hub | CrewHQ Database and scheduling validation |
| Staff availability | Availability — Crew Ops | CrewHQ Database and My Space |
| Shared schedule | Schedule — Crew Ops | CrewHQ Database and booking actions |
| Staff resources | Resources — BHW | CrewHQ Database and Resources |
| Crew projects | Crew Projects — Crew Ops | CrewHQ Database and My Space |
| Specialist reference data | Specialist Referral Directory | CrewHQ Database and Front Desk |

The cutover briefly pauses operational writes, imports only the allowlisted properties above, verifies both record counts and record-content hashes, and refuses to finalize until all eight sources pass. If an import fails, CrewOS returns to Notion mode and resumes writes. After finalization, every active runtime read and write uses CrewHQ Database; Notion is no longer contacted by these workflows.

## Historical workflow handoff

| Legacy workflow | Current authority | Current interface |
|---|---|---|
| Healthcare Operations Dashboard | BHW Operations Cloud | Patient Requests and crewOS |
| Care-plan workflow | Health 360 / BHW Health Core | Health 360 Care Plans |
| Clinical Action Items Tracker | BHW Operations Cloud / Health Core | Patient Requests and clinical workflow |
| Website updates | BHW Operations Cloud | Website Content |

The three patient-bearing legacy databases are deliberately excluded from the operational import. Current patient work is already routed to its protected BHW Cloud authority. Their historical rows are not queried or copied by the cutover because many lack a canonical patient relationship and an automatic import could attach clinical content to the wrong patient.

## Lab-analysis boundary

The CrewOS lab dashboard remains a synthetic contract preview unless both `LAB_INTELLIGENCE_PRODUCTION_READY=true` and a valid HTTPS `LAB_INTELLIGENCE_API_URL` are configured. Production activation also requires Health Core controls for provider authentication, authoritative source documents, audit logging, and protected storage. Legacy Notion lab text is not treated as an authoritative clinical source.

## Cutover and credential retirement

1. Deploy the CrewHQ Database migration and application changes.
2. Sign in as a CrewOS administrator and open `/bhw-intel-connections.html`.
3. Run **Import, verify & disconnect** and type `DISCONNECT NOTION` exactly.
4. Confirm the page displays **Notion runtime disconnected** and all eight controls report CrewHQ Database.
5. Remove `NOTION_TOKEN` and any Notion integration access from the production environment.
6. Run the status check again. Authentication, referrals, scheduling, resources, projects, and Front Desk must remain live without Notion.

Required after cutover:

- Netlify Database connection (platform-provided database configuration)
- `SESSION_SECRET`
- `OPERATIONS_CLOUD_API_URL`
- `RCM_CLOUD_API_URL`
- `LAB_INTELLIGENCE_PRODUCTION_READY` and `LAB_INTELLIGENCE_API_URL` only after controlled production approval

`NOTION_TOKEN` is needed only for the one-time import and can be removed after the verified cutover completes.
