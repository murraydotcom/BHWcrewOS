/**
 * Ask NP Am — the body map, her picks, the handouts and Baltimore community help.
 *
 * The recommendation entries are placeholders written in Am's voice. Swap in her
 * real list; the shape is what matters. Anything with a partner code must stay
 * covered by the affiliate disclosure under the list.
 */

export type RegionKey = 'mind' | 'thyroid' | 'heart' | 'gut' | 'metab' | 'skin' | 'joints'

/** Where the label pill sits relative to the figure. */
export type RegionSide = 'left' | 'right' | 'top'

export interface Recommendation {
  /** Single-letter mark in the leading tile. */
  mark: string
  product: string
  brand: string
  kind: string
  why: string
  /** Partner code, or a plain note like "Free at Enoch Pratt". */
  code: string
  href?: string
}

export interface Region {
  key: RegionKey
  label: string
  system: string
  side: RegionSide
  /** Vertical position of the label pill over the figure. */
  y: string
  tint: string
  quiet: string
  note: string
  items: Recommendation[]
}

export const REGIONS: Region[] = [
  {
    key: 'mind',
    label: 'Mind & sleep',
    system: 'Neuro · behavioral health',
    side: 'top',
    y: '6%',
    tint: 'var(--accent-3)',
    quiet: 'var(--accent-3-quiet)',
    note: 'Sleep, focus, mood support that plays nicely with psychiatric medication. Always run supplements past your prescriber first.',
    items: [
      {
        mark: 'M',
        product: 'Magnesium Glycinate',
        brand: 'Thorne',
        kind: 'Supplement',
        why: 'The one I suggest for sleep onset and muscle tension — gentler on the gut than citrate.',
        code: 'CODE: BHWAM10',
      },
      {
        mark: 'L',
        product: 'Sunrise alarm clock',
        brand: 'Hatch',
        kind: 'Device',
        why: 'For winter mornings and anyone whose phone alarm has become the enemy.',
        code: 'CODE: BHW15',
      },
      {
        mark: 'C',
        product: 'CBT-I for insomnia',
        brand: 'Insomnia Coach (local)',
        kind: 'Service',
        why: 'Six sessions, better evidence than any sleep supplement. Telehealth statewide.',
        code: 'Patients: waived intake fee',
      },
      {
        mark: 'B',
        product: 'Why We Sleep',
        brand: 'Matthew Walker',
        kind: 'Book',
        why: 'Read one chapter before you buy anything else on this list.',
        code: 'Free at Enoch Pratt',
      },
    ],
  },
  {
    key: 'thyroid',
    label: 'Thyroid & hormones',
    system: 'Endocrine',
    side: 'right',
    y: '18%',
    tint: 'var(--accent-2)',
    quiet: 'var(--accent-2-quiet)',
    note: 'Thyroid, perimenopause and testosterone questions. Labs first, products second — bring these to your next visit.',
    items: [
      {
        mark: 'S',
        product: 'Selenium 200mcg',
        brand: 'Pure Encapsulations',
        kind: 'Supplement',
        why: 'Modest support for Hashimoto’s antibodies. Only if your labs point that way.',
        code: 'CODE: BHWAM10',
      },
      {
        mark: 'H',
        product: 'Perimenopause tracker',
        brand: 'Balance',
        kind: 'App',
        why: 'Bring the exported symptom log to your visit — it changes the conversation.',
        code: 'Free tier is enough',
      },
      {
        mark: 'P',
        product: 'Pelvic floor PT',
        brand: 'Charm City Pelvic Health',
        kind: 'Service',
        why: 'For pain, leaking, or postpartum recovery. Referral not required in MD.',
        code: 'Say BHW sent you',
      },
    ],
  },
  {
    key: 'heart',
    label: 'Heart & blood pressure',
    system: 'Cardiovascular',
    side: 'left',
    y: '28%',
    tint: 'var(--danger)',
    quiet: 'var(--danger-bg)',
    note: 'Home monitoring beats one reading in our hallway. Cuff first, everything else after.',
    items: [
      {
        mark: 'B',
        product: 'Upper-arm BP monitor 5-series',
        brand: 'Omron',
        kind: 'Device',
        why: 'Validated, cuff not wrist. Bring it in and we’ll calibrate against ours.',
        code: 'CODE: BHWHEART',
      },
      {
        mark: 'O',
        product: 'Omega-3 (EPA/DHA)',
        brand: 'Nordic Naturals',
        kind: 'Supplement',
        why: 'For triglycerides, at real doses. Skip if you’re on a blood thinner without asking.',
        code: 'CODE: BHWAM10',
      },
      {
        mark: 'W',
        product: 'Walk-with-a-Doc Druid Hill',
        brand: 'BHW + Parks & People',
        kind: 'Program',
        why: 'Second Saturday of the month, 9am, all paces. I’m usually at the back talking.',
        code: 'Free',
      },
    ],
  },
  {
    key: 'gut',
    label: 'Gut & digestion',
    system: 'GI',
    side: 'right',
    y: '42%',
    tint: 'var(--accent)',
    quiet: 'var(--accent-quiet)',
    note: 'Reflux, bloating, IBS. Fiber and food order do more than most bottles.',
    items: [
      {
        mark: 'S',
        product: 'DS-01 Daily Synbiotic',
        brand: 'Seed',
        kind: 'Supplement',
        why: 'The probiotic I bother recommending. Give it eight weeks or don’t bother.',
        code: 'CODE: BHWAM25',
      },
      {
        mark: 'F',
        product: 'Psyllium husk',
        brand: 'Konsyl',
        kind: 'Supplement',
        why: 'Unglamorous, cheap, works. Start at half a scoop or you’ll hate me.',
        code: 'No code needed',
      },
      {
        mark: 'L',
        product: 'Low-FODMAP reset',
        brand: 'Monash University app',
        kind: 'App',
        why: 'Use it for six weeks with a plan, not forever. Pair with our dietitian.',
        code: 'Handout below',
      },
    ],
  },
  {
    key: 'metab',
    label: 'Metabolic & weight',
    system: 'Metabolic · Flow program',
    side: 'left',
    y: '50%',
    tint: 'var(--brand-clay)',
    quiet: 'var(--gold-quiet)',
    note: 'Companions to Flow program care — GLP-1 support, protein, strength. No detoxes, ever.',
    items: [
      {
        mark: 'C',
        product: 'Continuous glucose monitor',
        brand: 'Stelo by Dexcom',
        kind: 'Device',
        why: 'Two weeks of data tells us more than a fasting glucose. No prescription needed.',
        code: 'CODE: BHWFLOW',
      },
      {
        mark: 'P',
        product: 'Unflavored whey isolate',
        brand: 'Bulk Supplements',
        kind: 'Nutrition',
        why: 'On a GLP-1, protein is the whole ballgame. Cheapest gram-for-gram I’ve found.',
        code: 'CODE: BHWAM10',
      },
      {
        mark: 'S',
        product: 'Small-group strength training',
        brand: 'Charm City Strength',
        kind: 'Service',
        why: 'Keeps muscle while weight comes off. Coaches know GLP-1 patients.',
        code: 'First month 50% off',
      },
    ],
  },
  {
    key: 'skin',
    label: 'Skin & hair',
    system: 'Dermatologic',
    side: 'right',
    y: '64%',
    tint: 'var(--c-rose-400)',
    quiet: 'var(--bg-muted)',
    note: 'The short list. Sunscreen you’ll actually reapply beats the perfect one you won’t.',
    items: [
      {
        mark: 'S',
        product: 'Clear Mineral SPF 40',
        brand: 'EltaMD UV',
        kind: 'Skincare',
        why: 'Doesn’t sting, doesn’t ghost, works on acne-prone skin.',
        code: 'CODE: BHWSKIN',
      },
      {
        mark: 'R',
        product: 'Adapalene 0.1%',
        brand: 'Differin',
        kind: 'OTC treatment',
        why: 'Retinoid without the markup. Twice weekly to start, moisturizer on top.',
        code: 'Drugstore, ~$13',
      },
      {
        mark: 'M',
        product: 'Minoxidil 5% foam',
        brand: 'Rogaine',
        kind: 'OTC treatment',
        why: 'For thinning at the part line. Six months before you judge it.',
        code: 'Generic is identical',
      },
    ],
  },
  {
    key: 'joints',
    label: 'Joints & mobility',
    system: 'Musculoskeletal',
    side: 'left',
    y: '82%',
    tint: 'var(--accent-2)',
    quiet: 'var(--accent-2-quiet)',
    note: 'Knees, back, plantar fasciitis. Motion is the medicine; these make motion tolerable.',
    items: [
      {
        mark: 'P',
        product: 'Physical therapy, direct access',
        brand: 'Union Memorial PT',
        kind: 'Service',
        why: 'You can self-refer in Maryland. Go before you Google.',
        code: 'BHW patients seen in 1 week',
      },
      {
        mark: 'I',
        product: 'Hinged knee sleeve',
        brand: 'Bauerfeind GenuTrain',
        kind: 'Device',
        why: 'Worth the money if stairs are the problem. Get sized.',
        code: 'CODE: BHWMOVE',
      },
      {
        mark: 'T',
        product: 'Topical diclofenac gel',
        brand: 'Voltaren',
        kind: 'OTC treatment',
        why: 'Real anti-inflammatory, skips the stomach. Four times a day, actually.',
        code: 'OTC, no code',
      },
    ],
  },
]

export interface Handout {
  title: string
  topic: string
  pages: string
  href?: string
}

export const HANDOUTS: Handout[] = [
  { title: 'Starting an SSRI: the first six weeks', topic: 'Mind & Mood', pages: '2 pages' },
  { title: 'GLP-1 medications: side effects and what helps', topic: 'Flow', pages: '3 pages' },
  { title: 'Home blood pressure log', topic: 'Primary Care', pages: '1 page' },
  { title: 'Low-FODMAP starter guide', topic: 'Gut', pages: '4 pages' },
  { title: 'Sleep reset in 14 days', topic: 'Mind & Mood', pages: '2 pages' },
  { title: 'Perimenopause symptom tracker', topic: 'Hormones', pages: '1 page' },
]

export interface CommunityResource {
  tag: string
  tint: string
  name: string
  body: string
  cta: string
  href?: string
}

export const COMMUNITY: CommunityResource[] = [
  {
    tag: 'Crisis',
    tint: 'var(--danger)',
    name: 'Baltimore Crisis Response',
    body: '24/7 phone and mobile crisis team, (410) 433-5175. They come to you.',
    cta: 'Call or read more',
  },
  {
    tag: 'Food',
    tint: 'var(--accent)',
    name: 'Maryland Food Bank finder',
    body: 'Pantries and hot meals by ZIP code, updated weekly.',
    cta: 'Find food near you',
  },
  {
    tag: 'Housing',
    tint: 'var(--accent-2)',
    name: 'Baltimore City Housing Help',
    body: 'Rent assistance, eviction prevention, and utility grants.',
    cta: 'See what you qualify for',
  },
  {
    tag: 'Transport',
    tint: 'var(--accent-3)',
    name: 'Rides to appointments',
    body: 'MTA Mobility and our own patient ride fund for visits over 2 miles.',
    cta: 'Ask the front desk',
  },
  {
    tag: 'Recovery',
    tint: 'var(--brand-clay)',
    name: 'Substance use support',
    body: 'Same-week MAT access and local peer recovery groups.',
    cta: 'See options',
  },
  {
    tag: 'Insurance',
    tint: 'var(--fg-muted)',
    name: 'Maryland Health Connection',
    body: 'Enrollment help, Medicaid checks, and our sliding-scale application.',
    cta: 'Get enrolled',
  },
]
