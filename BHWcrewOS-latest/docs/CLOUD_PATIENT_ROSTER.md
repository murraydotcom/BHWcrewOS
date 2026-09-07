# Cloud patient roster routing

The Google Cloud Run registry (`GET /v1/patients`) is the authoritative patient roster for CrewOS and provider tools. Netlify Functions access it server-side through `lib/cloud-patients.js` with a five-minute HMAC token; the signing secret is never sent to the browser.

## Cloud-backed roster consumers

- Paperwork, Care Plan Studio, and CrewOS registration search: `patients.js`
- Front desk, fax matching, requests, and document drafting: `frontdesk-data.js`
- Patient Monitor list and detail: `monitor-data.js`
- CrewCare portal roster and care-plan resolution: `console-data.js`
- Dialpad/iFax/email triage patient matching: `lib/triage.js`
- New-patient registration: Cloud-first write in `action.js`, followed by transitional operational mirrors
- Care-management logs and monthly imports: Cloud identity resolution with Notion retained as the operational log
- Panel Performance: Cloud identity enrichment with Notion retained for de-identified HEDIS/event records

Provider registry, workflow, transcription, and Health Blueprint already use the same Cloud endpoint through `provider/cloud-queue.mjs`.

All shared CrewOS and Front Desk list labels are composed from the Cloud legal first, middle, legal last, and suffix fields. The BHW Patient ID stays with the display label wherever a staff member chooses a patient. Patient status remains separate from coverage and consent: non-active records stay visible for historical work, while deceased and transferred records are disabled only where staff would otherwise start new care work.

The CRISP/ADT discharge feed remains separate by design. Notion queue, care-log, patient-page, and quality-event records may retain imported source IDs for relationship compatibility, but they are not alternate patient rosters.
