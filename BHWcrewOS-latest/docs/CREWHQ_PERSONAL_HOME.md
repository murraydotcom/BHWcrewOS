# CrewHQ personal home

The landing page at `/` and `/hq.html` uses the approved compact layout while retaining the original Montserrat font, atom mark, Black Opal / Light Opal theme blocks, background gradients, colors, and `bhw-theme` preference.

## Identity and data

`GET /.netlify/functions/hq-home` verifies the signed CrewOS session. It accepts no person, role, division, or other query override. Personalized results are never embedded in the public HTML or stored in browser storage. Responses have `Cache-Control: no-store, private`. Signing out, session expiry, changing session identity, and leaving the page clear the rendered personal data.

- **Care-plan replies:** Fresh protected patient-content submissions are checked against existing Operations ownership and protected content-assignment sender metadata. Unreviewed/unclosed responses appear when assigned to the person, relevant to their clinical-review role queue, or tied to an item they sent. Match the assignment's exact `sentBy` staff ID, falling back to `createdBy` only when no sender was recorded; a different recorded sender takes precedence. Sender awareness does not change the review assignment. If sender attribution is incomplete, show known items with an unavailable count rather than a misleading zero. Unprojected material replies use the established clinical-review role queue without creating records or sending notifications. Medication-intake responses are excluded.
- **myBHW:** Reads the existing portal-messaging inbox through its existing identity grants and synthetic-pilot gate. Only individually assigned unread threads are counted. The existing pilot gate is retained; this release does not activate real-patient messaging. Thread bodies, subjects, attachments, and patient details are not projected onto home.
- **Handoffs/referrals:** Reads the existing `crewos` and `health-core` Operations records. Includes exact personal assignments, unassigned role/area-relevant incoming work, and work created by the person for outbound follow-through. A same-name assignment is insufficient. Another person's assignment is excluded unless it is an outgoing item created by the signed-in person. Recently closed work remains reviewable. Links open the original CrewOS request. No parallel queue is created.
- **KPIs:** Reads only work attributed by exact staff identity. Seven-day completion measures require the person to be the recorded completing actor; on-time fractions require actual due and resolution timestamps. No employee targets are invented. Unset targets say so. Role labels use the existing alert-role classifier.
- **Goals/projects:** Reads the existing CrewOS project assignments, matching exact staff identity. Does not create another goals database.

Lists are bounded by their source windows (500 per Operations source, 100 recent patient-content responses, 200 content assignments for sender matching, and the existing portal inbox page). A reached boundary is labeled as recent/window-limited work. Counts are not represented as complete historical performance totals. The page refreshes while visible every two minutes and supports manual refresh.

The session-expiry timer uses the signed session's actual expiry, independently of the refresh interval. A slow poll keeps the existing identity visible while it is in flight; an expired session, changed identity, or failed refresh still clears personal data.

FrontdeskOS phone/SMS/fax/email/general intake is not included in these home notification blocks. The existing Patient Requests tool remains in the searchable directory.

## Navigation

The header and Visits & Care Plans directory link to:

- Health Core: `https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/clinical-access.html`
- Provider 360 resource library: `https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/provider-360.html`

Both retain Health Core's protected access. These links do not transfer a patient or grant clinical authority.

## Verification

Identity/scoping, no cross-person results, front-desk exclusion, fresh reviewed-state removal, existing portal pilot limits, unknown-vs-zero, KPI attribution, assigned project ownership, source-window disclosure, and navigation/palette regression tests are in `test/hq-home.test.js`. Existing directory tests now inspect the extracted `hq-home.mjs` catalog.

Browser verification uses intercepted synthetic home responses only. Actual signed-in production-source verification must be reported separately from deployment and synthetic browser checks.
