# Cloud patient roster routing

The Google Cloud Run registry (`GET /v1/patients`) is the authoritative patient roster for CrewOS and provider tools. Netlify Functions access it server-side through `lib/cloud-patients.js` with a five-minute HMAC token; the signing secret is never sent to the browser.

## Cloud-backed roster consumers

- Paperwork, Care Plan Studio, and CrewOS registration search: `patients.js`
- Front desk, fax matching, requests, and document drafting: `frontdesk-data.js`
- Patient Monitor list and detail: `monitor-data.js`
- CrewCare roster: session-gated Cloud-only compatibility endpoint in `console-data.js`; patient-care work opens Health 360 and Patient Requests
- Dialpad/iFax/email triage patient matching: `lib/triage.js`
- New-patient registration: Cloud-first write in `action.js`, followed by transitional operational mirrors
- Care-management logs and monthly imports: Cloud identity resolution with Notion retained as the operational log
- Panel Performance: Cloud identity enrichment with Notion retained for de-identified HEDIS/event records

Provider registry, workflow, transcription, and Health Blueprint already use the same Cloud endpoint through `provider/cloud-queue.mjs`.

All shared CrewOS and Front Desk list labels are composed from the Cloud legal first, middle, legal last, and suffix fields. The BHW Patient ID stays with the display label wherever a staff member chooses a patient. Patient status remains separate from coverage and consent: non-active records stay visible for historical work, while deceased and transferred records are disabled only where staff would otherwise start new care work.

The CRISP/ADT discharge feed remains separate by design. The retired CrewCare patient-page writer cannot append results, recommendations, or care plans to Notion, and Care Plan Studio now saves drafts into the existing BHW Cloud Health Blueprint. Any remaining Notion relation used inside an older operational workflow is migration debt, not an accepted patient source or a second roster; new patient-facing work must use the verified BHW Patient ID and an existing protected Cloud contract.
