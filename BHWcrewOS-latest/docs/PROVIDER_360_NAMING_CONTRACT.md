# BHW Provider 360 naming contract

## Canonical name

The provider-facing whole-person clinical workspace formerly called **PSCM Complex Patient Navigator** and later **BHW Whole-Person Clinical Map** is now canonically named:

# **BHW Provider 360**

Staff shorthand: **Provider 360**

Subtitle: **PSCM longitudinal synthesis, body-system mapping, and feasible care planning**

The former names are historical aliases only. New user-facing labels, documentation, training, navigation, and launch controls must use **Provider 360**.

## Product structure

Provider 360 is the clinician-facing umbrella workspace. It has two related entry states:

1. **Provider 360 Home** — a non-patient-specific resource and workspace home for clinical references, the AM Physiologic Intelligence Atlas, source review, and shortcuts.
2. **Provider 360 patient workspace** — the patient-specific PSCM synthesis containing the Overview, Body-System Atlas, Clinical Timeline, PSCM Mechanism Map, Context & Exposures, Current Snapshot & Plan, Clinical Data, and Sources & Provenance.

These are not separate products and must not be presented as competing “360” applications.

## System boundaries

- **BHW Health Core** remains the canonical clinical record and authorization ledger.
- **Health Core Chart Summary** remains the concise EHR patient overview; it is not renamed Provider 360.
- **BHW Provider 360** is the richer longitudinal synthesis and clinical reasoning environment.
- **Body-System Atlas** remains a section of Provider 360 and a separately addressable view.
- **Patient Registry** remains the authoritative front door for selecting a real patient and issuing treatment-purpose context.
- **Patient Operations / Patient Worklist** remains the CrewOS execution workspace.
- **Care Connect** receives only provider-approved, patient-safe information.

## Compatibility contract

Existing technical routes and identifiers remain stable until a separately governed migration:

- `patient-360*.html` routes remain valid;
- the Operations API destination key `clinical-map` remains valid;
- the read scope `clinical-map.read` remains valid;
- existing saved links and synthetic `BHW0000` paths remain valid; and
- internal module filenames containing `clinical-map` or `patient-360` remain compatibility identifiers, not display names.

Compatibility identifiers must never be used to infer a second product. Their user-facing label is **Provider 360**.

## Standard interface language

Use:

- **Open Provider 360**
- **Provider 360 Home**
- **Provider 360 patient workspace**
- **Provider 360 provides synthesis**
- **Return to Provider 360**
- **Provider 360 last reviewed**

Do not introduce new user-facing uses of:

- Complex Patient Navigator
- Whole-Person Clinical Map
- Clinical Map
- Patient 360, except where referring to a historical artifact or compatibility route

## Connected-data rule

Provider 360 may display and synthesize Health Core-backed problems, medications, results, orders, interpretations, Atlas entries, clinical events, Nutrition Intelligence, and approved care plans. It must not maintain an independently authoritative copy of those records.

Every patient-specific Provider 360 launch must preserve the selected patient, staff identity and role, treatment purpose, source provenance, version, approval state, and expiration/audit boundary established by Patient Registry and Health Core.
