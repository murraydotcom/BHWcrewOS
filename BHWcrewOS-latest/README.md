# BHWcrewOS — deploys flat from the repo root

Files live at the TOP LEVEL of the repository (no wrapper folder):
index.html · setup.html · netlify.toml · assets/ · netlify/functions/

Zero dependencies — no package.json, no build step. PIN hashes live in the
Staff & Roles database in Notion (the "PIN Hash" column is created
automatically the first time a PIN is saved; it stores scrambled hashes,
never actual PINs).

Core Netlify env vars: NOTION_TOKEN, SESSION_SECRET, SETUP_SECRET.
Netlify build settings: Base directory BLANK, publish ".",
functions "netlify/functions" (netlify.toml declares these too).

Setup order: deploy → share "BHW Operations Hub — Data Layer" with the
integration in Notion → open /setup.html → set PINs → sign in at /.

## Google operations foundation

`cloud/operations-api/` is the Cloud Run/Firestore foundation for shared patient
requests, tasks, communication records, and metadata-only audit events. It does
not send notifications. See `docs/google-native-communication-foundation.md` for
the data model, Care Connect intake contract, CrewOS integration points, system
boundaries, and deployment dependencies.

Netlify uses `OPERATIONS_CLOUD_API_URL` and
`CREWOS_OPERATIONS_TOKEN_SECRET` for signed staff access. The optional
Care Connect bridge additionally requires `CARE_CONNECT_INTAKE_SECRET`; until
those values are configured, the existing Notion triage path remains
transitional.
