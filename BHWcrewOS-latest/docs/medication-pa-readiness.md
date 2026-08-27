# Medication prior-authorization readiness in Clinical Intelligence

The 24-Hour Encounter Operations page prepares a medication prior-authorization handoff when a reviewed encounter contains a new medication, restart, dose change, switch, or explicit coverage problem. It does **not** declare that prior authorization is required.

## Workflow

1. Clinical Intelligence identifies a new or changed medication from the structured encounter packet.
2. It creates a **Medication PA readiness + staff handoff** task and assigns it to **MA / Front Desk**.
3. The generated draft carries forward exact encounter evidence for common questions: request details, diagnosis/indication, symptoms and functional impact, prior therapies and response, allergies/contraindications, objective findings, quantity/duration, and clinical rationale.
4. High-frequency medication groups add review prompts for information commonly requested for GLP-1/incretin, ADHD, antipsychotic, migraine, and insomnia medications. These prompts are readiness aids, not payer coverage criteria.
5. Missing answers stay visibly marked for the prescribing clinician. Staff must not infer them.
6. After the clinician reviews and completes the draft, **Ready for MA/front desk** makes the handoff explicit. The MA/front desk verifies the live pharmacy benefit and formulary, documents whether PA is required, and completes payer-specific questions.
7. Documentation can close after the Charm draft is verified while the encounter remains **Orders/forms pending**. It closes fully when the downstream tasks are complete.

## Guardrails

- The payer/PBM response is authoritative. Static rules and medication names never prove that PA is required.
- Continue/refill language by itself does not create a new medication PA task. Explicit coverage language still does.
- The draft uses only documented encounter content and reviewed patient-registry context. Unanswered questions remain blank.
- The staff handoff cannot change the prescription or clinical rationale.
- A patient-specific formulary or real-time prescription-benefit connection is still required to determine coverage before prescribing.

## Standards path

The future live pharmacy-benefit connection should use the approved trading partner or EHR/PBM network for NCPDP Formulary & Benefit, Real-Time Prescription Benefit, and SCRIPT electronic prior-authorization transactions. The Clinical Intelligence packet is the clinical-answer source for that downstream workflow; it is not a substitute for it.
