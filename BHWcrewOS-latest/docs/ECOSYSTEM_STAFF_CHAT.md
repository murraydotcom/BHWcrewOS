# Staff Chat and Patient Requests Team Notes

## Boundaries

One staff messaging backend runs within the existing Google Operations service and Firestore database. No parallel patient queue, patient list, SMS transport, Notion store, or RCM workflow is created. WelcomeToBHW remains HR-only. Each host retains its existing access gate. Chat uses an approved CrewOS staff identity; access to one host does not imply access to the others.

Patient-specific coordination stays in Patient Requests → Team Notes. General staff chat is not for patient details, confidential personnel records, emergencies or the legal medical record. Text is plain-text rendered; no attachments or patient-context scraping. Neither channel triggers patient SMS or Google Chat messages.

## User experience

- Floating Staff Chat button on 40 CrewOS staff shells, RCM/Clinical Intelligence through their common auth gate, signed-in WelcomeToBHW through its app shell, and protected Health Core HTML through its server gate.
- Public pages, patient-facing pages, downloaded/offline documents and nested frames do not receive a launcher. Additional standalone staff apps must install the same adapter; this is not an operating-system chat overlay.
- BHW Team shared room plus one-to-one conversations. Coworkers appear after their first verified chat session; this is an identity projection, not a replacement staff roster.
- CrewOS popup sign-in when necessary. Tokens stay within the CrewHQ origin; parents receive only open/close/visibility and badge-count messages. No tokens, names, message bodies or clinical context cross the frame boundary.
- Messages, read markers, notification preference and conversation identity survive navigation. Unsent drafts stay only in memory; save before leaving.
- Unread badge is off by default and opt-in per account. No sound, toast, browser push permission or background delivery after closing the browser. Polling is roughly 12 seconds while open and 45 seconds while collapsed; paused in hidden tabs. This is not instantaneous real-time or emergency paging.
- Saved to BHW Cloud is shown after server read-back. It does not mean the recipient has read the message. Mark read is explicit.

## Configuration and release gates

Cloud Run Operations: `STAFF_CHAT_ENABLED=true` after synthetic verification. Reuses `CREWOS_OPERATIONS_TOKEN_SECRET`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE` and existing exact `ALLOWED_ORIGINS`. Missing identity/configuration fails closed. No new SMS, OAuth or Google Chat credential is required for this internal chat.

Health Core: `EHR_STAFF_CHAT_ENABLED=true` **and** existing `EHR_REQUIRE_IAP=true`. Keep all patient enrollment, clinical-session and clinical release gates unchanged. Only the chat-enabled HTML response permits a CrewHQ frame and the popup sign-in; the original staff authorization remains mandatory.

CrewHQ function `staff-chat-shell.mjs` serves `/staff-chat` with a restrictive frame-ancestor allowlist. Additional verified HTTPS staff origins may be added with `STAFF_CHAT_FRAME_ORIGINS` (comma-separated, exact origins; no wildcard). Default known hosts: RCM, WelcomeToBHW and protected Health Core. Existing Operations config/token functions remain the sole token bridge. Other hosts contain local copies of `staff-chat-launcher.js` and `.css`; keep these files identical.

Firestore collections: `staffChatRooms` (messages subcollection), `staffChatMembers` (room/read/rate-limit subcollections), existing metadata-only `auditEvents`. Only the backend service account accesses these collections; no browser Firestore SDK/rule widening. Direct conversations enforce membership on list/read/write/read-marker operations. Thirty sends per minute per author, 2,000 characters per message. Deterministic IDs reject changed-content replays. Current UI shows 100 recently active direct conversations and a directory of up to 500 activated staff; this is an explicit bounded initial implementation.

Team Notes retains its existing collections. Add, do not replace, one composite index in the existing named database: `patientRequestTeamNotes`, `requestId ASC`, `createdAt DESC`. Wait for READY before releasing the page. History is cursor-paginated, concurrent saves preserve note summaries, an author's own reply cannot hide unread messages, and ambiguous-save retries retain their original send key.

## Verification

Only synthetic actors and BHW0000 are used. `test/staff-chat.test.mjs` and `test/team-notes-repository.test.mjs` exercise real repository code with a strict transactional memory double, not a Firestore emulator. `scripts/verify-staff-chat-browser.mjs` exercises the HTTP backend and real browser UI with all production hosts intercepted locally, including cross-site popup sign-in, persistence, duplicate-send recovery, direct-message visibility and desktop/mobile rendering. It makes no production requests.

Focused workflow tests include refill, referral, prior authorization, billing/RCM and general request transitions. Existing production messaging gates remain untouched. Real Google deployment and Firestore verification are separate release evidence, not implied by local tests.

## Release order / rollback

1. Build Operations image, inspect actual 100%-serving revision, stage with zero traffic and preserve its full configuration. Do not accidentally inherit a newer unrelated preview's feature gates.
2. Add the Team Notes index; verify synthetic-only requests and chat on the tagged revision. Do not write into an active shared room for smoke tests.
3. Promote only the verified revision, then publish CrewHQ. Publish the RCM/HR adapters after the central service is available. Stage and verify Health Core separately with all clinical gates preserved.
4. Confirm unauthenticated requests still fail, signed-in synthetic read-back succeeds, navigation works, and no patient SMS or Google Chat was generated.

Rollback: restore each site's previous deployment and the captured serving Cloud Run revision. `STAFF_CHAT_ENABLED=false` disables chat API routes; `EHR_STAFF_CHAT_ENABLED=false` removes the Health Core launcher. Keep stored messages and notes intact. Do not delete/recreate queues, patient collections, secrets, staff accounts or audit history.
