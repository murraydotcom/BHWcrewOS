# CrewOS laboratory operations boundary

## Delivered views

`provider/lab-dashboard.html` is the CrewOS operational front door for laboratory work. It contains queues and assignments only: critical-result closure, missing or partial results, outside-result verification, and provider review.

`provider/lab-result-queues.html?patient=BHW0000` is the dedicated operational reconciliation workspace for critical, missing, and partial result work. It shows minimum-necessary assignment, role, priority, due time, proposed SLA status, escalation level, workflow checkpoints, closure state, and an opaque Health Core reference.

The patient laboratory timeline was removed from CrewOS. Results, reports, correction lineage, trends, interpretations, justifications, orders, and Personal Health Blueprint source records belong to the Health Core EHR.

## Binding behavior

- CrewOS is the operational system, not the EHR and not a second patient database.
- The pilot accepts only reserved synthetic patient `BHW0000`.
- The fixture contains operational work items and opaque Health Core record references, but no clinical result payload.
- Critical, missing, and partial work remain separate queue types with separately computed counts.
- Every work item requires an owner/team, required role, due time, escalation state, closure contract, and allowed operational actions.
- The critical queue cannot be ready for CrewOS closure until Health Core confirms provider acknowledgment, clinical assessment, patient action or disposition, and documented provider closure.
- Missing and partial queues cannot be ready for closure until the corresponding Health Core resolution signal and CrewOS follow-up checkpoints are complete.
- SLA targets in the fixture are synthetic proposals and are not approved production policies.
- Directory counts remain 21 authoritative Physical entries, 49 specialty candidates, 8 escalation branches, and 70 total records.
- Complete-template items and additions remain separately counted.
- Queue links cannot open Health Core until an MFA-capable provider session and end-to-end authorization path are approved.
- No assignment, escalation, closure, write, order, approval, patient notification, Care Connect delivery, or Labcorp transmission is available.
- CrewOS does not retain test identities, values, units, reference intervals, methods, specimens, report content, assessments, diagnoses, or patient dispositions in these queue records.

## Ownership map

- Health Core EHR: canonical clinical facts, laboratory results and reports, timelines, trends, corrections, interpretations, orders, and care plans.
- CrewOS: work queues, assignment, escalation, follow-up, and operational Patient 360 synthesis.
- Care Connect: approved patient-facing explanations and Personal Health Blueprint delivery.

## Verification

Run from `BHWcrewOS-latest/`:

```bash
npm test
```

Focused coverage is in `test/lab-intelligence-ui.test.mjs`.
