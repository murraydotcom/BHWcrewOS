# BHW Medical Group — Patient Design System
### “Opal & Ironstone”

A quiet-luxury design token system for everything patient-facing: sage green,
opal blue, and opal violet over pearl, cream, tan, and clay-brown — tuned to the
BHW Medical logo. **Light mode is the light opal** — light on light: near-white
cards on a soft pearl field with gentle blue/green/violet flashes. **Dark mode is
the boulder / black opal** — dark stone, brighter fire, fine gold kintsugi veins.

## Files

| File | What it is |
|------|------------|
| `bhw-tokens.css` | The system. All primitives + semantic tokens, light + dark. Link this. |
| `bhw-tokens.json` | The same tokens in [W3C design-tokens format](https://tr.designtokens.org/) for Figma / Style Dictionary. |
| `../bhw-design-system.html` | The living style guide — open it to see everything, with a light/dark toggle. |

## Use it

```html
<head>
  <!-- fonts (Playfair Display · Montserrat · Lora · Caveat) -->
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Montserrat:wght@300;400;500;600;700&family=Lora:ital@0;1&family=Caveat:wght@500;600&display=swap" rel="stylesheet">
  <!-- the tokens -->
  <link rel="stylesheet" href="/assets/bhw-tokens.css">
</head>
<body class="bhw">   <!-- opt in to the base styles -->
```

Then build with the **semantic** tokens — never a raw hex — and both themes come free:

```css
.card {
  background: var(--bg-elevated);
  color:      var(--fg);
  border:     1px solid var(--border);
  border-radius: var(--radius-lg);
  padding:    var(--space-6);
  box-shadow: var(--shadow-sm);
}
.card .cta { background: var(--accent); color: var(--accent-fg); }
```

## Theme

Follows the patient’s device automatically. To pin one, set it on `<html>`:

```html
<html data-theme="light">   <!-- or data-theme="dark" -->
```

## The tokens at a glance

- **Surfaces** `--bg` · `--bg-elevated` · `--bg-sunken` · `--bg-muted` · `--bg-inverse`
- **Text** `--fg` · `--fg-strong` · `--fg-muted` · `--fg-subtle` · `--fg-on-accent`
- **Accents** `--accent` (sage) · `--accent-2` (opal blue) · `--accent-3` (opal violet) · `--gold` (kintsugi) · `--brand-clay` · `*-hover` · `*-quiet` · `*-tint`
- **State** `--success` · `--info` · `--warning` · `--danger` (+ matching `*-bg`)
- **Lines** `--border` · `--border-strong` · `--border-accent` · `--divider` · `--ring`
- **Shimmer** `--opal-wash` · `--opal-veil` — one quiet moment per screen, never a whole page
- **Type** `--font-display|sans|serif|script` · `--text-2xs … --text-5xl` · weights · leading · tracking
- **Space** `--space-1 … --space-24` (4px grid) · **Radius** `--radius-xs … --radius-pill`
- **Elevation** `--shadow-xs … --shadow-xl` · `--shadow-gold`
- **Motion** `--duration-*` · `--ease-out|in-out|soft`

## Notes

- Solid accent fills use the deeper sage/blue step so white text on them clears
  **WCAG AA** at UI sizes; the softer brand tones live on as `--accent-tint` and
  in tinted backgrounds. Body and muted text pass AA in both themes.
- Motion respects `prefers-reduced-motion`.
- Gold is a garnish — focus rings, hairlines, one feature shimmer — not a fill.
