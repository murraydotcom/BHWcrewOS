# BHW Whole-Person Clinical Map bridge

## Naming and responsibility

The richer PSCM workspace is formally named **BHW Whole-Person Clinical Map**.

Staff shorthand: **Clinical Map**

Subtitle: **PSCM longitudinal synthesis, body-system mapping, and feasible care planning**

The applications remain separate because they serve different clinical functions:

- **BHW Health Core** is the canonical clinical record and authorization ledger.
- **BHW Whole-Person Clinical Map** is the longitudinal synthesis and clinical reasoning environment.
- **CrewOS** owns operational execution, queues, scheduling, outreach, and follow-through.
- **Care Connect** receives only provider-approved, patient-safe information.

## Existing URLs

The existing `patient-360*.html` URLs are retained for backward compatibility. Their displayed application name changes to Whole-Person Clinical Map.

The eight views remain:

1. Overview
2. Body-System Atlas
3. Clinical Timeline
4. PSCM Mechanism Map
5. Context & Exposures
6. Current Snapshot & Plan
7. Clinical Data
8. Sources & Provenance

## Connected clinical backbone

The Clinical Map continues to use the protected CrewHQ cloud client and its Health Core-backed resources. The bridge verifies read access to:

- canonical Health Core record;
- Body-System Atlas workspace;
- longitudinal clinical events;
- signed or provider-approved visit documentation; and
- Nutrition Intelligence.

It also provides direct links to the exact Health Core surfaces for:

- Chart Summary;
- Encounter Documentation;
- Labs & Diagnostics;
- Orders & Justifications; and
- Care Plans & Blueprints.

The Clinical Map does not create a second problem list, medication list, result repository, order, justification, signed note, or Blueprint.

## Source and provenance rules

Clinical Map content must preserve:

- BHW patient identity;
- encounter association;
- source system and source record identity;
- clinical status;
- verification or approval status;
- version or revision;
- responsible clinician; and
- source freshness.

Body markers, timeline entries, mechanism statements, and care priorities should resolve to an exact source record whenever the source exists.

## Current release boundary

This bridge is restricted to reserved synthetic patient `BHW0000`.

It is read-only and does not call any Atlas, clinical-event, Nutrition Intelligence, order, encounter, or Blueprint write action.

Real-patient cross-application navigation must not place PHI or a durable patient identifier in a cross-domain URL. That later release requires an opaque, short-lived, signed, treatment-purpose handoff context with role authorization, expiration, revocation, and audit logging.

## Deliberate order boundary

Orders and medical-necessity justifications remain exclusively owned by Health Core. The Clinical Map links to the exact Health Core order package rather than storing or independently editing a copy.

## Next bridge phase

After the synthetic connection matrix is validated, the next phase should add:

- opaque Health Core-to-Clinical Map session handoff;
- exact source links from body markers and clinical timeline entries;
- approved Clinical Map summaries projected back into Health Core;
- CrewOS task creation from provider-approved feasible-plan actions; and
- Care Connect publication only from provider-approved patient-safe artifacts.
