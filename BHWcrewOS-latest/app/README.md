# BHW Care Connect

The patient communication hub for **BHW Medical Group / Baltimore Healthcare & Wellness**,
built from the Claude Design handoff in `../project/BHW Care Connect Just Ask.dc.html`.

React 19 + TypeScript + Vite. No UI framework — the design system is the
"Opal & Ironstone" token set, copied verbatim from the design bundle.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build into dist/
npm run preview   # serve the build
```

`dist/` is a plain static folder. `base` is `'./'`, so it can be dropped at a
domain root or under a sub-path (`bhwmedical.org/care-connect/`) without a
rebuild, and routing is hash-based (`#/`, `#/resources`) so no server rewrite
rules are needed.

## What's here

| Route         | What it is                                                        |
| ------------- | ----------------------------------------------------------------- |
| `#/`          | The hub — masthead, Just Ask triage, programs, ER/urgent care, contact |
| `#/resources` | Ask NP Am body map, education handouts, Baltimore community help   |

Section order on the hub is deliberate and shouldn't change without asking:

1. **Header** — brush-circle logo mark behind the wordmark, nav, Light/Black opal toggle
2. **Masthead** — BHW lockup, open-now status, announcements listed (never behind a button)
3. **Just Ask** — the heart of the page (see below)
4. **Program flip cards** — Primary Care → Mind & Mood → CharmEd Minds → Flow
5. **Resources promo** → the resource library
6. **Crisis strip**
7. **ER or urgent care?** two-column guidance
8. **Tell us you were seen** — transition-of-care heads-up
9. **Phone / text / Health Blueprint cards**, then hours and address
10. **Footer** — care, patients, legal, fine print, skyline

### Just Ask

Type anything into the box and `detectRoute()` (`src/data/triage.ts`) scores it
against six queues — refill, symptom or side effect, appointment, billing,
Blueprint access, something else. The readout under the box names the queue and
the response time; the form below asks name, date of birth and Health Blueprint
access first, then that queue's own questions. The clinical route shows a
red-flag warning that warns but never blocks. Route chips let anyone override
the guess, and answers are kept per route so switching doesn't lose typing.
Submitting reveals three route-specific troubleshooting cards.

Routing is keyword matching on purpose: it runs in the browser, it's readable,
and a wrong guess costs nothing.

## Naming rules

- It is the **Personal Health Blueprint** (or "Health Blueprint"). **Never** "patient portal."
- Programs stay in the order above.
- The recommendations section is **Ask NP Am**.
- Don't name the internal triage tool anywhere patient-facing.

## Where to change things

| You want to change…                       | Edit                                    |
| ----------------------------------------- | --------------------------------------- |
| Phone, fax, address, hours, open-now text | `src/data/contact.ts`                   |
| Office announcements                      | `src/data/news.ts`                      |
| Triage queues, keywords, questions, tips  | `src/data/triage.ts`                    |
| Program copy, colours, marks              | `src/data/programs.ts`                  |
| NP Am's picks, handouts, community help   | `src/data/resources.ts`                 |
| ER / urgent care lists                    | `src/data/erUrgentCare.ts`              |
| Announcement box style, affiliate codes   | `src/config.ts`                         |
| **Where patient messages actually go**    | `src/lib/submit.ts`                     |

Colours, type, spacing, shadows and both opal gradients live in
`src/styles/tokens.css`. Look up the real `--*` name before inventing one.
Iridescence = layered radial gradients in brand hues plus `var(--edge-gold)`;
it's used on the Just Ask block, the resources promo and the program card fronts.

## Before this goes live

**The forms don't send anywhere yet.** `src/lib/submit.ts` has two stubs —
`submitTriage` and `submitVisitNotice` — that resolve locally so the UI can be
demoed end to end. Replace their bodies with a real request and nothing else
needs to change. Read the notes at the top of that file first: everything these
forms collect is PHI, so it can only go to a service covered by a signed BAA,
and it must not be logged to an error tracker or an analytics tool.

Also still open, carried over from the design handoff:

- Real destinations for the four program pages, the Health Blueprint, the footer
  links and the "Older announcements" archive — all currently `#`
  (`CONTACT.blueprintUrl`, `Program.href`, `SiteFooter`, `Masthead`).
- NP Am's actual recommendation list. What's in `src/data/resources.ts` is
  placeholder copy written in her voice; every partner code is invented.
- The real body illustration. The current figure is the placeholder SVG from the
  design, and the label pills anchor to the card edges rather than the drawing,
  so swapping it in won't move them.
- Care-team headshots and a map, if those sections are still wanted.
- Announcement copy and the open-now status are hard-coded; wire them to whatever
  the front desk actually maintains.

## Notes on the port

Faithful to the design except where the prototype couldn't be:

- **Type is self-hosted.** Playfair Display and Caveat were already embedded in
  the design system's `fonts.css`; Montserrat, Lora and Dancing Script are now in
  `src/fonts/` too, so a patient-facing page makes no third-party font request.
- **Real URLs.** The prototype swapped pages in local state; `#/resources` is a
  shareable link and the back button works.
- **Theme resolves before first paint** via the boot script in `index.html`, so
  Light opal / Black opal never flashes. Still persisted to `localStorage`
  under `bhw-cc-theme`, still follows the OS until someone chooses.
- **"Send it"** had no handler in the prototype. It now scrolls to the intake
  form and focuses the first field, which is what the layout implies.
- **Accessibility:** skip link, labelled form controls, `aria-pressed` on every
  pill, the routing readout as a live region, flip-card back faces `inert` until
  turned, and the card flip respects `prefers-reduced-motion`.
- **Responsive:** the masthead stacks under 880px and the body map under 720px.
  Checked for horizontal overflow at 1280 / 900 / 600 / 380.

One thing left as-is on purpose: the BHW lockup in the masthead is the same flat
PNG in both themes, exactly as the prototype had it, so it reads quietly on the
black opal surface. A light-on-dark variant would fix that if you want one.
