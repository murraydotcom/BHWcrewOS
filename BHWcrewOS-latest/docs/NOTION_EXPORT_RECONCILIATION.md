# Notion export reconciliation

Source: five CSV attachments supplied on 2026-10-15. Source files and patient-bearing contents are excluded from the repository and published assets.

| Export | Workspace | Rows | Source columns |
| --- | --- | ---: | ---: |
| Untitled 0a35-14de | Purchasing and deliveries | 5 | 8 |
| Untitled 1e15-c2ee | Resource library | 5 | 6 |
| Untitled 1f45-451c | Marketing and website tasks | 17 | 7 |
| Untitled 2135-a6b2 | Invoices and estimates | 4 | 6 |
| Untitled 2c85-5c27 | Healthcare Operations Dashboard | 157 | 10 |
| Total | All five retained at the user's request | 188 | |

## Quality and reconciliation findings

- Healthcare dashboard: 111 Done, 33 Not started, 12 In progress, one untitled row without a status. Preserve the untitled row; do not drop it or invent a task name.
- All exported Assignee cells are empty. Do not infer ownership.
- Only 23 healthcare rows contain an exact `BHW####` identifier in their title. Titles can describe multiple patients or practice-wide billing issues; do not automatically link or create Patient Registry records.
- Four smaller datasets appear to contain template examples. The user explicitly requested retention of all four datasets and all their rows.
- All five sources have zero exact duplicate rows. The importer also preserves duplicate occurrences if encountered in a later upload.
- Preserve dates, amounts, statuses, notes, categories, links, and checkbox exports as source strings. They are not evidence of current clinical urgency, billing eligibility, paid invoices, or current order delivery.
- These files do not include the Care-plan/Lab-analysis database or Clinical Action Items Tracker. Their content and complete workflow parity remain unverified.

## Implementation

`bhw-notion-workspaces.html` provides the five native table/editor views, search, status/review filters, pagination, and preview/import/save controls. Its Netlify proxy authenticates the existing CrewOS Admin session. Patient-bearing titles and other records are stored only through the protected Operations Cloud service, not in static assets, browser storage, or Netlify Database.

The Cloud service stores imported data in `notionWorkspaceDatasets/{workspace}/records/{id}`. Original fields and source fingerprints are immutable. Imports preserve status, use retry-safe IDs, verify stored originals after write, and never overwrite edits on replay. Native edits use optimistic versions, staff attribution, metadata-only audit records, and read-back verification. Imported healthcare records begin as `needs-review`. None of these routes sends communications, creates orders, mutates claims, or links patients.

## Activation

The Operations Cloud service must be deployed from `cloud/operations-api` before publishing the CrewOS links and proxy. It uses its existing Firestore connection and `CREWOS_OPERATIONS_TOKEN_SECRET`; no new credentials or public access are required. Verify authorized GET `/v1/notion-workspaces/healthcare` returns its definition and an empty records list before the first import.

After the Cloud service is live, deploy the matching CrewOS change, sign in as Admin, open Notion Connections → Open imported workspaces, select each workspace, and upload its corresponding CSV. Preview must match 5, 5, 17, 4, and 157 rows respectively. Import all records and require the same verified counts. Healthcare rows remain imported history pending review, with 111 Done and 45 open entries unchanged. Replaying a file must report already retained rows, without duplicating or resetting edits.

At implementation time this execution environment has no Google Cloud outbound identity or credentials. Therefore live Cloud deployment and production data import have not been performed or verified.
