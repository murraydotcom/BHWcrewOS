# BHW Quality Evidence Contract v1

## Purpose

This contract defines the boundary between **BHW Health Core**, the **BHW Quality Command Center**, and **CrewOS quality operations**. It exists so BHW can build population-health and MIPS/MVP readiness once, without later rebuilding clinical data structures around CMS reporting.

The contract is intentionally reporting-path neutral. The same evidence model should support internal quality management, Traditional MIPS, a future MIPS Value Pathway such as M0005, payer quality programs, and future value-based contracts.

## System ownership

| System | Owns |
| --- | --- |
| **Health Core** | Clinical truth, patient identity, clinical evidence, provenance, provider reconciliation, longitudinal clinical state |
| **Quality Command Center** | Read-only quality projections, measure status, aggregate rates, eligibility/readiness monitoring, evidence gaps |
| **CrewOS** | Outreach, scheduling, evidence chasing, task ownership, escalation, completion workflow |
| **Care Connect** | Patient-facing education, requests, reminders, and approved patient-visible status |
| **CMS/QPP** | Official MIPS eligibility, measure specifications, benchmarks, case minimums, attribution, scoring, registration, submission, payment adjustment |

The Quality Command Center must never become a second clinical chart.

## Core design rules

1. **Patient identity is canonical.** Every quality record resolves to the verified BHW patient identifier before it can influence a patient-level quality projection.
2. **Clinical evidence remains in Health Core.** The Command Center may display a projection or evidence reference, but it does not rewrite the clinical fact.
3. **Every quality conclusion is traceable.** A numerator, denominator, exclusion, exception, or unresolved status must retain provenance.
4. **External data is not automatically truth.** CRISP, claims, registries, outside records, and future HIE feeds must pass through the reconciliation rules of the owning clinical domain.
5. **Operational tasks are separate from clinical evidence.** CrewOS may create an outreach or follow-up task from a verified quality gap, but closing a task does not by itself close the clinical quality gap.
6. **No autonomous orders or referrals.** A quality gap may generate a suggestion or work item. Clinical orders/referrals retain their existing authorization rules.
7. **No invented CMS score.** Raw BHW performance rates remain distinct from official CMS points and final scores.
8. **Version everything that can change.** Measure definitions, source mappings, evidence rules, scoring references, and reporting-year configuration must be versioned.
9. **Fail closed on ambiguity.** Conflicting identity, dates, measure versions, or evidence states remain unresolved until reviewed.
10. **Read-only by default.** The Quality Command Center consumes verified clinical projections. Writes back to Health Core require a separate explicitly authorized clinical workflow.

## Proposed Health Core quality projection

A future protected endpoint should expose a quality projection rather than exposing arbitrary chart content.

Suggested shape:

```http
GET /v1/quality/summary?performanceYear=2026
Authorization: Bearer <authorized clinical/staff token>
Cache-Control: no-store
```

Suggested aggregate response:

```json
{
  "schemaVersion": "bhw.quality-summary.v1",
  "performanceYear": 2026,
  "generatedAt": "2026-09-22T00:00:00Z",
  "measureSetVersion": "qpp-2026-reviewed-v1",
  "measures": [
    {
      "measureId": "112",
      "eligibleDenominator": 0,
      "numerator": 0,
      "exclusions": 0,
      "unresolved": 0,
      "rawPerformanceRate": null,
      "evidenceComplete": false
    }
  ],
  "careGapCounts": {
    "outreach": 0,
    "order": 0,
    "appointment": 0,
    "provider-review": 0,
    "external-evidence": 0,
    "documentation": 0
  }
}
```

This aggregate endpoint should contain no patient names or other display PHI.

## Proposed patient-level gap projection

Authorized users need a separate detail endpoint to work actual gaps:

```http
GET /v1/quality/gaps?performanceYear=2026&measureId=112&status=open
```

Each returned gap should minimally contain:

```json
{
  "gapId": "stable-id",
  "bhwPatientId": "BHW####",
  "measureId": "112",
  "performanceYear": 2026,
  "measureVersion": "qpp-2026-reviewed-v1",
  "gapState": "open",
  "recommendedOperationalAction": "outreach",
  "evidenceState": "missing-qualifying-evidence",
  "lastEvaluatedAt": "ISO-8601",
  "evidenceRefs": ["evidence-id"],
  "provenanceComplete": true
}
```

Patient names should be resolved from the protected Patient Registry only when the authorized UI needs to display them. Do not duplicate names into quality evidence records solely for convenience.

## Quality evidence record

Each clinical fact used by a measure should be representable as a quality evidence record or a stable reference to a Health Core record.

Minimum fields:

| Field | Purpose |
| --- | --- |
| `evidenceId` | Stable unique evidence identifier |
| `bhwPatientId` | Canonical BHW patient identity |
| `measureId` | Quality measure using the evidence |
| `performanceYear` | Reporting year |
| `measureVersion` | Exact ruleset/specification version evaluated |
| `evidenceRole` | denominator, numerator, exclusion, exception, supporting, unresolved |
| `sourceDomain` | problems, labs, vitals, preventive, screening, encounter, claims, HIE, etc. |
| `sourceRecordId` | Stable Health Core/source identifier |
| `sourceSystem` | Health Core, CRISP, CMS claims, etc. |
| `effectiveAt` | Clinical date/time that matters to the measure |
| `observedAt` | When BHW received/observed the evidence |
| `verificationState` | provider-approved, source-verified, needs-review, rejected |
| `providerReviewed` | Whether provider review is required/completed |
| `provenance` | Source reference, import/reconciliation metadata, version/hash as applicable |
| `supersedes` | Prior evidence record when corrected/replaced |
| `createdAt` / `updatedAt` | Audit timing |

Evidence should be append/version based when correction history matters. Do not silently overwrite the provenance chain.

## Initial 2026 source mapping

### Q001 — Diabetes: Glycemic Status Assessment Greater Than 9%

Health Core sources:
- verified diabetes problem/diagnosis context;
- qualifying glycemic laboratory result;
- encounter/eligibility context as required by the reviewed specification;
- claims only where the official collection method permits it.

Potential operations:
- lab order review;
- appointment;
- provider review;
- documentation/evidence reconciliation.

### Q112 — Breast Cancer Screening

Health Core sources:
- Preventive Services record;
- provider-reviewed CRISP Population Explorer evidence;
- qualifying imaging result/document;
- claims where permitted.

Potential operations:
- outreach;
- screening order;
- scheduling;
- external evidence retrieval;
- documentation reconciliation.

### Q134 — Depression Screening and Follow-Up Plan

Health Core sources:
- qualifying encounter;
- standardized screening instrument/result;
- positive-screen state;
- required documented follow-up plan.

Potential operations:
- appointment;
- provider review;
- follow-up documentation.

A positive screening result without the required follow-up evidence must not be counted as complete merely because the screening was performed.

### Q236 — Controlling High Blood Pressure

Health Core sources:
- verified hypertension problem/diagnosis context;
- qualifying blood-pressure observations;
- encounter context.

Potential operations:
- outreach;
- appointment;
- provider review;
- documentation.

The measure engine must apply the reviewed measure-specific rule for which BP observation qualifies; it should not simply select the numerically lowest BP.

## Care-gap lifecycle

Recommended operational states:

```text
detected
  -> needs-review        (if evidence is ambiguous)
  -> open                (verified actionable gap)
  -> working             (CrewOS follow-through underway)
  -> pending-clinical    (needs visit/order/provider decision)
  -> pending-external    (waiting for outside evidence)
  -> resolved            (clinical evidence now satisfies the gap)
  -> excluded            (verified exclusion/exception)
```

A task completion and a gap resolution are different events.

Example:

```text
Mammogram gap detected
  -> CrewOS outreach task opened
  -> patient schedules imaging
  -> task may be "completed"
  -> quality gap remains open
  -> qualifying mammogram result arrives and is reconciled
  -> Health Core evidence updates
  -> quality engine reevaluates
  -> quality gap resolves
```

## Operational task contract

When a verified gap needs non-clinical follow-through, the Quality Command Center may request a CrewOS work item containing:

- stable gap ID;
- BHW patient ID;
- measure ID;
- action type;
- reason code;
- due date;
- owning team/role;
- escalation state;
- source quality-evaluation timestamp.

The CrewOS task should not contain unnecessary clinical detail. The staff member should open the authorized clinical context when clinical detail is needed.

## Re-evaluation triggers

The quality engine should re-evaluate a patient when relevant evidence changes, including:

- new or corrected lab result;
- new vital sign;
- problem-list verification;
- preventive evidence import/reconciliation;
- screening result;
- follow-up plan documentation;
- encounter completion;
- outside record reconciliation;
- relevant claim ingestion;
- measure-ruleset version change.

A scheduled full-panel reconciliation should also run so missed event triggers do not create silent gaps.

## Audit and provenance

The system should be able to answer:

- Why was this patient in the denominator?
- Which evidence put the patient in or out of the numerator?
- Which exclusion or exception was applied?
- Which version of the measure logic was used?
- Which source supplied each fact?
- Was outside evidence provider-reviewed?
- When did the quality state change?
- What work was initiated because of the gap?
- Who resolved the operational work?
- What clinical evidence ultimately resolved the gap?

## Security boundary

- All patient-level quality routes require authenticated, role-appropriate access.
- Patient-level responses use `Cache-Control: no-store`.
- Logs should use hashed/pseudonymous patient references where feasible rather than raw identifiers.
- No PHI belongs in browser localStorage.
- Browser localStorage is appropriate only for non-PHI planning settings such as QPP checkpoints, interoperability readiness checkboxes, or aggregate manual counts.
- Aggregate dashboards should expose the least patient information necessary.
- Exports containing patient-level data require explicit authorization and auditing.

## MIPS / MVP boundary

For 2026 BHW is currently **opt-in eligible**, not required to report, and has **Small Practice** special status. The Command Center therefore:

- keeps Traditional MIPS in shadow mode;
- tracks M0005 as future-readiness architecture, not as a current registration;
- treats Promoting Interoperability as automatically reweighted for the current small-practice status;
- does not generate an official CMS final score;
- does not register an MVP;
- does not elect formal MIPS opt-in;
- does not submit data to CMS.

If QPP eligibility changes, the program configuration can change without changing the underlying clinical evidence model.

## Implementation sequence

1. Keep current QPP configuration and measure engine versioned.
2. Implement the protected aggregate Health Core quality summary.
3. Implement patient-level quality evidence evaluation for one measure at a time.
4. Start with Q112 because reviewed CRISP preventive evidence already enters Health Core.
5. Add Q236 from verified problems + vitals.
6. Add Q134 from encounter + screening + follow-up-plan evidence.
7. Add Q001 from verified diabetes context + glycemic lab evidence.
8. Connect verified gaps to CrewOS operational tasks.
9. Add scheduled panel reconciliation and evidence-change triggers.
10. Add validated CMS measure-specification/version governance before any submission capability is considered.

## Release rule

No measure moves from "shadow" to "submission capable" until BHW has validated:

- official current measure specification;
- collection type;
- denominator/numerator/exclusion/exception logic;
- data-completeness requirements;
- case minimum;
- benchmark/scoring source if applicable;
- evidence provenance;
- synthetic tests;
- representative chart review;
- role/access controls;
- audit logging;
- CMS reporting-path eligibility.

The safest long-term architecture is: **clinical work creates structured evidence once; quality logic reads that evidence; operations close actionable gaps; reporting becomes an output rather than extra charting.**
