# Positive ANA clinical release audit — October 26, 2026

**Decision: no clinical activation.** PR #221 is merged and deployed, but neither a staff login, an active Registry patient, a merge, a deployment, nor automated synthetic tests establish approval for real-patient clinical use. This correction is a draft release with an automatic non-production preview, not a claim of production containment.

## Evidence and status

| Item | Verified state |
| --- | --- |
| Original implementation | [CrewOS PR #221](https://github.com/murraydotcom/BHWcrewOS/pull/221), merged as `738f4b7d83c85339b93ddf8b33687f9214c870c3`; current main at inspection |
| Netlify production | Site `defc91af-09d9-40c3-93a7-fd7e7e6eb32d`, published ready deploy `6ade9f9127e92092ed61bbfc`, production context, same merge SHA; published `2026-10-26T00:32:43.671Z` (October 25, 8:32:43 PM Eastern) |
| Original preview | PR discussion identifies preview deploy `6ade9f5b67c8b5077108529d` at head `c898ab40fe0b992acf94967e6853e8d47bcbbd8e` |
| Deployment protection | Netlify reports SSO gating for non-production; production application authentication remains a separate control |
| Patient-record destination | `RCM_CLOUD_API_URL` points to the same RCM API origin in production and deploy-preview configuration; no isolated preview persistence destination established |
| Downstream source | `murraydotcom/bhw-rcm-platform` main `1cce669b3f59c898fed44fe9fccbb40eb682c65c`, `cloud/rcm-api/app.mjs` and `charmed-response.mjs`; source inspected, deployed Cloud Run revision/configuration unverified |
| Original focused tests | Reproduced 20/20 offline on exact merged CrewOS source |
| Original full suite | Reproduced 556/556 on exact merged source after installing declared dependencies |
| Corrected CrewOS | 29/29 focused; 565/565 full suite; Operations API syntax check and changed JavaScript syntax checks passed |
| Corrective preview | Netlify automatically built SSO-protected deploy preview `6adf5f622a60d2c587a234b0` at `d02ac387b61bfeae660b62ed4bcbd4ef21f9e83e`, state ready, deploy-preview context, `published_at: null`; the skip marker did not prevent this build. No signed preview workflow was exercised |
| Remote synthetic CI | CrewOS Positive ANA safety run `40337204820`: success. RCM release boundary run `40337209352`: success; existing RCM synthetic eligibility regression run `40337208906`: success |
| Companion RCM correction | 4 new release-boundary tests, plus existing authentication, questionnaire-capability, and patient-operational-record tests: 30/30 passed offline |
| Live negative checks | Unauthenticated `POST positive-ana-record` with status request returned 401; published Step 5 HTML returned 200 and still contained submission code |
| Clinical approval | No Positive ANA real-patient approval evidence retrieved. No approval inferred or granted. Amaris Murray remains clinical go-live authority |
| Actions during this audit | No real patient queried, no signed production token minted, no Registry/Cloud write, no patient assignment/link/message sent, no prescribing/order/diagnosis/care-plan action, no production deployment/traffic/authentication-policy change; Netlify generated the non-production preview automatically |

The deployment timestamps and commit are from Netlify project/deploy metadata, not inferred from the merge. Environment inspection retained only relevant routing/scope facts; no secrets are recorded here. Live negative probes establish unauthenticated denial, not safety of authenticated production writes. No production patient records or access logs were inspected, so this audit does not establish whether earlier writes occurred.

## Findings in the merged implementation

1. **A missing clinical release gate.** `positive-ana-record.js` accepted a valid HMAC-signed CrewOS staff bearer, without requiring provider role, recent clinical step-up, clinical approval, or an explicit clinician attestation. It then validated an active Registry record, loaded questionnaire history, wrote through BHW Cloud, and performed exact-ID/screening read-back. These were authentication and consistency controls, not release authorization.
2. **BHW0000 and real Registry records were treated in the opposite way to the pilot.** The new endpoint and browser excluded BHW0000 but accepted other four-digit BHW IDs if present in the Registry. An active Registry record does not authorize clinical use. Do not remove the Registry's BHW0000 reservation to fix this mismatch.
3. **BHW9999 was mocked, not reserved.** PR #221's test replaced `getSession`, `cloudRequest`, and `findCloudPatient` in `require.cache`; all BHW9999 records and writes lived in memory. Repository-wide matches are tests and an explicitly offline insurance-bridge verifier. No runtime BHW9999 allowlist or seed was found. This does not prove BHW9999 is absent from the live Registry; a syntactically valid ID is not a safe test identity.
4. **The RCM API is a separate trust boundary.** Its signed-CrewOS bearer verifier accepts a staff identity; `POST /v1/questionnaire-responses` sanitizes content, verifies Registry presence, and saves without a Positive ANA release gate. Calling this API directly with an authorized broad staff token can bypass a CrewOS-only restriction. The companion patch closes the identified route in source.
5. **The worksheet's review marker was not human sign-off.** Normalization forced `clinicianReviewRequired: true` and omitted rankings/workups, but the server did not require a completed clinical review before persistence. The copy and marker alone were not enforcement.
6. **Step 5 was another service.** The worksheet acquired a care token and called content-assignment/submission routes on the medication/care API. The public page used an opaque capability rather than a typed patient ID, which preserves an important identity boundary. Its server implementation, deployed revision, release gate, capability expiry/revocation, and patient isolation were not available in the accessible repository sources. Existing capability behavior remains unverified; browser removal alone cannot revoke or disable that API.
7. **Client-wide history retrieval and stale patient context needed containment.** The worksheet loaded global questionnaire/submission lists and filtered in the browser or proxy. Its selected-patient change handler did not clear already entered findings. The correction removes real-patient selection and all remote Positive ANA history/import transport rather than claiming this was safe for live charts.

## Implemented containment in this proposed correction

- Keep the record endpoint authenticated. Saves, lists, delivery actions, and unspecified actions return 423 before any Cloud operation. No Cloud adapter or live-enable environment switch remains in the endpoint.
- Permit only `synthetic-preview` with the exact string BHW0000, a signed provider session with recent clinical step-up, and explicit `syntheticReviewAttestation: true`. It returns `saved: false`, `destination: none`, forced clinician-review requirement, and `clinicalSignoff: false`. It discards imported patient/prior-record identifiers and computes comparison with no patient history.
- Render an isolated BHW0000 browser fixture. It is not inserted into the Patient Registry. Record-save and delivery controls stay disabled after analysis. The reference content, discrete observations, factual comparison code, and original clinician/source boundaries remain available.
- Remove Step 5 assignment/submission transport and patient message/link generation from the worksheet. The public Step 5 page displays an inactive notice and has no form, script, capability fetch, or submit path.
- Stop the Patient 360 Positive ANA loader from requesting real-patient records; show the locked state.
- Add synthetic safety CI with no credentials or deployment steps.
- In the companion RCM patch, reject identifiable Positive ANA questionnaire payloads before Registry lookup/storage, and withhold existing Positive ANA rows from that generic list without deleting records. Unrelated questionnaire validation and attribution remain covered by regression tests.

These changes narrow access. They do not broaden patient authentication, Registry validation, storage permissions, or record isolation. No production Registry patient is replaced by a fixture. Offline real-format IDs are only adversarial/mocked fixtures, never authorized pilot identities.

## Reconcile the pilot with the Registry

The September clinical-readiness blueprint defines G0 as BHW0000/test data only; later gates require documented PHI, identity, audit, recovery, UAT, and clinical-owner evidence. The October 6 preventive-review verification also distinguishes synthetic acceptance from clinical sign-off and explicitly preserves live locks. Health Core's pilot configuration does not automatically govern the RCM or medication/care APIs.

For this workflow, the safe G0 route is a nonpersistent BHW0000 fixture and source/offline tests. A real Registry ID, including BHW9999, is not a substitute. Patient-linked Registry history, saving, and delivery remain unavailable until their own reviewed release. Do not add a synthetic record to production, permit BHW0000 production writes, alter shared token issuance, or weaken Health Core authentication to make the test pass.

## Remaining release work — not completed by this source audit

1. Review and release the CrewOS and companion RCM containment changes together; record exact deployed SHAs/revisions and rollback versions. This audit leaves main and production deployments unchanged; the automatic non-production preview is recorded above.
2. Locate the medication/care API source and authenticated deployment evidence. Independently deny `positive_ana_step5` assignment/open/submission/sent paths while unapproved; verify existing capabilities cannot submit through another viewer or a direct API call. Revocation or record inspection requires the appropriate authenticated operational procedure, not a browser-only assumption.
3. Inspect sanitized Cloud Run metadata for the RCM and medication/care services: revision/image, traffic, storage project, IAM/application auth, scopes, origins, feature gates, logs, and rollback. No authenticated Cloud Run administration was available here.
4. Verify containment with synthetic-only deployed tests and keep real-patient writes, delivery, prescribing, orders, diagnoses, and care-plan changes off. A 401 by itself is insufficient.
5. Before any later clinical release, separately implement explicit provider review/attribution, server-side exact-patient reads/provenance validation, signed patient context, cohort authorization, conflict/idempotency controls, cross-patient tests, recovery evidence, and named clinical-owner signoff. No automatic clinical decisions are authorized.

**Approval record:** technical synthetic regression only. Human clinical UAT: not performed. Real-patient clinical approval: not established. Corrective production deployment: not performed. Automatic non-production preview: verified as ready, not clinically accepted.

## Reviewable corrections

- [CrewOS draft PR #222](https://github.com/murraydotcom/BHWcrewOS/pull/222) — endpoint, browser, Patient 360, Step 5 page, regression tests, and this audit.
- [RCM draft PR #153](https://github.com/murraydotcom/bhw-rcm-platform/pull/153) — independent questionnaire persistence boundary and tests.

Both remain unmerged. The verified preview SHA is the initial corrective code commit; later documentation-only commits do not imply a newly accepted clinical release.
