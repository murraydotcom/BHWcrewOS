# BHW Capture — Phase 2 non-PHI memory sync

Phone-first, installable capture surface for non-PHI BHW thinking and work notes.

## Safety boundary

**NON-PHI ONLY.** Do not record patients, patient names, identifiers, or clinical encounters.

- Clinical mode remains visibly locked.
- Recorded audio is sent in memory through the bounded Netlify/OpenAI transcription function.
- After successful transcription, raw audio is discarded by default.
- A user may explicitly keep one recording in the current device's IndexedDB cache. Device-only audio is never included in the cloud payload or JSON export.
- Firestore stores only the transcript, title, project, tags, summary, actions, timestamps, capture source, and device metadata.
- Direct browser/mobile Firestore access remains denied. The browser uses the CrewOS session exchange and the existing Cloud Run API.

## Source of truth and offline behavior

Firestore-backed BHW Memory is the source of truth. IndexedDB remains the offline cache:

1. A save is committed to IndexedDB immediately with `pending` status.
2. The app exchanges `sessionStorage['crewos_token']` for the existing five-minute CrewHQ cloud token.
3. Pending text memories are upserted to `/v1/memories/:id` and then refreshed from `/v1/memories`.
4. Remote content wins when the cache is refreshed. An explicitly retained device audio blob is preserved only in that device's cache.
5. Delete creates a cloud tombstone, so the memory disappears on every synchronized device.
6. Network/auth failures leave the local record available with a visible retry state. Reconnect, focus, Memory-tab open, and the Retry control trigger another attempt.

Existing IndexedDB text captures are backfilled automatically on the first authenticated sync. Legacy audio-only captures cannot be uploaded because BHW Memory intentionally rejects raw audio and requires a transcript; those remain marked `device only` until text is added or they are removed.

## Authentication

Capture preserves its local six-digit cache PIN and background auto-lock. Cloud access is separate and requires a valid CrewOS session.

When no CrewOS session is available, the sync bar links to `/crewos?next=/bhw-capture.html`. CrewOS signs the user in and returns to Capture in the same browsing context so the session token remains server-verifiable. The Cloud Run service isolates memories by the authenticated CrewOS subject.

## Cloud contract

The coordinated Cloud Run change is maintained in `murraydotcom/bhw-rcm-platform` and extends the existing `bhw-rcm-cloud` service:

- `GET /v1/memories`
- `PUT /v1/memories/:id`
- `DELETE /v1/memories/:id`

Firestore placement is `bhwMemories/{ownerHash}/items/{memoryHash}` in the existing named database. Creates, updates, and deletes write metadata-only audit events. Deleted documents retain only a tombstone, not the transcript or structured content.

## Configuration

No new Netlify secret is required when the existing CrewHQ cloud path is already configured:

- `RCM_CLOUD_API_URL` — existing HTTPS Cloud Run base URL.
- `CREWHQ_CLOUD_TOKEN_SECRET` — existing shared token-exchange secret in Netlify and Cloud Run.
- `SESSION_SECRET` — existing CrewOS session signing secret.
- `OPENAI_API_KEY` — existing transcription key.
- `OPENAI_TRANSCRIBE_MODEL` — optional; defaults to `gpt-4o-mini-transcribe`.

The Cloud Run service continues to use its existing `GOOGLE_CLOUD_PROJECT` and `FIRESTORE_DATABASE` settings. Add the production Capture origin and the current deploy-preview origin to Cloud Run `ALLOWED_ORIGINS` before live browser sync testing.

## Files

- `bhw-capture.html` — phone-first UI, local PIN, sync/retry state, and device-audio opt-in.
- `bhw-capture.js` — capture, transcription, organization, IndexedDB cache, automatic migration, and sync orchestration.
- `bhw-capture-sync.mjs` — testable CrewOS/Cloud Run client and cloud-safe memory serializers.
- `netlify/functions/bhw-capture-transcribe.js` — bounded, in-memory non-PHI OpenAI transcription proxy.
- `bhw-capture.webmanifest` and `bhw-capture-sw.js` — installable shell; the service worker does not intercept application requests.

## Synthetic smoke test

1. Open `/bhw-capture.html` over HTTPS and unlock the local PIN.
2. Confirm the non-PHI warning and locked Clinical mode remain visible.
3. If prompted, use **Sign in** in the sync bar, complete CrewOS login, and confirm Capture reopens.
4. Create a typed synthetic entry containing `PREVENT-ND`, `IgA`, and `need to research`.
5. Save and confirm the card moves from `pending sync` to `synced`.
6. Open the same URL in another authorized browser/device, sign into the same CrewOS identity, and confirm the entry downloads.
7. Disable the network, save another synthetic entry, and confirm the offline/pending state.
8. Restore the network or press Retry and confirm it becomes synced.
9. Record synthetic speech with **Keep this recording on this device only** unchecked. Confirm transcription/organization appear and the status says raw audio was discarded.
10. Repeat with the checkbox selected. Confirm a `device audio` badge appears locally and the memory on the other device has no audio.
11. Delete a synced entry and confirm it disappears after sync on the other device.
12. Confirm JSON export contains text metadata and `hasDeviceAudio`, but never an audio payload.

## Clinical mode

Phase 2 does not unlock Clinical capture. Real-patient use still requires the approved consent, BAA-covered transcription/storage, role authorization, retention/deletion, audit, and written go-live path already defined for BHW clinical systems.
