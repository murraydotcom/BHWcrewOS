/**
 * Just Ask — the free-text box routes what a patient types to one of six
 * queues, and the form below asks that queue's questions.
 *
 * Routing is keyword matching on purpose: it runs in the browser, it's
 * inspectable, and a wrong guess costs nothing because the route chips let
 * people override it. Never name the internal triage tool in patient-facing copy.
 */

export type RouteKey = 'refill' | 'clinical' | 'scheduling' | 'billing' | 'portal' | 'general'

export type FieldType = 'text' | 'area' | 'chips'

export interface Field {
  id: string
  label: string
  type: FieldType
  placeholder?: string
  options?: string[]
  /** grid-column value when the field should span the full form width. */
  span?: string
  help?: string
}

export interface Route {
  key: RouteKey
  label: string
  tint: string
  quiet: string
  sla: string
  /** Lowercase substrings; the route with the most hits wins. */
  words: string[]
  readout: string
  hint: string
  formTitle: string
  safety?: string
  fields: Field[]
}

/** Asked on every route, before the route-specific questions. */
export const INTAKE: Field[] = [
  { id: 'name', label: 'Your full name', type: 'text', placeholder: 'As it appears on your chart' },
  { id: 'dob', label: 'Date of birth', type: 'text', placeholder: 'MM / DD / YYYY' },
  {
    id: 'blueprint',
    label: 'Do you have access to your Personal Health Blueprint?',
    type: 'chips',
    span: '1 / -1',
    options: ['Yes, I’m in', 'I have one, can’t get in', 'I don’t have one yet', 'Not sure what that is'],
  },
]

export const ROUTES: Route[] = [
  {
    key: 'refill',
    label: 'Refill',
    tint: 'var(--accent)',
    quiet: 'var(--accent-quiet)',
    sla: 'By next business day',
    words: [
      'refill', 'refil', 'out of', 'runs out', 'ran out', 'pharmacy', 'prescription',
      'rx', 'script', 'renew', 'pills', 'dose left',
    ],
    readout: 'Refill request.',
    hint: 'Goes to the prescribing clinician’s refill queue.',
    formTitle: 'Let’s get the refill moving',
    fields: [
      { id: 'med', label: 'Which medication?', type: 'text', placeholder: 'Name and strength if you know it' },
      { id: 'pharmacy', label: 'Pharmacy', type: 'text', placeholder: 'CVS Fort Ave, Giant Canton…' },
      {
        id: 'left',
        label: 'How many days do you have left?',
        type: 'chips',
        options: ['None', '1–3 days', 'About a week', 'More than a week'],
      },
      {
        id: 'notes',
        label: 'Anything we should know?',
        type: 'area',
        span: '1 / -1',
        placeholder: 'Dose changed, side effects, insurance switched…',
      },
    ],
  },
  {
    key: 'clinical',
    label: 'Symptom or side effect',
    tint: 'var(--accent-3)',
    quiet: 'var(--accent-3-quiet)',
    sla: 'Reviewed same day',
    words: [
      'side effect', 'symptom', 'pain', 'dizzy', 'nausea', 'rash', 'sleep', 'anxious',
      'anxiety', 'depressed', 'worse', 'tired', 'headache', 'bleeding', 'swelling', 'sick', 'fever',
    ],
    readout: 'Clinical question.',
    hint: 'A clinician reads this one, not the front desk.',
    formTitle: 'Tell us what your body is doing',
    safety:
      'If this is chest pain, trouble breathing, a severe reaction, or thoughts of harming yourself — stop here and call 911 or 988. Don’t wait on a message.',
    fields: [
      {
        id: 'what',
        label: 'What are you noticing?',
        type: 'area',
        span: '1 / -1',
        placeholder: 'In your own words — no medical vocabulary required',
      },
      {
        id: 'since',
        label: 'Since when?',
        type: 'chips',
        options: ['Today', 'A few days', 'A couple of weeks', 'Longer'],
      },
      {
        id: 'sev',
        label: 'How bad is it right now?',
        type: 'chips',
        options: ['Annoying', 'Hard to ignore', 'Scaring me'],
      },
      {
        id: 'med',
        label: 'Started or changed any medication recently?',
        type: 'text',
        placeholder: 'Name and when it changed',
      },
    ],
  },
  {
    key: 'scheduling',
    label: 'Appointment',
    tint: 'var(--accent-2)',
    quiet: 'var(--accent-2-quiet)',
    sla: 'Front desk, same day',
    words: [
      'appointment', 'appt', 'schedule', 'reschedule', 'cancel', 'move my', 'book',
      'visit', 'come in', 'earlier', 'sooner',
    ],
    readout: 'Scheduling.',
    hint: 'Front desk will find you a slot.',
    formTitle: 'When would you like to be seen?',
    fields: [
      {
        id: 'kind',
        label: 'What kind of visit?',
        type: 'chips',
        options: ['New concern', 'Follow-up', 'Annual physical', 'Therapy', 'Not sure'],
      },
      {
        id: 'mode',
        label: 'In person or telehealth?',
        type: 'chips',
        options: ['In person', 'Telehealth', 'Either'],
      },
      {
        id: 'when',
        label: 'Days and times that work',
        type: 'text',
        span: '1 / -1',
        placeholder: 'Mornings before 10, or any Thursday…',
      },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    tint: 'var(--brand-clay)',
    quiet: 'var(--gold-quiet)',
    sla: '2 business days',
    words: [
      'bill', 'billing', 'charge', 'charged', 'invoice', 'statement', 'insurance',
      'copay', 'co-pay', 'deductible', 'cost', 'price', 'owe', 'claim',
    ],
    readout: 'Billing question.',
    hint: 'Goes to our billing coordinator, not your clinician.',
    formTitle: 'Let’s look at the bill with you',
    fields: [
      { id: 'date', label: 'Date of the visit or statement', type: 'text', placeholder: 'Roughly is fine' },
      { id: 'amount', label: 'Amount in question', type: 'text', placeholder: '$' },
      {
        id: 'what',
        label: 'What doesn’t look right?',
        type: 'area',
        span: '1 / -1',
        placeholder: 'Charged twice, insurance not applied, never got a statement…',
      },
    ],
  },
  {
    key: 'portal',
    label: 'Blueprint access',
    tint: 'var(--accent-2)',
    quiet: 'var(--accent-2-quiet)',
    sla: 'Usually fixed same day',
    words: [
      'blueprint', 'portal', 'login', 'log in', 'password', 'locked out', 'can’t get in',
      "can't get in", 'cant get in', 'sign in', 'reset', 'code never', 'account', 'username',
    ],
    readout: 'Health Blueprint access.',
    hint: 'We can reset it from our side in a few minutes.',
    formTitle: 'Let’s get you back into your Blueprint',
    fields: [
      {
        id: 'stuck',
        label: 'Where does it get stuck?',
        type: 'chips',
        options: ['Password won’t work', 'Never got the code', 'No account yet', 'Locked out'],
      },
      { id: 'email', label: 'Email on the account', type: 'text', placeholder: 'The one you think we have' },
      { id: 'device', label: 'Phone or computer?', type: 'chips', options: ['Phone', 'Computer', 'Both'] },
    ],
  },
  {
    key: 'general',
    label: 'Something else',
    tint: 'var(--fg-muted)',
    quiet: 'var(--bg-muted)',
    sla: 'One business day',
    words: [],
    readout: 'We’ll route it.',
    hint: 'Start typing and we’ll aim it at the right person.',
    formTitle: 'Tell us who you are and what you need',
    fields: [
      {
        id: 'what',
        label: 'What do you need?',
        type: 'area',
        span: '1 / -1',
        placeholder: 'Records request, form to fill out, a question about a program…',
      },
      {
        id: 'who',
        label: 'Anyone here you’ve already talked to?',
        type: 'text',
        placeholder: 'Name, if you remember it',
      },
    ],
  },
]

/** The fallback when nothing matches — "Something else". */
export const FALLBACK_ROUTE = ROUTES[ROUTES.length - 1]

export const CHIPS = [
  'Refill',
  'A side effect worries me',
  'Move my appointment',
  'A bill I don’t understand',
  'Blueprint won’t let me in',
]

/**
 * Pick the route with the most keyword hits. Returns null for empty input so the
 * caller can fall back to "Something else" without the readout looking confident.
 */
export function detectRoute(text: string): Route | null {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  let best: Route | null = null
  let score = 0
  for (const route of ROUTES) {
    const hits = route.words.filter((word) => t.includes(word)).length
    if (hits > score) {
      score = hits
      best = route
    }
  }
  return best
}

/** Shown after submitting — the three things that usually resolve it first. */
export const SELF_HELP: Record<RouteKey, Array<{ title: string; body: string }>> = {
  refill: [
    {
      title: 'Check your Blueprint first',
      body: 'Refills already sent show under Medications → Recent activity. Pharmacies often have it before they tell you.',
    },
    {
      title: 'Out today?',
      body: 'Most pharmacies can give a 3-day emergency supply on a lapsed maintenance med. Ask at the counter while we process this.',
    },
    {
      title: 'Controlled medications',
      body: 'Stimulants and benzodiazepines can’t be phoned in early — these need a visit if you’re outside the window.',
    },
  ],
  clinical: [
    {
      title: 'Get worse fast? Don’t wait on us',
      body: 'Chest pain, trouble breathing, a spreading rash, or thoughts of harming yourself: 911 or 988, now.',
    },
    {
      title: 'Write down the pattern',
      body: 'Time of day, what you’d eaten, what you’d taken. Two days of notes changes what we can do for you.',
    },
    {
      title: 'Side effect in the first two weeks',
      body: 'Many settle. Don’t stop a psychiatric medication cold — message us and we’ll adjust together.',
    },
  ],
  scheduling: [
    {
      title: 'Open slots live in your Blueprint',
      body: 'Appointments → Schedule shows real availability, including cancellations, before we can call you back.',
    },
    {
      title: 'Need sooner than what’s listed?',
      body: 'We hold two same-week slots for established patients. Say so in the box above and we’ll look.',
    },
    {
      title: 'Running late',
      body: 'Under 10 minutes we’ll usually still see you. Call the front desk rather than guessing.',
    },
  ],
  billing: [
    {
      title: 'Statements are in your Blueprint',
      body: 'Billing → Statements has the itemized version, which is usually clearer than the mailed one.',
    },
    {
      title: 'Insurance still processing?',
      body: 'Claims can take 30–45 days. A balance that looks wrong this month is often just early.',
    },
    {
      title: 'Cost is the problem',
      body: 'Ask about our sliding scale. It exists, it’s not a hassle, and nobody judges you for using it.',
    },
  ],
  portal: [
    {
      title: 'Try the reset link once more',
      body: 'The code expires in 15 minutes and lands in spam more often than it should.',
    },
    {
      title: 'Use the email we have on file',
      body: 'Not a newer one. If you’ve changed it, tell us above and we’ll update the account.',
    },
    {
      title: 'Never set one up?',
      body: 'We’ll send a fresh invite today — it takes about four minutes on a phone.',
    },
  ],
  general: [
    {
      title: 'Forms and records',
      body: 'Most records requests are self-serve in your Blueprint under Documents.',
    },
    {
      title: 'Program questions',
      body: 'The four program cards on this page cover who each one is for and what a first visit looks like.',
    },
    {
      title: 'Still not sure who to ask?',
      body: 'That’s fine — send it. Routing it is our job, not yours.',
    },
  ],
}
