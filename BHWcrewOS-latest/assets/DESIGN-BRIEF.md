# BHW Medical — Patient UI design brief ("Opal & Ironstone")

Paste-ready brief for generating **new** patient-facing pages in this style (drop the
whole file into a Claude chat or Artifact prompt, then add your ask). The canonical,
fuller source of truth is [`bhw-tokens.css`](./bhw-tokens.css) — when it changes, refresh
this file to match.

You are designing **patient-facing** UI for BHW Medical Group (Baltimore Healthcare &
Wellness). Follow this system exactly. Build with the CSS variables below — never hardcode
hex. Light + dark both required.

## Voice
Warm, plain-language, second person ("your care team"), unhurried, quietly luxurious. Name
things the way a patient would. Active voice; a button says exactly what it does.

## The feel
- **Light mode = light opal.** Light-on-light: near-white cards floating on a soft pearl
  page, gentle flashes of sage/blue/violet. Airy, calm.
- **Dark mode = black opal.** A deep peacock-**blue** stone (not flat black), the opal
  fire glowing out of it and fine gold seams.
- Theme follows the device (`prefers-color-scheme`) and can be pinned with
  `data-theme="light"|"dark"` on `<html>`.

## Lux rules (this is what makes it feel premium)
- **One opal-stone shimmer per screen** (`--opal-stone`) — hero or a single feature card.
  Never a whole page, never two.
- **Gold is a garnish**: focus rings, a fine hairline edge (`--edge-gold`), one accent —
  never a fill or a background.
- Soft, low-contrast shadows; generous whitespace; hairline borders.
- Three accent "fires": **sage green** (primary), **opal blue** (secondary), **opal violet**
  (tertiary). Mind & Mood pages lean violet.
- WCAG AA everywhere: solid accent buttons use the deep step with white text; body/muted
  text stays legible in both themes.

## Type
- **Playfair Display** — headings/display (weight 400–500, tight tracking, `text-wrap:balance`).
- **Montserrat** — UI + body. **Lora** — long-form reading. **Caveat** — occasional
  human/script note (care-team signatures), sparingly.
- Eyebrows = uppercase, `letter-spacing:0.16em`, muted.
- Load:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Montserrat:wght@300;400;500;600;700&family=Lora:ital@0;1&family=Caveat:wght@500;600&display=swap" rel="stylesheet">
  ```

## Components
- **Buttons** (pill, semibold): primary = `--accent` fill / `--accent-fg`; secondary =
  `--accent-2`; tertiary = `--accent-3`; outline = transparent + `--border-strong`, hover to
  `--accent`; ghost = `--accent-quiet` bg; gold = transparent + `--gold` border (feature only).
- **Cards** = `--bg-elevated`, 1px `--border`, `--radius-lg`, `--shadow-sm`. **Feature card**
  = `background-image:var(--opal-stone); box-shadow:var(--shadow-md),var(--edge-gold);
  border-color:transparent`.
- **Badges/pills** = tinted `*-quiet` bg + `*-quiet-fg` text.
- **Alerts** = state `*-bg` + a 3px left bar in the state color
  (`--success/--info/--warning/--danger`).
- **Inputs** = `--bg`, 1px `--border-strong`, focus ring
  `0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)`.
- **Focus-visible** = `2px solid var(--ring)` (gold), offset 2px. Respect
  `prefers-reduced-motion`.

## Stylesheet — paste this, then build with the semantic vars. Wrap the page in `<body class="bhw">`.

```css
:root{
  /* fires */
  --c-sage-100:#DDE7DD;--c-sage-300:#9CB5A2;--c-sage-400:#7D9B86;--c-sage-600:#4D7159;--c-sage-700:#3C5946;--c-sage-800:#2B4133;--c-sage-900:#1B2B22;
  --c-blue-100:#DBE8ED;--c-blue-300:#97BACB;--c-blue-400:#6E9EB3;--c-blue-600:#3D6E7E;--c-blue-700:#2F5663;--c-blue-800:#223E48;--c-blue-900:#15272E;
  --c-lavender-100:#E6DDEC;--c-lavender-200:#D3C4DD;--c-lavender-300:#B9A6C9;--c-lavender-400:#9C86B2;--c-lavender-600:#6A5480;--c-lavender-700:#533F66;--c-lavender-800:#3B2C49;--c-lavender-900:#261D30;
  --c-gold-300:#E6C98A;--c-gold-400:#D6B25C;--c-gold-500:#C0A046;
  /* neutrals + brand */
  --c-pearl-0:#FEFDFB;--c-pearl-50:#F8F6F1;--c-cream-100:#F7F3EA;--c-linen-200:#F0EADD;--c-tan-400:#D3BF9F;--c-wheat-500:#B7A17E;--c-clay-brand:#905B35;--c-umber-900:#2C231B;
  /* deep-blue opal darks */
  --c-obsidian-950:#0A1822;--c-stone-900:#0F2230;--c-stone-850:#15293A;--c-stone-800:#1D3648;--c-boulder-900:#102232;
  --c-terracotta-300:#E0A896;--c-terracotta-500:#B15540;
  /* fonts / scale / motion */
  --font-display:'Playfair Display',Georgia,serif;--font-sans:'Montserrat',system-ui,sans-serif;--font-serif:'Lora',Georgia,serif;--font-script:'Caveat',cursive;
  --text-xs:.833rem;--text-sm:.889rem;--text-base:1rem;--text-md:1.125rem;--text-lg:1.35rem;--text-xl:1.62rem;--text-2xl:1.944rem;--text-3xl:2.488rem;--text-4xl:3.052rem;--text-5xl:3.815rem;
  --tracking-tight:-0.02em;--tracking-eyebrow:0.16em;--leading-normal:1.55;--leading-relaxed:1.7;
  --space-1:.25rem;--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--space-5:1.25rem;--space-6:1.5rem;--space-8:2rem;--space-10:2.5rem;--space-12:3rem;--space-16:4rem;
  --radius-sm:8px;--radius-md:12px;--radius-lg:18px;--radius-xl:26px;--radius-pill:999px;
  --ease-out:cubic-bezier(.16,1,.30,1);--dur:220ms;
  /* light-opal semantics */
  --bg:var(--c-pearl-50);--bg-elevated:var(--c-pearl-0);--bg-sunken:var(--c-cream-100);--bg-muted:var(--c-linen-200);
  --fg:#2A3A40;--fg-strong:#1B2A30;--fg-muted:#6E6B62;--fg-subtle:var(--c-wheat-500);--fg-on-accent:var(--c-pearl-0);
  --accent:var(--c-sage-600);--accent-hover:var(--c-sage-700);--accent-fg:var(--fg-on-accent);--accent-quiet:var(--c-sage-100);--accent-quiet-fg:var(--c-sage-700);--accent-tint:var(--c-sage-400);
  --accent-2:var(--c-blue-600);--accent-2-hover:var(--c-blue-700);--accent-2-quiet:var(--c-blue-100);--accent-2-quiet-fg:var(--c-blue-700);--accent-2-tint:var(--c-blue-400);
  --accent-3:var(--c-lavender-600);--accent-3-hover:var(--c-lavender-700);--accent-3-quiet:var(--c-lavender-100);--accent-3-quiet-fg:var(--c-lavender-700);--accent-3-tint:var(--c-lavender-300);
  --gold:var(--c-gold-500);--brand-clay:var(--c-clay-brand);
  --border:rgba(43,58,64,.10);--border-strong:rgba(43,58,64,.18);--divider:rgba(43,58,64,.07);--ring:var(--c-gold-500);
  --success:var(--c-sage-600);--success-bg:var(--c-sage-100);--info:var(--c-blue-600);--info-bg:var(--c-blue-100);--warning:var(--c-gold-500);--warning-bg:#F0DDAF;--danger:var(--c-terracotta-500);--danger-bg:#F3DED6;
  --shadow-sm:0 2px 6px rgba(44,35,27,.08);--shadow-md:0 10px 24px -12px rgba(44,35,27,.20);--shadow-lg:0 24px 48px -20px rgba(44,35,27,.28);
  --edge-gold:inset 0 0 0 1px color-mix(in srgb,var(--gold) 42%,transparent);
  --opal-stone:radial-gradient(58% 78% at 18% 22%,rgba(110,158,179,.44),transparent 60%),radial-gradient(54% 74% at 82% 18%,rgba(156,134,178,.40),transparent 60%),radial-gradient(64% 82% at 74% 82%,rgba(125,155,134,.44),transparent 62%),radial-gradient(48% 66% at 30% 88%,rgba(212,174,174,.32),transparent 60%),radial-gradient(42% 58% at 52% 46%,rgba(230,201,138,.30),transparent 66%),linear-gradient(135deg,var(--c-pearl-0),#F0ECF3 50%,#E9F1EE 100%);
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:var(--c-obsidian-950);--bg-elevated:var(--c-stone-900);--bg-sunken:#071019;--bg-muted:var(--c-stone-800);
  --fg:#E9E3D6;--fg-strong:#FBF9F4;--fg-muted:#9AA39B;--fg-subtle:#6C7269;--fg-on-accent:#0C120F;
  --accent:var(--c-sage-300);--accent-hover:#B0CCB6;--accent-quiet:var(--c-sage-800);--accent-quiet-fg:#BCCFC0;--accent-tint:var(--c-sage-400);
  --accent-2:var(--c-blue-300);--accent-2-hover:#B0D2DF;--accent-2-quiet:var(--c-blue-800);--accent-2-quiet-fg:#BAD2DC;--accent-2-tint:var(--c-blue-400);
  --accent-3:var(--c-lavender-300);--accent-3-hover:#CBB9D8;--accent-3-quiet:var(--c-lavender-800);--accent-3-quiet-fg:var(--c-lavender-200);--accent-3-tint:var(--c-lavender-400);
  --gold:var(--c-gold-400);--brand-clay:#C89A6B;
  --border:rgba(233,227,214,.12);--border-strong:rgba(233,227,214,.22);--divider:rgba(233,227,214,.08);--ring:var(--c-gold-400);
  --success:var(--c-sage-300);--success-bg:rgba(97,137,111,.22);--info:var(--c-blue-300);--info-bg:rgba(78,135,152,.22);--warning:var(--c-gold-300);--warning-bg:rgba(214,178,92,.18);--danger:var(--c-terracotta-300);--danger-bg:rgba(177,85,64,.24);
  --shadow-sm:0 2px 8px rgba(0,0,0,.45);--shadow-md:0 14px 30px -14px rgba(0,0,0,.60);--shadow-lg:0 28px 56px -22px rgba(0,0,0,.68);
  --opal-stone:radial-gradient(58% 78% at 20% 24%,rgba(96,158,180,.42),transparent 62%),radial-gradient(54% 74% at 82% 20%,rgba(142,114,168,.36),transparent 62%),radial-gradient(64% 82% at 74% 82%,rgba(104,150,120,.36),transparent 62%),radial-gradient(46% 62% at 46% 50%,rgba(214,178,92,.16),transparent 66%),linear-gradient(135deg,#0A1822,#11253A 52%,#0C1E2E 100%);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --bg:var(--c-obsidian-950);--bg-elevated:var(--c-stone-900);--bg-sunken:#071019;--bg-muted:var(--c-stone-800);
  --fg:#E9E3D6;--fg-strong:#FBF9F4;--fg-muted:#9AA39B;--fg-subtle:#6C7269;--fg-on-accent:#0C120F;
  --accent:var(--c-sage-300);--accent-hover:#B0CCB6;--accent-quiet:var(--c-sage-800);--accent-quiet-fg:#BCCFC0;--accent-tint:var(--c-sage-400);
  --accent-2:var(--c-blue-300);--accent-2-hover:#B0D2DF;--accent-2-quiet:var(--c-blue-800);--accent-2-quiet-fg:#BAD2DC;--accent-2-tint:var(--c-blue-400);
  --accent-3:var(--c-lavender-300);--accent-3-hover:#CBB9D8;--accent-3-quiet:var(--c-lavender-800);--accent-3-quiet-fg:var(--c-lavender-200);--accent-3-tint:var(--c-lavender-400);
  --gold:var(--c-gold-400);--brand-clay:#C89A6B;
  --border:rgba(233,227,214,.12);--border-strong:rgba(233,227,214,.22);--divider:rgba(233,227,214,.08);--ring:var(--c-gold-400);
  --success:var(--c-sage-300);--success-bg:rgba(97,137,111,.22);--info:var(--c-blue-300);--info-bg:rgba(78,135,152,.22);--warning:var(--c-gold-300);--warning-bg:rgba(214,178,92,.18);--danger:var(--c-terracotta-300);--danger-bg:rgba(177,85,64,.24);
  --shadow-sm:0 2px 8px rgba(0,0,0,.45);--shadow-md:0 14px 30px -14px rgba(0,0,0,.60);--shadow-lg:0 28px 56px -22px rgba(0,0,0,.68);
  --opal-stone:radial-gradient(58% 78% at 20% 24%,rgba(96,158,180,.42),transparent 62%),radial-gradient(54% 74% at 82% 20%,rgba(142,114,168,.36),transparent 62%),radial-gradient(64% 82% at 74% 82%,rgba(104,150,120,.36),transparent 62%),radial-gradient(46% 62% at 46% 50%,rgba(214,178,92,.16),transparent 66%),linear-gradient(135deg,#0A1822,#11253A 52%,#0C1E2E 100%);
}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.bhw{background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-size:var(--text-base);line-height:var(--leading-normal);-webkit-font-smoothing:antialiased;transition:background var(--dur) var(--ease-out),color var(--dur) var(--ease-out)}
.bhw h1,.bhw h2,.bhw h3{font-family:var(--font-display);color:var(--fg-strong);font-weight:500;line-height:1.15;letter-spacing:var(--tracking-tight);text-wrap:balance}
.bhw .eyebrow{font-size:var(--text-xs);font-weight:600;letter-spacing:var(--tracking-eyebrow);text-transform:uppercase;color:var(--fg-muted)}
.bhw :where(a,button,input,select,textarea,[tabindex]):focus-visible{outline:2px solid var(--ring);outline-offset:2px}
```
