# BHWcrewOS — internal operations hub

Division-walled operations platform for BHW Medical Group:
Primary Care · CharmEd Minds · Mind & Mood Recovery · The Porter House · Chronic Care · Flow.

Wired to the ten live Notion databases under **BHW Operations Hub — Data Layer**
(database IDs are already baked into `netlify/functions/_lib.js`).

## What works day one

- **Per-person login** — name + PIN (scrypt-hashed in Netlify Blobs). Roles,
  divisions, landing pages, and Can Schedule all come from Staff & Roles in
  Notion, so access changes are a Notion edit.
- **Division walls enforced server-side** — each person's payload only
  contains their divisions' referrals, handoffs, and schedule. Admins see all.
- **Referrals** — any division → any division, RCM-style count badges, queue
  with Receive → Start → Complete (+ completion note back to the sender),
  admin aging view.
- **Warm handoff inbox cards** — persistent until completed; Acknowledge
  (logged with who/when) → set visit date → Complete.
- **Minutes** — log in My Space, month totals, "not in CharmHealth" sync list
  with one-tap Mark, admin per-program monthly rollup.
- **Availability + rule-checked booking** — booking form filters services by
  room, and the server rejects: service not allowed in room, room
  double-booked, staff double-booked.
- **Porter House census** — visible to Porter House staff and admins, with
  Also-Receives overlap chips.

## Deploy

1. Create a new Netlify site named **bhwcrewos** from this folder (repo or
   drag-and-drop). Netlify installs `@netlify/blobs` from package.json.
2. Environment variables:
   - `NOTION_TOKEN` — the integration token (same one used for bhw-rcm)
   - `SESSION_SECRET` — any long random string (e.g. 64 hex chars)
   - `SETUP_SECRET` — a second random string, used only to set PINs
3. In Notion, open **BHW Operations Hub — Data Layer** → ⋯ → Connections →
   add the integration. (Sharing the parent page covers all ten databases.)
4. Turn on Netlify **site password protection** as the outer wall.

## Setting PINs (one time per person)

**Easiest: open https://bhwcrewos.netlify.app/setup.html** — enter the
SETUP_SECRET as the setup key, pick each name, type their PIN, Save. Eleven
taps and done. The curl method below does the same thing from a terminal.

PINs are set with the SETUP_SECRET. Easiest: from any terminal or an API tool,

```
curl -X POST https://bhwcrewos.netlify.app/.netlify/functions/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"set-pin","setupSecret":"YOUR_SETUP_SECRET","staffId":"STAFF_PAGE_ID","pin":"4832"}'
```

Staff page IDs (from the Staff & Roles database):
- Amaris — 39358075-8d30-81a2-9d5a-d2fbca3cf4b5
- Shadé — 39358075-8d30-8140-ae6c-e10ac47aaa46
- Yahaira — 39358075-8d30-8137-a427-e45aa4ddf49e
- Amanda — 39358075-8d30-8129-82b0-e915f666cdd6
- Aaliyah — 39358075-8d30-81a2-a2a0-d41f713af0a1
- Chrissy — 39358075-8d30-8107-81a3-c5a452e8147e
- Margaret — 39358075-8d30-8125-93b0-d54f9e1fb69b
- Kayla — 39358075-8d30-8124-8395-cccb434bd0de
- Eleshiea — 39358075-8d30-81a6-a149-d81c81a49db4
- Tanya — 39358075-8d30-8100-82a7-dbe7c3cce70d (inactive until activated in Notion)
- DeAndre — 39358075-8d30-813a-a472-f7c05d865508

Re-running set-pin for a person resets their PIN.

## PHI notes

- Patient names + BHW IDs live in Notion (BAA in place) and flow only to
  signed-in staff. The Schedule itself carries no patient identifiers.
- Sessions expire after 12 hours. Sign-out clears the token.
- Keep the Data Layer page shared only with the integration + admin accounts.

## Next phases

- Case Management Meetings page (database is live; UI next)
- Chronic Care wing merge (the bhw-ccm shell + Stedi eligibility batch +
  Prevention Tracker)
- Email digests via Resend (daily "your queue" summary, like the onboarding
  portal's renewal digests)
