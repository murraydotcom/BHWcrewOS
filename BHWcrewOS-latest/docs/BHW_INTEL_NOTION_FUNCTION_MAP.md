# BHW Intel / Notion exit map

Last reconciled: 2026-11-19

## Verified staff recovery

CrewOS staff authentication was recovered into CrewHQ Database on 2026-11-18 from the 2026-10-08 downloaded workspace export. The import preserved all 16 original staff page IDs, account permissions, and 10 saved PIN hashes, then verified stored contents inside the transaction before activating database routing for staff reads and writes. The later departure of Taylor Allen is reconciled through a scoped data migration. The temporary import authorization was removed after recovery.

## Production recovery from the downloaded export

A staffed admin session in Chrome verified the 2026-11-19 production import. The recovery transaction verified record counts and contents before switching the four controls listed below. The data reflects the 2026-10-08 workspace export.

| Control | Verified production source | Records or recovery gap |
|---|---|---|
| Staff roster and authentication | CrewHQ Database | Recovered 2026-11-18 |
| Rooms and rules | CrewHQ Database | 14 |
| Referral templates | CrewHQ Database | 11 |
| Staff resource index | CrewHQ Database | 32 |
| Specialist directory | CrewHQ Database | 117 |
| Staff availability | Notion, currently unavailable | Export links to an absent CSV |
| Shared schedule | Notion, currently unavailable | Export links to an absent CSV |
| Crew projects | Notion, currently unavailable | 12 exported rows, staff relations absent |

Twenty-one resource index entries still link to Notion. Their matching HTML pages are present in the archive. Tracker and database index pages require a current workflow destination, and any republished reference pages and attachments must use the appropriate staff access controls. The remaining 11 entries link to Google Workspace.

Twenty-six specialist entries had ambiguous original page IDs because identical matching HTML pages were exported. The importer assigned deterministic IDs for those entries and preserved their matched field values. The referring tools use the directory fields independently of those IDs.

The administrator-only **Notion Connections** page is the protected cutover and status center for functions that began in Notion. Its **Manage BHWcrewOS controls** link opens `/crewos-controls.html`, where administrators can create and edit employees (including setting/resetting hashed PINs), referral templates, rooms/rules, resources, crew projects, and specialist directory entries after cutover. Saves use optimistic version checks and transactional read-back verification. The status page reports aggregate health only and never displays patient content or PIN hashes.

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

The final cutover briefly pauses operational writes, imports only the outstanding controls and their allowlisted properties, verifies record counts and content hashes, and refuses to finalize until all eight controls pass. If an import fails, CrewOS restores the previous routing and resumes writes. After finalization, every active runtime read and write uses CrewHQ Database; Notion is no longer contacted by these workflows.

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
3. Reconcile staff availability, scheduling, and project assignments against a verified source. Run **Import, verify & disconnect** only when the outstanding sources can be verified.
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
