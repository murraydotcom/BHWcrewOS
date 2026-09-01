# CrewOS Lab Intelligence synthetic screens

## Delivered views

- `provider/lab-dashboard.html` is the laboratory operational front door. It shows only active work and open loops: critical results, missing or partial results, outside-result verification, and provider review.
- `provider/patient-lab-timeline.html?patient=BHW0000` is a focused Patient 360 laboratory view. It does not replace or duplicate the Patient Dashboard or the general Patient 360 timeline.

## Binding behavior

- The pilot accepts only reserved synthetic patient `BHW0000`.
- The screen reads a local synthetic contract fixture and clearly reports that Firestore is not connected.
- No write, order, approval, patient notification, Health Core publication, Care Connect delivery, or Labcorp transmission is available.
- The directory summary remains 21 authoritative Physical entries, 49 specialty candidates, 8 escalation branches, and 70 total records.
- Complete-template items and additions stay separately counted.
- Original laboratory values, units, reference intervals, source laboratory, method, specimen, dates, report identity, and verification status remain visible.
- Corrected values use a new result identity linked to the prior result. The active view does not delete the original revision.
- Three-timepoint drift is descriptive only and explicitly requires provider interpretation.
- Outside records remain unlinked until two identity evidence types are verified.
- A critical event remains open until provider acknowledgment, clinical assessment, patient action or disposition, and documented provider closure are complete.

## Live integration gate

The screens must not be switched from the synthetic fixture to the Lab Intelligence Cloud Run API until CrewOS has a reviewed MFA-capable provider session exchange, the Firestore pilot is provisioned, and the private `BHW0000` read routes pass end-to-end authorization tests. A CrewOS PIN alone must not be represented as MFA.

## Verification

Run from `BHWcrewOS-latest/`:

```bash
npm test
```

Focused coverage is in `test/lab-intelligence-ui.test.mjs`.
