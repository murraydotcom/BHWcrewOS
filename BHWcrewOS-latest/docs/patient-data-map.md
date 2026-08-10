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

### Remaining migration (reviewed follow-up — NOT yet done)
These still read/write the **Patient Index (#1)** and must be moved carefully:

1. **`action.js` (patient *creation* + roster read)** — new crewOS-created patients
   still land in the Index. Repoint to the Master List, mapping create props to its
   schema (title `Patient Name`, `Patient Ctl No`, `Payer`, `Insurance Member ID`,
   `DOB`, `Program Enrollment`).
2. **`stedi.js` (Medicare eligibility)** — ⚠️ **blocker:** the Master List has **no
   `Medicare MBI` property**, which Stedi requires. Add `Medicare MBI` to the Master
   List (and backfill it) *before* repointing Stedi, or eligibility checks break.
3. **`ops-data.js`** — patient aggregation; repoint after #1/#2.
4. Migrate any Index-only patient rows into the Master List, then retire the Index.
5. Leave **Panel Patients (#3)** as-is (de-identified analytics; no PHI).
6. `patients.js` still returns empty `icds` — the Master List's `Diagnoses` is a
   relation; expanding it needs extra lookups (or a flat ICD text field).

Written up here so the create/eligibility move is done with eyes open rather than
blind. Ping to schedule the follow-up; the `Medicare MBI` add is the gating step.
