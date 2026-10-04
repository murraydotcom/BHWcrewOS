# Provider 360 → Patient 360 naming contract

## Canonical hierarchy

**Provider 360** is the provider environment and home. It is not the name of every patient-specific screen.

**Patient 360** is the selected-patient longitudinal workspace inside Provider 360.

**Health Core Clinical Access** is the current-visit and current-day clinical workflow. Health Core remains the canonical clinical record and authorization ledger.

The provider-facing longitudinal workspace formerly called **PSCM Complex Patient Navigator** and later **BHW Whole-Person Clinical Map** is now canonically named:

# **BHW Patient 360**

Staff shorthand: **Patient 360**

Subtitle: **PSCM longitudinal synthesis, body-system mapping, and feasible care planning**

## Target entry workflow

1. Provider 360 opens the provider environment.
2. Patient Registry selects and verifies the patient, assigned BHW provider, and enrolled programs.
3. Staff chooses Patient 360, Health Core Clinical Access, Patient Operations, or an enrolled program lens after those Registry controls are implemented.
4. Patient 360 defaults to All Care and can filter to Primary Care, Flow, Mind & Mood Recovery, CharmEd Minds, or chronic care.
5. Health Core handles the current encounter, documentation, orders, results, and approvals.
6. Patient Operations handles follow-through; Care Connect receives approved patient-safe outputs.

There is no Trauma program label in this hierarchy.

## System boundaries

- **Provider 360** is the provider environment and navigation home.
- **Patient 360** is the selected-patient history, progress, connected body views, laboratory context, snapshots, and longitudinal plan.
- **Health Core Clinical Access** is the current encounter and canonical clinical record.
- **Body-System Atlas** is a Patient 360 view and remains separately addressable.
- **Patient Registry** is the authoritative front door for selecting a real patient and issuing treatment-purpose context.
- **Patient Operations / Patient Worklist** is the CrewOS execution workspace for assignments, due dates, waiting states, outreach, and closure.
- **Care Connect** receives only provider-approved, patient-safe information.

Tests and follow-up are not a competing chart. Clinical orders, results, interpretation, and documentation remain in Health Core; the operational work required to complete them appears in Patient Operations; the longitudinal effect appears in Patient 360 after source-backed read-back.

## Compatibility contract

Existing technical routes and identifiers remain stable until a separately governed migration:

- `patient-360*.html` routes remain valid;
- the Operations API destination key `clinical-map` remains valid;
- the read scope `clinical-map.read` remains valid;
- existing saved links and synthetic `BHW0000` paths remain valid; and
- internal module filenames containing `clinical-map`, `patient-360`, or `provider-360-naming` remain compatibility identifiers, not competing display names.

Their user-facing patient-workspace label is **Patient 360**.

## Standard interface language

Use:

- **Provider 360 Home**
- **Open Patient 360**
- **Patient 360**
- **Return to Patient 360**
- **Patient 360 last reviewed**
- **Open Health Core Clinical Access**
- **Open Patient Operations**

Do not introduce new user-facing uses of:

- Complex Patient Navigator
- Whole-Person Clinical Map
- Clinical Map
- Provider 360 as the name of a selected-patient longitudinal view
- Trauma as a program label

## Connected-data rule

Patient 360 may display and synthesize Health Core-backed problems, medications, results, orders, interpretations, Atlas entries, clinical events, Nutrition Intelligence, approved care plans, and patient-facing snapshots. It must not maintain an independently authoritative copy of those records.

Every patient-specific Patient 360 launch must preserve the selected patient, staff identity and role, treatment purpose, source provenance, version, approval state, and expiration/audit boundary established by Patient Registry and Health Core.
