# Medication prior-authorization workbench in Clinical Intelligence

The 24-Hour Encounter Operations page prepares and tracks a medication prior authorization when a reviewed encounter contains a new medication, restart, dose change, switch, or explicit coverage problem. It does **not** declare that prior authorization is required until staff record a patient-specific response from an authorized external source.

## Workflow

1. Clinical Intelligence identifies a new or changed medication from the structured encounter packet.
2. It creates a structured medication PA case and a **Medication PA readiness + staff handoff** task assigned to **MA / Front Desk**.
3. The case carries forward exact encounter evidence for common questions: request details, diagnosis/indication, symptoms and functional impact, prior therapies and response, allergies/contraindications, objective findings, quantity/duration, and clinical rationale.
4. High-frequency medication groups add review prompts for information commonly requested for GLP-1/incretin, ADHD, antipsychotic, migraine, and insomnia medications. These prompts are readiness aids, not payer coverage criteria.
5. Exact questions obtained from a payer portal, fax, call, or other authorized source can be pasted one per line. Clinical Intelligence turns them into answer fields and suggests an answer only when it can map that question to already documented encounter evidence. The provider must verify each suggestion.
6. Missing answers stay visibly marked for the prescribing clinician. The case cannot move to **Ready for MA / front desk** until every provider question is answered or marked not applicable and the provider attests to the packet.
7. The MA/front desk records the payer and line of business, pharmacy-benefit identifiers, the benefit-check source, restrictions, and whether PA is confirmed as required or not required.
8. If PA is required, staff submit through the currently authorized external path (CharmHealth, Surescripts portal, CoverMyMeds, payer/PBM portal, fax, or phone) and record the confirmation/reference, submission time, next action, follow-up, and decision.
9. Open and overdue PA work appears in the encounter queue. The medication task remains open while a case is ready, submitted, pending, denied, or under appeal. It completes only after approval, an externally confirmed no-PA-required result, or a documented closed outcome.
10. Documentation can close after the Charm draft is verified while the encounter remains **Orders/forms pending**. It closes fully when downstream tasks are complete.

## Included payer catalog

The payer selector distinguishes the plans BHW identified as current priorities: Maryland Medicaid, Maryland Physicians Care, CareFirst Community/Medicare Advantage/commercial, Alterwood, UnitedHealthcare Medicaid/Medicare/commercial, Humana Medicare/commercial, Cigna, Aetna Medicare/commercial, Medicare plans not yet identified, and Carelon/CarelonRx as a benefit administrator. Plan name, member ID, BIN, PCN, Rx group, Medicare contract ID, and PBP ID remain encounter-specific fields.

## Guardrails

- The payer/PBM or pharmacy response for the patient's current benefit is authoritative. Static rules, medication names, and dated formularies never prove that PA is required.
- Continue/refill language by itself does not create a new medication PA task. Explicit coverage language still does.
- Suggested answers use only documented encounter content and reviewed patient-registry context. Unanswered questions remain blank.
- The staff handoff cannot change the prescription or clinical rationale.
- A staff member cannot record **PA required — externally confirmed** or **No PA required — externally confirmed** based only on a dated formulary clue.
- Submitted, pending, approved, denied, or appeal stages require an external submission method, time, and confirmation/reference; a decision time is also required for approval or denial.
- The case history records stage changes, and edited provider answers survive subsequent encounter-intelligence refreshes.

## Standards path

The workbench stores payer identity, clinical answers, exact payer questions, evidence, submission metadata, status, and follow-up independently of any single vendor. A future approved connector can map this record to NCPDP Formulary & Benefit, Real-Time Prescription Benefit, and SCRIPT electronic prior-authorization transactions through Surescripts, CoverMyMeds, the EHR, or another approved trading partner. Until that certified connection is active, submission and status updates remain supervised manual steps, and the workbench never represents them as automated.
