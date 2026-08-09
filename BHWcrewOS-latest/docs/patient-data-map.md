# Patient data map & reconciliation plan

_Audit finding, Aug 2026. "Patient Master linking" is currently split across
several different Notion databases. This documents what each function reads/writes
and recommends how to consolidate. No behavior was changed by adding this file._

## The databases in play

| # | Notion DB (title) | ID / how it's referenced | What it is | Read/written by |
|---|---|---|---|---|
| 1 | **Patient Index — Ops Hub** | `DB.patients` = `f9a0291f…` (collection `c85c5213…`) | Lean operational index: Patient Name, BHW ID (auto), DOB, Insurance, Member ID, Medicare MBI, Status, Active Divisions, Medications | `patients.js` (Paperwork/Care Plan picker), `action.js` (create/read patients), `stedi.js`, `ops-data.js` |
| 2 | **Patients Master List** | `process.env.MASTER_DB_ID` (value lives only in Netlify env — **not in the repo**) | Richer record: Patient Page (Health Hub link), Phone, Payer, Medicaid MCO, MRN/Member ID, Patient Ctl No, Program Enrollment, Last/Next Visit… | `frontdesk-data.js`, `console-data.js`, `lib/triage.js` (→ `dialpad-events`, `ifax-events`, `email-ingest`) |
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

## Recommended direction (needs one decision from ops)

**Decision to make:** which DB is the single source of truth for an operational
patient record — the lean **Patient Index (#1)** or the richer **Master List (#2)**?
(And confirm what `MASTER_DB_ID` is currently set to in Netlify.)

Recommended: **consolidate onto the Master List (#2)** — it already carries the
fields the most surfaces need (Health Hub page, phone, payer, program) — and:

1. Point `DB.patients` at #2 (or set `MASTER_DB_ID` and `DB.patients` to the same
   id) so the crewOS picker, `action.js`, and Front Desk all read one list.
2. Add the properties `patients.js` expects (`CharmHealth Chart #`, an ICD/Diagnoses
   field) to that DB, or drop them from `shape()` if they won't be maintained.
3. Migrate any Index-only patients into #2, then retire #1.
4. Leave **Panel Patients (#3)** as-is — it's a separate de-identified analytics
   table and shouldn't hold PHI.
5. Optionally add a relation from the questionnaire/screener target so intake forms
   can link to the operational record, not only the CharmEd assessment case.

This is a data-model migration, so it's written up here rather than changed blind.
Ping to confirm the authoritative DB and `MASTER_DB_ID`, and it can be executed.
