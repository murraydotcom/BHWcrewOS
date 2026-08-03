# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BHWcrewOS — the operations hub for BHW Medical Group. A **zero-build, zero-dependency static site** plus **Netlify Functions** backed by **Notion** as the database. There is no bundler, framework, or compile step: edit the HTML/CSS/JS and push; Netlify serves it directly.

The deployable app lives in **`BHWcrewOS-latest/`** (not the repo root). All paths below are relative to that directory.

## Two front-ends in one deploy

- **`index.html`** — crewOS itself: a single-file, PIN-gated operations app (login → role-based landing page → rail of division/tool pages). All state comes from the functions/Notion layer. Design tokens are currently inlined in its `<style>` for legacy reasons.
- **`hq.html`** — "BHW HQ", a staff launchpad linking the three top-level destinations (crewOS `/`, the RCM platform at `bhw-rcm.netlify.app`, and the onboarding portal at `welcometobhw.netlify.app`). It is **config-driven**: edit the `SITES`, `CATEGORIES`, and `FAMILY` arrays in the inline `<script>` to add resources — no other change needed. It supports a **Light Opal / Black Opal** theme via `data-theme` on `<html>` (persisted in `localStorage['bhw-theme']`, set before paint to avoid flash).

`assets/bhw-tokens.css` is the **single source of truth for brand colors** (the crewOS palette plus the Foundation dark `--fnd-*` tokens used by HQ). New pages should `<link>` it rather than redefining colors. `welcome.html` was removed once the onboarding portal became its own repo — welcometoBHW is `murraydotcom/welcometobhw`, not a page here.

## Backend (`netlify/functions/`)

CommonJS, Node, essentially dependency-free (only `pdf-lib` + `@netlify/blobs`). No SDKs — Notion is called over raw `https`.

- **`_lib.js`** — the shared core imported by every function. Contains: the `DB` map of Notion database IDs (the "BHW Operations Hub — Data Layer"), `queryDb`/`createPage`/`updatePage`, property readers (`P.title`, `P.sel`, `P.check`, …) and writers (`W`), HMAC session tokens (`sign`/`verify`/`getSession`, signed with `SESSION_SECRET`), `visibleDivisions` (division-scoping), and `json()`. Read this first — it defines the data model and auth.
- **`auth.js`** — login. PINs are **scrypt-hashed** and stored only as a hash in the `PIN Hash` rich_text property of the Staff & Roles Notion DB (the property is created idempotently on first use; the raw PIN is never stored). Actions: `roster`, `set-pin` (guarded by `SETUP_SECRET`, used by `/setup.html`), `login` (returns an HMAC session token).
- **`action.js`** — the single **write router** for crewOS (referrals, handoffs, minutes, availability, bookings). Every action re-validates the session and enforces division rules **server-side** — never trust the client for scoping. Booking enforces room rules, `Can Schedule`, and conflict checks.
- **`*-data.js`** (`ops-data`, `panel-data`, `frontdesk-data`, `console-data`, `morning-huddle`) — read/aggregation endpoints, one per area of the app.
- **`referral-pdf.js`** (pdf-lib), **`stedi.js`** (clearinghouse eligibility), **`dialpad-events.js`** (telephony webhook).

The front-end talks to functions at `/.netlify/functions/<name>` with a `Bearer` session token.

## Deploy & config

- **Netlify build:** base directory **blank**, publish `.`, functions `netlify/functions` (declared in `netlify.toml`, which also sets `noindex` / `X-Frame-Options` headers). No build command — it's static.
- **Setup order (from README):** deploy → in Notion, share "BHW Operations Hub — Data Layer" with the integration → open `/setup.html` and set PINs → sign in at `/`.
- **Environment variables** (Netlify): core is `NOTION_TOKEN`, `SESSION_SECRET`, `SETUP_SECRET`. Individual functions also use `RESEND_API_KEY`/`RESEND_FROM` (email), `DASH_KEY`, `MASTER_DB_ID`/`QUEUE_DB_ID`/`PATIENTS_DB_ID`/`EVENTS_DB_ID`, `DIALPAD_TOKEN`/`DIALPAD_WEBHOOK_SECRET`/`DIALPAD_FROM`, and `STEDI_KEY_PREFIX`/`STEDI_KEY_SUFFIX`.

**Critical gotcha:** both `package.json` files (root and `netlify/functions/`) must be valid JSON. A malformed one (e.g. a missing closing brace) fails the **entire** deploy at the "Install dependencies" stage before any content is published — the error looks unrelated to the actual edit.

## Working in this repo

- **No test/lint/build tooling exists.** Verify changes by pushing and checking the Netlify deploy preview, or run functions locally with `netlify dev`.
- To eyeball a static page locally, serve the directory over HTTP (e.g. `python3 -m http.server` from `BHWcrewOS-latest/`) rather than opening the file directly — pages reference assets by absolute path (`/assets/...`) that only resolve when served from the root.
- Keep the Notion database IDs in `_lib.js` in sync with the actual "Data Layer" databases; a stale ID surfaces as a Notion query error, not a build failure.
