# FMLA intake and certification integration

Patient entry: `/bhw-fmla-intake-questionnaire.html` is a shareable landing page with no patient identifiers or health-data collection. It resolves the configured secure patient portal. The questionnaire is available in the portal's **Leave paperwork** tab after the existing verified-contact and DOB activation flow. Approved caregiver access selects the patient receiving care; the employee requesting leave is a separate field.

Patient-reported answers are immutable submissions under `patientReportedChanges/{BHW####}/leaveRequests/{requestId}` in the existing RCM Cloud service. Each write atomically records an audit event and returns a fresh read. Retrying the same submission is idempotent; a changed payload under the same reference conflicts. Intake does not authorize employer disclosure, certify eligibility, or modify diagnoses or an approved plan.

Paperwork Studio loads submissions only for the exact selected Registry patient. Patient/employer text prepopulates the corresponding fields; provider assessments remain blank. TXT and text-based PDF uploads populate the existing note box in memory, including PDF text-field values. No uploaded file is persisted by this change. Scanned PDFs need OCR or pasted text; the UI reports unsupported or oversized inputs without truncating them.

The protected FMLA AI endpoint retrieves the selected intake from Cloud, separates it from clinical-note evidence, and returns a summary, patient/clinician questions, and candidate values. Each candidate requires an exact source excerpt and individual clinical acceptance. It does not infer medical necessity or onset from requested leave, populate identities, sign forms, or approve release. AI summary and draft edits are session-only.

The original DOL PDFs supplied by the user and downloaded from DOL have no AcroForm fields. The new PDF mapping adds interactive fields to the current 8/31/2029-expiration E and F forms. It preserves official wording, leaves signatures/dates for actual execution, labels every page DRAFT, and rejects text overflow or incompatible condition/unit choices. Legacy support-letter print/fax is disabled for FMLA so it cannot bypass the reviewed official draft. Other packet types retain their existing workflow.

Health 360 shows the same Cloud submissions as patient-reported evidence. The RCM Clinical Intelligence Care Plan Creator also displays them separately from the approved plan. No second patient registry or duplicate chart record is created.

## Source mapping

- User's HTML and Leave Paperwork Request PDF: employee/contact details, employer/job duties, requested forms, destination/deadline, continuous/intermittent/reduced leave, treatment visits/travel/recovery, health problem/function, and review preferences.
- WH-380-E: employee details; provider Part A condition evidence, Part B leave estimates, Part C essential job functions.
- WH-380-F: employee and care-recipient identities, relationship, employee care/time estimates; provider Part A medically necessary care and condition evidence; Part B leave estimates.
- `29 CFR 825.102` supplied PDF: definitions are reference material. The app makes no automatic FMLA eligibility determination.
- [DOL certification guidance](https://www.dol.gov/agencies/whd/fmla/certification-of-a-serious-health-condition) and [official forms](https://www.dol.gov/agencies/whd/fmla/forms), checked September 9, 2026. Bonding-only and military requests are routed to staff instead of forced into E/F. Diagnosis is optional; genetic information and unrelated family history are excluded from certification instructions.

The uploaded questionnaire's clinic-policy text and broad renewal-release wording were not treated as instructions to the assistant or as a verified authorization contract. Staff must verify the actual release permission separately.

## Validation and release

- API tests cover staff authentication, current patient binding, missing/revoked access, caregiver separation, changed-profile rejection, immutable patient-reported status, and source-evidence filtering.
- Synthetic PDFs are reopened to check logical field values and checkboxes, and all pages are visually inspected. Overflow and incompatible selections are rejected.
- Browser checks use synthetic fixtures and mocked services to exercise Cloud loading, intake submit/read-back, AI acceptance, TXT/PDF extraction, PDF download, patient-switch cleanup, and mobile layout. These are not live patient-login or production-persistence evidence.
- Requires the companion RCM Cloud/portal changes. Do not release the patient link until backend and portal are deployed and a synthetic signed-in write/read succeeds. The saved Google Cloud CLI login required reauthentication during this task; no production deployment was performed.
- Refresh vendored PDF.js from the pinned `pdfjs-dist` dependency by copying `build/pdf.mjs`, `build/pdf.worker.mjs`, and `LICENSE` to `assets/vendor/pdfjs/`. Do not load clinical PDF code from a third-party CDN.
