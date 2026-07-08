# BHWcrewOS — deploys flat from the repo root

Files live at the TOP LEVEL of the repository (no wrapper folder):
index.html · setup.html · netlify.toml · assets/ · netlify/functions/

Zero dependencies — no package.json, no build step. PIN hashes live in the
Staff & Roles database in Notion (the "PIN Hash" column is created
automatically the first time a PIN is saved; it stores scrambled hashes,
never actual PINs).

Netlify env vars: NOTION_TOKEN, SESSION_SECRET, SETUP_SECRET.
Netlify build settings: Base directory BLANK, publish ".",
functions "netlify/functions" (netlify.toml declares these too).

Setup order: deploy → share "BHW Operations Hub — Data Layer" with the
integration in Notion → open /setup.html → set PINs → sign in at /.
