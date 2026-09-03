# Patient data authority and migration map

## Authority

| Data | Authoritative system | Patient key |
|---|---|---|
| Legal medical-record identity and permanent assignment | CharmHealth | `BHW####` |
| Shared operational patient roster | Protected Google Cloud Patient Registry | Canonical `bhwPatientId` |
| New patient before CharmHealth enrollment | Protected Google Cloud prospective registry | Temporary `TMP-...` |
| Patient communications and work queue | Google Operations Patient Requests | Canonical `bhwPatientId`, or explicitly unmatched |
| Health Blueprint, AWV, care programs, care logs, quality, and CRISP events | Protected RCM Google Cloud API | Canonical `bhwPatientId` |

There is no CrewOS Patient Index fallback and no second patient master list. A normal patient lookup never accepts a Notion record ID.

## Retired sources covered by the protected migration

The one-time migration preview inventories historical referrals, handoffs, Patient Requests, care logs and minutes, annual wellness visits, CharmEd assessments and programs, Porter House plans and census details, prevention and care-gap records, Panel profiles and events, questionnaires and screeners, and the CRISP ADT archive.

Identity resolution is fail-closed. It accepts an exact canonical BHW ID, an exact unique legal-name-plus-DOB match, a unique member ID or MRN, or a previously verified source relationship. Conflicting names, dates of birth, reused IDs, shared contacts, missing patients, and ambiguous matches are blocked for human review.

## Apply rules

1. Run the protected preview while signed in as an administrator.
2. Review every blocked row; do not guess an identity.
3. Apply only a section with zero source errors and zero blockers.
4. Type `APPLY APPROVED CLOUD MIGRATION` exactly.
5. Treat a section as saved only when the page reports `Saved to BHW Cloud`, a timestamp, and a read-back count equal to the written count.
6. Keep the legacy source read-only until reconciliation is complete.

Notion may still hold non-patient operational reference material. That is a separate content migration and does not make it a patient roster or patient workflow store.
