import { logoCharmedMinds, logoFlow, logoMindMood, logoPrimaryCare } from '../assets'

/**
 * The four programs, in the order the practice asked for:
 * Primary Care → Mind & Mood → CharmEd Minds → Flow. Don't reorder.
 *
 * Each card front is iridescent — layered radial gradients in the program's own
 * hue over a quiet veil — with the program's mark as a low-opacity corner
 * watermark. The back is that family's deep opal surface.
 */

/** Iridescence: three brand-hue pools, same recipe as the Just Ask block. */
const IRIS = {
  clay: 'radial-gradient(88% 70% at 12% 8%, rgba(178,124,84,.16), transparent 62%), radial-gradient(80% 66% at 92% 22%, rgba(140,164,178,.20), transparent 64%), radial-gradient(96% 80% at 74% 100%, rgba(150,168,138,.18), transparent 66%)',
  violet:
    'radial-gradient(88% 70% at 10% 6%, rgba(142,114,168,.20), transparent 62%), radial-gradient(78% 64% at 94% 26%, rgba(140,164,178,.18), transparent 64%), radial-gradient(96% 80% at 70% 100%, rgba(196,164,132,.16), transparent 66%)',
  blue: 'radial-gradient(88% 70% at 12% 8%, rgba(96,158,180,.20), transparent 62%), radial-gradient(80% 66% at 92% 24%, rgba(150,168,138,.18), transparent 64%), radial-gradient(96% 80% at 72% 100%, rgba(178,124,84,.14), transparent 66%)',
  sage: 'radial-gradient(88% 70% at 10% 8%, rgba(150,168,138,.22), transparent 62%), radial-gradient(78% 64% at 94% 22%, rgba(142,114,168,.16), transparent 64%), radial-gradient(96% 80% at 74% 100%, rgba(96,158,180,.18), transparent 66%)',
} as const

/** The watermark treatment flips with the theme so the mark reads on both surfaces. */
export const LIGHT_SURFACE = {
  wash: 'radial-gradient(60% 60% at 68% 70%, rgba(255,255,255,.82), rgba(255,255,255,.42) 55%, transparent 78%)',
  glow: 'drop-shadow(0 0 26px rgba(255,255,255,.95)) drop-shadow(0 0 10px rgba(255,255,255,.9))',
} as const

export const DARK_SURFACE = {
  wash: 'radial-gradient(60% 60% at 68% 70%, rgba(12,10,8,.55), rgba(12,10,8,.26) 55%, transparent 78%)',
  glow: 'grayscale(1) brightness(2.6) drop-shadow(0 0 22px rgba(0,0,0,.55))',
} as const

export interface Program {
  key: string
  num: string
  name: string
  /** Eyebrow number + accents on the front face. */
  tint: string
  /** Flat wash under the iridescence. */
  veil: string
  iris: string
  /** Deep opal surface on the back face. */
  back: string
  /** Legible label colour on that back surface. */
  backTint: string
  logo: string
  blurb: string
  who: string
  first: string
  /** Where "Open the program page →" goes once the BHWcrewOS pages are wired. */
  href: string
}

export const PROGRAMS: Program[] = [
  {
    key: 'pc',
    num: '01',
    name: 'Primary Care',
    tint: 'var(--brand-clay)',
    veil: 'var(--gold-quiet)',
    iris: IRIS.clay,
    back: 'var(--c-stone-850)',
    backTint: 'var(--c-terracotta-300)',
    logo: logoPrimaryCare,
    blurb: 'Annual visits, sick visits, labs and referrals — your medical home base.',
    who: 'Anyone who wants one clinician who knows the whole picture and coordinates the rest.',
    first:
      'A full physical, medication review, screenings you’re due for, and same-day labs downstairs.',
    href: 'bhw-patient-portal-mockup.html',
  },
  {
    key: 'mm',
    num: '02',
    name: 'Mind & Mood',
    tint: 'var(--accent-3)',
    veil: 'var(--accent-3-quiet)',
    iris: IRIS.violet,
    back: 'var(--c-lavender-800)',
    backTint: 'var(--c-lavender-400)',
    logo: logoMindMood,
    blurb:
      'Psychiatry and medication management for depression, anxiety, ADHD and bipolar care.',
    who: 'Adults who want medication managed carefully — including anyone tapering, switching, or starting for the first time.',
    first:
      '60 minutes, mostly listening. History, current meds, labs if needed, and a plan you agreed to before you leave.',
    href: 'bhw-mindmood-patient-mockup.html',
  },
  {
    key: 'cm',
    num: '03',
    name: 'CharmEd Minds',
    tint: 'var(--accent-2)',
    veil: 'var(--accent-2-quiet)',
    iris: IRIS.blue,
    back: 'var(--c-blue-800)',
    backTint: 'var(--c-blue-400)',
    logo: logoCharmedMinds,
    blurb: 'Therapy and skills groups run by Baltimore clinicians who know the city.',
    who: 'Anyone looking for talk therapy, DBT-style skills, or a group that doesn’t feel like a waiting room.',
    first:
      'A 20-minute match call first, then a 50-minute intake with the therapist you were matched to.',
    href: 'bhw-charmed-patient-mockup.html',
  },
  {
    key: 'fl',
    num: '04',
    name: 'Flow',
    tint: 'var(--accent)',
    veil: 'var(--accent-quiet)',
    iris: IRIS.sage,
    back: 'var(--c-sage-800)',
    backTint: 'var(--c-sage-400)',
    logo: logoFlow,
    blurb: 'Weight, metabolic and hormone care, without the lecture.',
    who: 'Patients working on weight, insulin resistance, PCOS or fatigue — GLP-1 medications included when they fit.',
    first:
      'Labs, body composition, a food-and-life history, and honest talk about what you actually want to change.',
    href: 'bhw-flow-patient-mockup.html',
  },
]
