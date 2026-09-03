# Cloud patient roster routing

The protected Google Cloud Patient Registry (`GET /v1/patients`) is the one authoritative roster for CrewOS, Front Desk OS, RCM, and provider tools. CharmHealth remains the legal medical-record identity source; an assigned `BHW####` identifier takes priority. CrewOS never creates, renumbers, or mirrors that permanent ID.

## Current patient-linked consumers

- Patient Registry, Patient 360, paperwork, Care Plan Studio, and registration search
- Front Desk lookup, Patient Requests, referral documents, Dialpad, iFax, and Gmail matching
- Care-management logs, monthly imports, Panel Performance, prevention, and care gaps
- CharmEd assessments, programs, screeners, and questionnaire responses
- Annual Wellness Visits and program care plans
- CRISP/ADT event board and active CEND roster export
- Patient Monitor, CrewCare compatibility view, Health Blueprint, and patient portal

Every active caller uses the canonical Cloud `bhwPatientId`. No normal patient response exposes or accepts an old Notion page ID. Shared phone or email values are not treated as unique identity; ambiguous contacts remain unmatched for staff review. Deceased, transferred, and prospective records may remain visible for history, but cannot start new care work.

New patients are created as protected prospective records with a temporary `TMP-...` ID. They receive their permanent `BHW####` only after CharmHealth enrollment, and the protected promotion workflow then updates the Cloud record.

## Historical migration

The admin-only Cloud migration page can read the retired databases solely to relocate historical patient-linked records. It runs a sealed preview first, lists blocked identity matches, refuses a section with blockers, requires the exact approval phrase, suppresses patient notifications, and reports success only after Cloud read-back verifies every written record.

Retired Notion databases are historical migration sources, not operational patient lists or save destinations. Non-patient reference data such as the specialist directory, staffing, rooms, schedules, and referral templates can be migrated separately without changing patient identity authority.
