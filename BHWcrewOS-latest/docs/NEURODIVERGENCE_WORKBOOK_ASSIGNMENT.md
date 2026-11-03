# Neurodivergence workbook assignment and voluntary sharing boundary

## Implemented assignment path

- Staff must be inside the provider-gated Patient Materials & Feedback page.
- The patient is selected from the authenticated Patient 360 registry. The exact `bhwPatientId` is sent as `patientId`; names, dates of birth, and free text are not used to bind the assignment.
- Staff selects one of the workbook's seven supported bands: `0-5`, `6-7`, `8-12`, `13-18`, `19-29`, `30-54`, or `55+`.
- The persisted assignment title includes the selected age label so the staff-side assignment history retains that provenance. The private HTTPS patient link also carries the allow-listed age-band identifier and opens the matching existing workbook file directly.
- Staff may allow a patient or parent/guardian to switch versions on that device. A switch changes only the iframe source. It does not send an answer, change the Patient 360 binding, or rewrite the staff assignment record.
- Existing links created before age-band selection remain usable and open the workbook's existing age chooser.

The age-band query value is routing metadata, not an authorization control. The assignment ID and bearer link token remain the authorization material and are validated by the existing Cloud Run assignment endpoint before any workbook is displayed.

## Assignment-isolated local resume

After the Cloud Run service validates the private assignment, the wrapper derives a one-way SHA-256 resume scope from the opaque assignment ID and its bearer capability. Only that 64-character digest is passed to the workbook, in the iframe URL fragment so it is not sent in the HTTP request or referrer. The iframe receives no patient ID, name, date of birth, assignment token, or other Patient 360 data.

Every age workbook stores answers under `ndwb-v2-<band>-<resume-scope>`. Therefore:

- the same private link in the same browser on the same device resumes that assignment;
- another assignment link derives a different key and cannot load those answers through the workbook UI;
- changing age versions within one allowed assignment retains the same assignment scope while keeping each age version separate;
- public preview pages have no private resume scope and do not persist journal entries;
- the former band-wide `ndwb-<band>` keys are never read or migrated, because their owner cannot be established safely.

Local browser storage is not a substitute for an operating-system account boundary. Someone with administrative access or browser developer tools on the same profile may be able to inspect origin storage. Patient copy therefore recommends a private device or separate browser profile on a shared device. The private assignment link and same browser/device are both required for normal resume behavior, and clearing browser data removes the local journal.

## Privacy and clinical status

The workbook is optional personal journaling/reflection. It is not a formal clinical intake, assessment, diagnosis, or chart entry. Workbook entries use assignment-isolated device-local autosave. Opening the link, switching versions, writing entries, and exporting/printing a PDF do not submit content to BHW.

## Secure PDF return: blocked, not represented as available

Secure online journal/PDF return is not enabled in this change. The current source repository contains the staff assignment UI and the existing JSON response queue, but it does not contain the Cloud Run source that owns content assignments, submissions, and private material storage. The live service does not publish an API contract for journal-file submission. Administrative inspection of the live revision also requires Google Cloud reauthentication.

Without the owning backend source and approved deployment access, this change cannot verify or implement all required protections:

- token-to-assignment and canonical-patient binding on upload;
- PDF signature/content validation, extension and MIME agreement, size/page limits, and active-content rejection;
- malware scanning, quarantine, encrypted object storage, retention/deletion rules, and least-privilege object access;
- explicit voluntary-sharing consent, original filename normalization, content hash, age-band provenance, uploader IP/user-agent handling policy, and immutable audit events;
- a staff-authorized download/review route in Patient Materials & Feedback;
- a workflow state that is review-only and does not automatically write to the legal chart or mark a clinical assessment complete.

The patient and staff pages therefore say that online PDF return is not enabled and direct the patient to contact BHW for a staff-confirmed private return method. No upload input or unsupported network call is rendered.

## Required backend acceptance contract before enabling upload

The owning Cloud Run service must provide a reviewed, source-controlled endpoint that, at minimum:

1. accepts a single PDF only after validating the unexpired, unrevoked assignment token and its canonical patient binding;
2. requires an explicit `consentToShare` affirmation and records the assignment ID, canonical patient ID, selected age band, original assignment creator, receipt time, normalized filename, byte length, SHA-256 hash, scan result, and consent text/version;
3. stores the file in approved private Google Cloud infrastructure with encryption, retention, quarantine, and least-privilege staff access;
4. creates a `Patient Materials & Feedback` review item with `workflowType=charmed_minds_neurodivergence_journal`, never a chart entry or completed assessment;
5. exposes staff download/review only through the existing short-lived staff token and role authorization, and audits view, download, status change, and deletion events;
6. is covered by synthetic-only tests for invalid/expired/revoked tokens, wrong patient binding, duplicate upload, oversized/non-PDF/polyglot/malicious content, missing consent, unauthorized staff access, routing, retention, and audit events.

Only after that service is deployed and validated should the workbook wrapper render an opt-in PDF upload control.
