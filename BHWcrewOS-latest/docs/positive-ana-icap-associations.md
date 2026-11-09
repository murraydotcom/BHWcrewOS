# Positive ANA: ICAP association activation

The clinician worksheet now shows pattern-to-disease associations for AC-0 through AC-31, the associated antigen context, conditional confirmatory-test suggestions, limitations and the official ICAP pattern-page link. Each reported pattern keeps its own titer. This is a clinician reference layer, not a phenotype-weighted differential, disease probability, diagnostic engine or disease-activity score.

## Source and maintenance

`assets/positive-ana-icap.js` contains BHW paraphrases of the International Consensus on ANA Patterns' public Clinical Relevance pages, reviewed November 9, 2026. Each entry records its official source URL, review date and catalog version. AC-30 is distinct from AC-2; AC-31 (formerly AC-4a) is distinct from plain AC-4. Ro60 is not conflated with Ro52. AC-2 alone never excludes autoimmune disease. Rare/low-predictive-value associations are explicitly bounded; no disease is invented for unmapped laboratory wording.

The browser and save endpoint use the same catalog. New saves derive ICAP context server-side; history reads preserve the interpretation saved at the time rather than silently applying newer associations. The saved record, chart transcript and Patient 360 view retain source provenance. Future catalog changes require reviewing the official pattern pages, updating the date/version, regression tests and clinician review before clinical reliance.

## Scope and release

Deploy the normal CrewOS static bundle and Netlify functions together. There is no runtime ICAP activation flag. Reverting this change returns to the previous display; it does not delete saved reviews. No changes to authentication, authorization, assignment expiry/revocation, patient binding, diagnosis creation, orders, prescribing, Care API gates or patient-facing publication are included. No blanket ANA shutdown PR is reopened.

Verify mixed patterns/titers, negative/unknown/conflicting results, DFS70, AC-30/31, copied chart context and authenticated synthetic save/read-back before production acceptance. Unit tests mock Cloud persistence. The optional browser smoke isolates unrelated authentication/UI integrations and blocks external calls: it tests rendering only, not live authentication or production deployment.

```
node --test test/positive-ana-icap.test.mjs test/positive-ana-completeness.test.mjs test/positive-ana-patient-workflow.test.mjs
node scripts/smoke-positive-ana-icap.mjs
```

The browser smoke requires Playwright and its Chromium browser. These checks are implementation verification, not a claim of clinical validation or production activation.
