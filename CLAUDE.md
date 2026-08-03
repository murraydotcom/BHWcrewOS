# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BHWcrewOS — the operations hub for BHW Medical Group. A **zero-build, zero-dependency static site** plus **Netlify Functions** backed by **Notion** as the database. There is no bundler, framework, or compile step: edit the HTML/CSS/JS and push; Netlify serves it directly.

The deployable app lives in **`BHWcrewOS-latest/`** (not the repo root). All paths below are relative to that directory.

## Pages in this deploy

- **`index.html`** — crewOS itself: a single-file, PIN-gated operations app (login → role-based landing page → rail of division/tool pages). All state comes from the functions/Notion layer. Design tokens are currently inlined in its `<style>` for legacy reasons.
- **`hq.html`** — "BHW HQ", a staff launchpad linking the three top-level destinations (crewOS `/`, the RCM platform at `bhw-rcm.netlify.app`, and the onboarding portal at `welcometobhw.netlify.app`) plus a config-driven **Staff Tools** row (`TOOLS` array: Paperwork Studio, Care Plan Studio, Claim Laundering). Edit the inline arrays to add resources. Supports a **Light Opal / Black Opal** theme via `data-theme` on `<html>` (persisted in `localStorage['bhw-theme']`, set before paint).
- **Staff studio pages** (reuse the crewOS PIN via `auth.js` → `sessionStorage['crewos_token']`, pull patients via `patients.js`):
  - **`bhw-paperwork.html`** — Paperwork Studio (chart pulls, prior auth, FMLA/MTA real-PDF fill, AI prefill).
  - **`bhw-careplan.html`** — Care Plan Studio: branded, patient-ready annual care plans per program (config-driven `PROGRAMS`), print/Save-PDF, saves to the Care Plans DB. Accepts `?program=`. Its section vocabulary maps onto the Notion "Personal Health Blueprint" templates.
  - **`bhw-discharges.html`** — Hospital Discharges & TCM board (ported from RCM; reads `crisp` feed).
- **Patient-facing forms** (public, no PIN, brand-styled, theme-aware, print a BHW-letterhead PDF summary, write to Notion):
  - **`screener.html?s=<slug>`** — condition screeners (PHQ-9/PHQ-A/PHQ-2, GAD-7/GAD-2, AUDIT-C/AUDIT, PCL-5 — all public-domain). Registry `SCREENERS`; POSTs to `screener-submit`.
  - **`bhw-questionnaire.html?q=<slug>`** — intake questionnaires (`awv-hra` full HRA, `charmed-intake` peds, `charmed-adult`, `porter-lifeskills`). Mixed question types + auto-flags; POSTs to `questionnaire-submit`.

`assets/bhw-tokens.css` is the **single source of truth for brand colors**. New pages should `<link>` it rather than redefining colors. `welcome.html` was removed once the onboarding portal became its own repo — welcometoBHW is `murraydotcom/welcometobhw`, not a page here.

## Backend (`netlify/functions/`)

CommonJS, Node, essentially dependency-free (only `pdf-lib` + `@netlify/blobs`). No SDKs — Notion is called over raw `https`.

- **`_lib.js`** — the shared core imported by every function. Contains: the `DB` map of Notion database IDs (the "BHW Operations Hub — Data Layer"), `queryDb`/`createPage`/`updatePage`, property readers (`P.title`, `P.sel`, `P.check`, …) and writers (`W`), HMAC session tokens (`sign`/`verify`/`getSession`, signed with `SESSION_SECRET`), `visibleDivisions` (division-scoping), and `json()`. Read this first — it defines the data model and auth.
- **`auth.js`** — login. PINs are **scrypt-hashed** and stored only as a hash in the `PIN Hash` rich_text property of the Staff & Roles Notion DB (the property is created idempotently on first use; the raw PIN is never stored). Actions: `roster`, `set-pin` (guarded by `SETUP_SECRET`, used by `/setup.html`), `login` (returns an HMAC session token).
- **`action.js`** — the single **write router** for crewOS (referrals, handoffs, minutes, availability, bookings). Every action re-validates the session and enforces division rules **server-side** — never trust the client for scoping. Booking enforces room rules, `Can Schedule`, and conflict checks.
- **`*-data.js`** (`ops-data`, `panel-data`, `frontdesk-data`, `console-data`, `morning-huddle`) — read/aggregation endpoints, one per area of the app.
- **`referral-pdf.js`** (pdf-lib), **`stedi.js`** (clearinghouse eligibility).
- **Patient forms → Notion** (public, hardened — known-slug allowlist, honeypot, length caps): **`screener-submit.js`** (→ Condition Screeners — Data; Notion formulas compute Total/Severity/Interpretation), **`questionnaire-submit.js`** (→ Questionnaires — Data; readable transcript + JSON + auto-flags). **`careplan-save.js`** (session-gated → Care Plans — Data). **`referral-templates.js`** (session-gated read of Referral Templates by destination; write via `action.js` `referral-template-save`). **`patients.js`** (session-gated Master Patient List picker).
- **Notifications — Keragon replacement** (inbound comms → Patient Request Triage Queue → Front Desk OS inbox, bucketed by `Source`): **`lib/triage.js`** (shared patient-match-by-phone + queue writer + Dialpad JWT verify), **`dialpad-events.js`** (inbound SMS + missed calls + voicemails), **`ifax-events.js`** (inbound fax webhook), **`email-ingest.js`** (parses iFax/Dialpad *emails* forwarded by `docs/gmail-ingest.gs`, since consumer iFax delivers by email not webhook). Answered/outbound events are ignored; webhook functions are ungated (own secrets).

The front-end talks to functions at `/.netlify/functions/<name>` with a `Bearer` session token; patient-facing forms POST without a token.

**New Notion DBs (in `_lib.js` `DB` map):** `screeners`, `referralTemplates`, `carePlans`, `questionnaires`. The **Personal Health Blueprint** templates (BHW, CharmEd, Mind & Mood behavioral, Flow vascular) live under Notion → Labs + Care Planning HQ, not in the repo.

## Deploy & config

- **Netlify build:** base directory **blank**, publish `.`, functions `netlify/functions` (declared in `netlify.toml`, which also sets `noindex` / `X-Frame-Options` headers). No build command — it's static.
- **Setup order (from README):** deploy → in Notion, share "BHW Operations Hub — Data Layer" with the integration → open `/setup.html` and set PINs → sign in at `/`.
- **Environment variables** (Netlify): core is `NOTION_TOKEN`, `SESSION_SECRET`, `SETUP_SECRET`. Individual functions also use `RESEND_API_KEY`/`RESEND_FROM` (email), `DASH_KEY`, `MASTER_DB_ID`/`QUEUE_DB_ID`/`PATIENTS_DB_ID`/`EVENTS_DB_ID`, `DIALPAD_TOKEN`/`DIALPAD_WEBHOOK_SECRET`/`DIALPAD_FROM`, `STEDI_KEY_PREFIX`/`STEDI_KEY_SUFFIX`, `OPENAI_API_KEY`/`OPENAI_MODEL` (Paperwork AI prefill), `IFAX_WEBHOOK_SECRET` (optional, iFax webhook) and `EMAIL_INGEST_SECRET` (required to arm `email-ingest`; must match the secret in the Gmail Apps Script).
- **RCM platform (separate repo `bhw-rcm-platform`)** has its own standalone login (`lib/rcmAuth.js` + `rcm-auth.js`), armed only when `RCM_SESSION_SECRET` + `RCM_CODE_AMARIS`/`RCM_CODE_SHADE` (or shared `RCM_ACCESS_CODE`) are set — otherwise it fails open.

**Critical gotcha:** both `package.json` files (root and `netlify/functions/`) must be valid JSON. A malformed one (e.g. a missing closing brace) fails the **entire** deploy at the "Install dependencies" stage before any content is published — the error looks unrelated to the actual edit.

## Working in this repo

- **No test/lint/build tooling exists.** Verify changes by pushing and checking the Netlify deploy preview, or run functions locally with `netlify dev`.
- To eyeball a static page locally, serve the directory over HTTP (e.g. `python3 -m http.server` from `BHWcrewOS-latest/`) rather than opening the file directly — pages reference assets by absolute path (`/assets/...`) that only resolve when served from the root.
- Keep the Notion database IDs in `_lib.js` in sync with the actual "Data Layer" databases; a stale ID surfaces as a Notion query error, not a build failure.
