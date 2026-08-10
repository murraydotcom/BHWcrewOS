# Patient data map & reconciliation plan

_Audit finding, Aug 2026. "Patient Master linking" is currently split across
several different Notion databases. This documents what each function reads/writes
and recommends how to consolidate. No behavior was changed by adding this file._

## The databases in play

| # | Notion DB (title) | ID / how it's referenced | What it is | Read/written by |
|---|---|---|---|---|
| 1 | **Patient Index — Ops Hub** | `DB.patients` = `f9a0291f…` (collection `c85c5213…`) | Lean operational index: Patient Name, BHW ID (auto), DOB, Insurance, Member ID, Medicare MBI, Status, Active Divisions, Medications | `patients.js` (Paperwork/Care Plan picker), `action.js` (create/read patients), `stedi.js`, `ops-data.js` |
| 2 | **🧑🏽‍⚕️ Patients Master List** _(authoritative)_ | `process.env.MASTER_DB_ID`, DB id `2cf580758d3080f0825de4bbfb6c7528` (collection `2cf58075-8d30-8047-8de2-000b66c30acb`) | Richer record: Patient Page (Health Hub link), Phone, Payer, Medicaid MCO, MRN, Insurance Member ID, Patient Ctl No (BHW####), Program Enrollment, program statuses, Last/Next Visit, Diagnoses (relation)… | `frontdesk-data.js`, `console-data.js`, `lib/triage.js` (→ `dialpad-events`, `ifax-events`, `email-ingest`), **`patients.js` picker (as of this branch)** |
| 3 | **Panel Patients** | `process.env.PATIENTS_DB_ID` = `7bd06869…` (collection `1763826f…`) | De-identified HEDIS / utilization tracker, keyed by **MRN / Initials** (no PHI). Care-gap columns (A1c, BP, AWV, screenings…) | `panel-data.js` |
| 4 | **CharmEd Minds Intake & Assessment** | `2c658075…` | Pediatric neurodev **assessment cases**. Target of the `?case=` relation | Screener + Questionnaire `Patient` relation (via `screener-submit.js` / `questionnaire-submit.js`) |
| — | **Patient Request Triage Queue** | `process.env.QUEUE_DB_ID` (default `de790690…`) | Front Desk OS inbox (not a patient list) | `frontdesk-data.js`, `lib/triage.js` |

## Why this is a problem

- **The picker and Front Desk look at different lists.** A patient created through
  crewOS (`action.js` → **#1 Patient Index**) does **not** appear in Front Desk,
  triage, or inbound-comms matching (**#2 Master List**), and vice-versa. Phone
  matching for inbound SMS/fax only searches #2.
- **`?case=` links point at #4, not a patient master.** The screener's `Patient`
  relation (and now the questionnaire's, added for consistency) targets the
  **CharmEd assessment** DB. That's correct for CharmEd intake, but it means a
  submitted AWV-HRA or Porter questionnaire has no relation to the operational
  patient record even when we know who they are.
- **The picker silently drops fields.** `patients.js` reads `CharmHealth Chart #`
  and ICD/Diagnoses properties that **don't exist** on #1 (Patient Index), so the
  Paperwork/Care Plan picker always returns a blank chart # and no diagnoses.

## Decision (confirmed by ops)

**The Patients Master List (#2) is the authoritative patient DB.**

### Done on this branch
- **Picker repointed.** `patients.js` (the Paperwork / Care Plan patient picker,
  read-only) now reads the Master List via `MASTER_DB_ID`, so staff pick from the
  same roster Front Desk uses. Field mapping: `Patient Ctl No`→bhwId, `Payer` /
  `Insurance Plan Name`→insurance, `Insurance Member ID`→memberId, `MRN`→chart.
- **`Medicare MBI` text field added** to the Patients Master List (so Stedi can be
  repointed later without breaking eligibility).
- **`action.js patient-create` now DUAL-WRITES.** A new patient is created in the
  **Master List** (authoritative — Patient Name, Patient Ctl No `BHW####`, DOB,
  Insurance Plan Name, Insurance Member ID, MRN, Medicare MBI, email/guardian) AND
  mirrored into the **Patient Index** (as before) so crewOS `ops-data` and the 8
  `Patient` relations keep working. Dedup runs against both lists; the Index id is
  returned as `id` (crewOS relations reference it), plus `masterId`. Why both: the
  crewOS `Patient` relations (Referrals, Handoffs, Minutes, AWV, CharmEd ×2,
  Programs, Growth Plans) all target the **Index** (`c85c5213…`), verified — a
  Master-only patient would be invisible to crewOS and unlinkable.

### Remaining migration (full consolidation — reviewed follow-up)
The bridge above keeps both lists in sync for *new* patients. To make the Master
List the sole source and retire the Index:

1. **Repoint the 8 crewOS `Patient` relations** (Referrals/Handoffs/Minutes/AWV/
   CharmEd ×2/Programs/Growth Plans) from the Index (`c85c5213…`) to the Master
   List. ⚠️ Changing a relation's target DB clears existing links — write a
   re-linking migration first, or accept historical link loss.
2. **`ops-data.js`** → read the Master List.
3. **`stedi.js`** → read the Master List (uses the new `Medicare MBI`; backfill MBIs).
4. Drop the Index mirror from `action.js patient-create`; migrate any Index-only
   rows; retire the Index.
5. Leave **Panel Patients (#3)** as-is (de-identified analytics; no PHI).

Known bridge trade-off: a dual-written patient has two identifiers — the Master
List `Patient Ctl No` (BHW####, derived) and the Index's own auto `BHW ID` — until
step 4. `patients.js` also still returns empty `icds` (Master `Diagnoses` is a
relation needing extra lookups).
