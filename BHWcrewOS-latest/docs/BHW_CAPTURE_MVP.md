# BHW Capture MVP

Phone-first, installable capture surface for non-PHI BHW thinking and work notes.

## Current safety boundary

**NON-PHI ONLY.** Do not record patients, patient names, identifiers, or clinical encounters in this MVP.

Why:
- text and audio are stored in IndexedDB on the current device/browser;
- the optional browser live-transcription feature may use the browser/device vendor speech service;
- no audited HIPAA-grade server transcription/storage pipeline is connected yet.

The Clinical capture mode is visibly locked in the UI.

## MVP features

- installable PWA shell (`bhw-capture.webmanifest` + minimal service worker)
- local six-digit app PIN
- phone microphone recording via `MediaRecorder`
- optional browser live speech-to-text with typed/paste fallback
- Brain Dump, Research, Operations, Teaching, and Content modes
- deterministic local organization into title, project, tags, summary, and action candidates
- project detection for PSCM, PREVENT-ND, CharmEd Minds, Mind & Mood, Flow, EduMedia, and BHW Operations
- local IndexedDB storage for text and audio
- searchable Memory library with project filters
- audio playback from saved entries
- JSON export of text/metadata (audio intentionally excluded)
- local delete / clear controls
- five-minute background auto-lock

## Files

- `bhw-capture.html` — phone-first UI
- `bhw-capture.js` — local capture, organization, IndexedDB, search, and PWA behavior
- `bhw-capture.webmanifest` — install metadata
- `bhw-capture-sw.js` — install/activate only; does not intercept CrewOS requests
- `assets/bhw-capture-icon.svg` — app icon

## Android smoke test

1. Open `/bhw-capture.html` over HTTPS in Chrome on Android.
2. Create a six-digit local PIN; lock and confirm the PIN reopens the app.
3. Deny microphone permission and confirm typed capture still saves.
4. Allow microphone permission and record 10-20 seconds of **synthetic/non-PHI** speech.
5. Stop recording; confirm the status shows a local KB size.
6. Save; open Memory; confirm an `audio` badge appears.
7. Open the entry and play the audio.
8. Create a typed capture containing `PSCM`, `IgA`, and `need to research`; preview organization and confirm project/tag/action extraction.
9. Search `IgA`; confirm the entry is returned.
10. Background the app for more than five minutes and return; confirm the local lock screen appears.
11. Use Export and confirm the JSON contains text/metadata but no audio blob.
12. Confirm Clinical mode cannot be selected.
13. If Chrome offers Install, install it and relaunch from the home screen.

## Phase 2: HIPAA-grade cloud path

Do not unlock Clinical mode until all of the following are implemented and verified:

1. BHW-authenticated upload endpoint (prefer existing Google Cloud / Cloud Run identity path).
2. BAA-covered object storage with retention and lifecycle controls.
3. BAA-covered speech-to-text service.
4. Structured AI processing endpoint with BHW-approved model/provider configuration.
5. Firestore memory objects with staff/role authorization and audit events.
6. Consent state for encounter recording.
7. Explicit patient/clinical retention policy and deletion workflow.
8. CrewOS task handoff and project-memory synchronization.
9. Synthetic-data security test and logging review.
10. Written go-live approval before the Clinical mode flag is enabled.
