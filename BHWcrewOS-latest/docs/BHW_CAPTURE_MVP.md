# BHW Capture — Phase 3 protected Clinical routing

Phone-first, installable capture surface for non-PHI BHW thinking plus patient-linked clinical drafts routed to the protected 24-hour documentation workflow.

## Safety boundary

**Non-clinical modes remain NON-PHI ONLY.** Patient information is permitted only after the user enters Clinical and completes step-up authentication.

- Every active, verified CrewOS staff account may request Clinical access; the signed-in identity, role, and access level remain attached to the server-side audit path.
- Clinical requires re-entering the CrewOS PIN and uses a 15-minute in-memory session plus five-minute clinical cloud tokens.
- Non-clinical audio uses the bounded Netlify/OpenAI transcription function. Clinical audio uses the existing consent-gated Google Cloud Speech-to-Text service.
- After successful transcription, raw audio is discarded by default.
- A user may explicitly keep one recording in the current device's IndexedDB cache. Device-only audio is never included in the cloud payload or JSON export.
- Clinical never permits device-audio retention, browser live speech recognition, IndexedDB storage, offline fallback, or JSON export.
- A Clinical save creates an encounter packet containing the transcript and a separate transcript-free protected Memory reference.
- Direct browser/mobile Firestore access remains denied. The browser uses the CrewOS session exchange and the existing Cloud Run API.

## Source of truth and offline behavior

Firestore-backed BHW Memory is the source of truth for non-clinical captures. IndexedDB remains their offline cache:

1. A save is committed to IndexedDB immediately with `pending` status.
2. The app exchanges `sessionStorage['crewos_token']` for the existing five-minute CrewHQ cloud token.
3. Pending text memories are upserted to `/v1/memories/:id` and then refreshed from `/v1/memories`.
4. Remote content wins when the cache is refreshed. An explicitly retained device audio blob is preserved only in that device's cache.
5. Delete creates a cloud tombstone, so the memory disappears on every synchronized device.
6. Network/auth failures leave the local record available with a visible retry state. Reconnect, focus, Memory-tab open, and the Retry control trigger another attempt.

Existing IndexedDB text captures are backfilled automatically on the first authenticated sync. Legacy audio-only captures cannot be uploaded because BHW Memory intentionally rejects raw audio and requires a transcript; those remain marked `device only` until text is added or they are removed.

Clinical drafts bypass this entire cache. They remain in the current page only until the protected Cloud Run API confirms encounter creation. Protected Memory references are loaded into page memory after Clinical reauthentication and are removed from the DOM when the clinical session locks.

## Authentication

Capture requires the existing CrewOS staff sign-in before its local cache opens. The browser sends the signed CrewOS session to the Netlify authentication function, which verifies the HMAC signature and expiration before returning the staff identity. Capture displays the verified name and role and provides an explicit sign-out control.

The local six-digit cache PIN and five-minute background auto-lock remain as a second, device-level quick unlock. The local PIN does not establish staff identity and never replaces CrewOS authentication.

When no valid CrewOS session is available, Capture links to `/crewos?next=/bhw-capture.html`. CrewOS signs the user in and returns to Capture in the same browsing context. The Cloud Run service continues to isolate memories by the authenticated CrewOS subject.

Selecting Clinical requires the same staff member to re-enter their CrewOS PIN. The server rechecks that the account is active and issues a 15-minute `scope=clinical` token. The token is held only in JavaScript memory. Cloud Run rejects Capture-specific patient, consent, transcription, save, and reference endpoints unless the exchanged five-minute token carries this clinical scope and a recent authentication time.

## Cloud contract

The coordinated Cloud Run change is maintained in `murraydotcom/bhw-rcm-platform` and extends the existing `bhw-rcm-cloud` service:

- `GET /v1/memories`
- `PUT /v1/memories/:id`
- `DELETE /v1/memories/:id`
- `GET /v1/capture-clinical/config`
- `GET /v1/capture-clinical/patients`
- `GET /v1/capture-clinical/patients/:id/recording-consent`
- `POST /v1/capture-clinical/transcriptions`
- `POST /v1/capture-clinical`
- `GET /v1/capture-clinical/references`

Firestore placement is `bhwMemories/{ownerHash}/items/{memoryHash}` in the existing named database. Creates, updates, and deletes write metadata-only audit events. Deleted documents retain only a tombstone, not the transcript or structured content.

Clinical transcripts live only in the protected `encounters` collection used by 24-Hour Documentation. Transcript-free user references live under `bhwClinicalReferences/{ownerHash}/items/{referenceHash}` and are audited with the staff subject, role/access context, and encounter ID without placing a patient identifier in the audit event.

## Configuration

No new Netlify secret is required when the existing CrewHQ cloud path is already configured:

- `RCM_CLOUD_API_URL` — existing HTTPS Cloud Run base URL.
- `CREWHQ_CLOUD_TOKEN_SECRET` — existing shared token-exchange secret in Netlify and Cloud Run.
- `SESSION_SECRET` — existing CrewOS session signing secret.
- `OPENAI_API_KEY` — existing transcription key.
- `OPENAI_TRANSCRIBE_MODEL` — optional; defaults to `gpt-4o-mini-transcribe`.
- `BHW_CAPTURE_CLINICAL_ENABLED` — set to `true` in Cloud Run only after the protected-path go-live review.
- `REAL_PATIENT_TRANSCRIPTION_ENABLED` — must also be `true` before Clinical permits real-patient audio.

The Cloud Run service continues to use its existing `GOOGLE_CLOUD_PROJECT` and `FIRESTORE_DATABASE` settings. Add the production Capture origin and the current deploy-preview origin to Cloud Run `ALLOWED_ORIGINS` before live browser sync testing.

## Files

- `bhw-capture.html` — phone-first UI, local PIN, sync/retry state, and device-audio opt-in.
- `bhw-capture.js` — capture, transcription, organization, IndexedDB cache, automatic migration, and sync orchestration.
- `bhw-capture-auth.mjs` — CrewOS return URL, server-verified staff session, and sign-out behavior.
- `bhw-capture-clinical.mjs` — in-memory Clinical reauthentication, scoped token exchange, patient/consent reads, transcription, encounter save, and reference reads.
- `bhw-capture-sync.mjs` — testable CrewOS/Cloud Run client and cloud-safe memory serializers.
- `netlify/functions/bhw-capture-transcribe.js` — bounded, in-memory non-PHI OpenAI transcription proxy.
- `bhw-capture.webmanifest` and `bhw-capture-sw.js` — installable shell; the service worker does not intercept application requests.

## Synthetic smoke test

1. Open `/bhw-capture.html` over HTTPS. Confirm Capture requires **Sign in with CrewOS** before showing the local PIN.
2. Complete CrewOS login and confirm Capture returns, displays the verified staff name/role, and then requests the local PIN.
3. Confirm the non-PHI boundary remains visible and Clinical opens only after the signed-in staff member re-enters their CrewOS PIN.
4. Create a typed synthetic entry containing `PREVENT-ND`, `IgA`, and `need to research`.
5. Save and confirm the card moves from `pending sync` to `synced`.
6. Open the same URL in another authorized browser/device, sign into the same CrewOS identity, and confirm the entry downloads.
7. Disable the network, save another synthetic entry, and confirm the offline/pending state.
8. Restore the network or press Retry and confirm it becomes synced.
9. Record synthetic speech with **Keep this recording on this device only** unchecked. Confirm transcription/organization appear and the status says raw audio was discarded.
10. Repeat with the checkbox selected. Confirm a `device audio` badge appears locally and the memory on the other device has no audio.
11. Delete a synced entry and confirm it disappears after sync on the other device.
12. Confirm JSON export contains text metadata and `hasDeviceAudio`, but never an audio payload.
13. Sign out and confirm Capture returns to CrewOS sign-in without deleting the device cache.
14. With approved synthetic patient data, unlock Clinical and confirm the picker returns only patient name and BHW ID.
15. Confirm recording remains blocked until signed consent is current and the current-session agreement is checked.
16. Save a synthetic typed Clinical draft and confirm it appears in 24-Hour Documentation plus a protected Memory reference.
17. Confirm the clinical transcript does not appear in `/v1/memories`, IndexedDB, local fallback storage, service-worker caches, or the JSON export.
18. Wait 15 minutes or background the app for more than five minutes. Confirm patient options and Clinical references disappear and the PIN is required again.

## Production storage-path verification

Use synthetic data for the first deployed trace; do not place a real patient's information in deployment logs or screenshots.

1. Confirm the deployed Cloud Run revision points to the intended Google Cloud project and named `FIRESTORE_DATABASE`, and that `BHW_CAPTURE_CLINICAL_ENABLED=true`. Leave `REAL_PATIENT_TRANSCRIPTION_ENABLED=false` for the typed-only trace.
2. Reauthenticate into Clinical and save one uniquely titled typed draft against an approved synthetic patient. Record the returned `encounterId` and Capture ID from the authenticated response.
3. Open 24-Hour Documentation and confirm the new `visit_complete` encounter appears and its 12/20/24-hour clock starts from the capture timestamp.
4. In an authorized Google Cloud administrative view, confirm the full transcript exists only in `encounters/{sha256(encounterId)}` inside the configured named Firestore database.
5. Confirm the user's card exists at `bhwClinicalReferences/{sha256("crew:" + staffId)}/items/{sha256(captureId)}` and contains the encounter link and metadata, but no transcript or audio fields.
6. Confirm no matching Clinical item exists under `bhwMemories`, IndexedDB, the text fallback in local storage, service-worker caches, or the JSON export.
7. Confirm a metadata-only `bhw-clinical-reference.created` audit event exists and does not contain patient name, transcript, or audio.
8. Lock Clinical and confirm patient choices, references, and encounter details are hidden until the CrewOS PIN is re-entered.

## Clinical mode

Clinical is available to every active, verified CrewOS staff account because all current staff see patients. The individual staff identity and role remain recorded for audit, but role is not an additional access gate. Real-patient recording still fails closed unless the patient exists, signed recording/AI-transcription consent is current, current-session agreement is confirmed, and both clinical feature flags are enabled.

