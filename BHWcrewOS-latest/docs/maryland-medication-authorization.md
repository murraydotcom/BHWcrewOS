# Maryland medication authorization in Paperwork Studio

Extends `bhw-paperwork.html` with Maryland Asthma and Medication Authorization packet choices. The general medication panel selects child care or school. All outputs are unsigned, editable drafts with a required instruction attachment; signatures, guardian consent, competency approval, staff receipt and administration logs are never generated.

## Sources checked September 15, 2026

- [MSDE Office of Child Care licensing directory](https://earlychildhood.marylandpublicschools.org/child-care-providers/licensing/licensing-forms): OCC 1216A asthma action plan and OCC 1216 medication authorization, September 2022 editions, currently linked by MSDE. The asthma download misleadingly contains `seizure` in its filename; its title and directory entry identify OCC 1216A. Preserve all three asthma pages and both medication pages.
- [Maryland school form](https://www.marylandpublicschools.org/about/Documents/DSFSS/SSSP/SHS/SHSGuidelines/MedicationAdministrationForm_Fillable_a.pdf): separate school-year authorization, one medication per form.
- [NHLBI asthma clinician guide](https://www.nhlbi.nih.gov/sites/default/files/publications/Asthma%20Clinicians%20Guide%20508_02-03-21.pdf): controller/reliever distinction and individualized SMART considerations. [GINA 2026 report landing page](https://ginasthma.org/2026-gina-strategy-report/) is linked for clinician review; this feature does not automate GINA treatment-step selection.
- Product-specific DailyMed links and review date are embedded in `maryland-medication-core.mjs` and visible in the panel. Rules cover albuterol HFA 90 mcg, albuterol 2.5 mg/3 mL, budesonide 0.5 mg/2 mL suspension, and cetirizine 1 mg/mL. No universal drug-dose validation is claimed.

## Prefill and clinical review

Name/DOB and available medication/allergy context come from the selected protected Cloud Registry record. A specific, unambiguous J45.2/3/4/5 code can prefill chart-recorded severity for reassessment. Free-text medications are not parsed into invented doses. Structured chart medication fields can prefill an individualized order, with independent prescriber dose verification still required.

Age is calculated on authorization start. Product eligibility, weight/date, prior asthma therapy and zone determine available dose options. A 90-day weight limit is a conservative workflow rule for nebulizer dosing, not a Maryland statutory requirement. Documented personal-best peak flow generates contiguous integer zones; absent peak flow stays absent. Standard escalation language is a reviewable draft. Diagnosis, controller choice, off-label regimens, emergency medication doses, consent and signatures require clinical decisions.

Export checks the live authenticated Registry again and rejects changed identity/snapshot, a patient switch or any intervening edit. There are no new PHI endpoints, external AI calls or Cloud writes. Draft state remains in memory; closing the page loses it. Switching packet types preserves same-patient draft content, while selecting another patient or disconnecting clears it. The app warns before closing an edited draft.

## Official PDF handling

The official source PDFs contain duplicate field names and shared annotation structures. `scripts/prepare-maryland-forms.py` creates clean printed templates plus a widget-coordinate manifest, retaining the original downloads. Export creates uniquely named, canonical editable fields; no field can be attached to multiple pages. Long values reference the mandatory attachment, which retains full values. Signature and administration areas remain blank.

## Validation

- Nine focused tests cover age/weight/date boundaries, controller versus reliever restrictions, pediatric liquid volumes, missing and conflicting source data, peak-flow boundaries, review requirements, individualized prescriptions, distinct PDF rows and page annotations.
- Synthetic browser test covers integrated patient selection, dose choice, reviewed PDF download, review invalidation, packet switching, mobile overflow, patient clearing and under-age blocking.
- Reopen exported PDFs with pypdf and compare canonical field values, page widgets and appearance streams; render all pages and inspect before release.
- Broader suite has two existing failures in unchanged Registry/Clinical Map assertions. These do not arise from this feature. See PR validation results for the final counts.

## Release boundary

Local implementation and synthetic validation do not establish signed-in production readiness or clinical approval. Review the complete official PDF and attachment before signatures and delivery. Automatic rules are decision support for listed products; all other drugs and individualized regimens need a documented prescription and independent dose verification.
