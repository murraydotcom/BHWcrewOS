# CrewHQ personal home

The landing page at `/` and `/hq.html` uses the approved compact layout while retaining the original Montserrat font, atom mark, Black Opal / Light Opal theme blocks, background gradients, colors, and `bhw-theme` preference.

## Identity and data

`GET /.netlify/functions/hq-home` verifies the signed CrewOS session. It accepts no person, role, division, or other query override. Personalized results are never embedded in the public HTML or stored in browser storage. Responses have `Cache-Control: no-store, private`. Signing out, session expiry, changing session identity, and leaving the page clear the rendered personal data.

- **Care-plan replies:** Fresh protected patient-content submissions are checked against existing Operations ownership. Only unreviewed/unclosed responses assigned to the person or relevant to their established clinical-review role queue appear. Unprojected material replies use the same clinical-review role queue as the existing content projection, without creating a record or sending a notification. Medication-intake responses are excluded from this block. A source failure is unavailable, not zero.
- **myBHW:** Reads the existing portal-messaging inbox through its existing identity grants and synthetic-pilot gate. Only individually assigned unread threads are counted. The existing pilot gate is retained; this release does not activate real-patient messaging. Thread bodies, subjects, attachments, and patient details are not projected onto home.
- **Handoffs/referrals:** Reads the existing `crewos` and `health-core` Operations records. Includes exact personal assignments, unassigned role/area-relevant incoming work, and work created by the person for outbound follow-through. A same-name assignment is insufficient. Another person's assignment is excluded unless it is an outgoing item created by the signed-in person. Recently closed work remains reviewable. Links open the original CrewOS request. No parallel queue is created.
- **KPIs:** Reads only work attributed by exact staff identity. Seven-day completion measures require the person to be the recorded completing actor; on-time fractions require actual due and resolution timestamps. No employee targets are invented. Unset targets say so. Role labels use the existing alert-role classifier.
- **Goals/projects:** Reads the existing CrewOS project assignments, matching exact staff identity. Does not create another goals database.

Lists are bounded by their source windows (500 per Operations source, 100 recent patient-content responses, and the existing portal inbox page). A reached boundary is labeled as recent/window-limited work. Counts are not represented as complete historical performance totals. The page refreshes while visible every two minutes and supports manual refresh.

FrontdeskOS phone/SMS/fax/email/general intake is not included in these home notification blocks. The existing Patient Requests tool remains in the searchable directory.

## Navigation

The header and Visits & Care Plans directory link to:

- Health Core: `https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/clinical-access.html`
- Provider 360 resource library: `https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/provider-360.html`

Both retain Health Core's protected access. These links do not transfer a patient or grant clinical authority.

## Verification

Identity/scoping, no cross-person results, front-desk exclusion, fresh reviewed-state removal, existing portal pilot limits, unknown-vs-zero, KPI attribution, assigned project ownership, source-window disclosure, and navigation/palette regression tests are in `test/hq-home.test.js`. Existing directory tests now inspect the extracted `hq-home.mjs` catalog.

Browser verification uses intercepted synthetic home responses only. Actual signed-in production-source verification must be reported separately from deployment and synthetic browser checks.
