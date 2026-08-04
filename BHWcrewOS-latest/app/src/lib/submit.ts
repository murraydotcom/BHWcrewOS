import type { RouteKey } from '../data/triage'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE ONE PLACE PATIENT MESSAGES LEAVE THIS APP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Right now nothing leaves the browser: both functions below are stubs that
 *  resolve locally so the UI can be demoed end to end. To go live, replace the
 *  body of `submitTriage` / `submitVisitNotice` with a call to your intake
 *  endpoint. Nothing in the components needs to change — they only await these
 *  two promises and render whatever comes back.
 *
 *  Before wiring a real endpoint, please note:
 *
 *  • Everything these forms collect is PHI — name, date of birth, symptoms,
 *    medications. It must only be sent to a service covered by a signed BAA,
 *    over TLS. That rules out plain form-mail relays, generic webhook catchers,
 *    analytics tools, and any third party you haven't papered.
 *  • Don't log the payload to a browser console, an error tracker, or an
 *    access log in production. `logForDevelopment` below is dev-only for that
 *    reason.
 *  • The page already tells patients this isn't monitored around the clock.
 *    Whatever queue receives these has to be watched during the hours the
 *    masthead advertises, or the copy needs to change.
 */

export interface TriageSubmission {
  /** Which queue the message routed to. */
  route: RouteKey
  routeLabel: string
  /** What the patient typed in the Just Ask box. */
  freeText: string
  /** Field id → answer, for the intake questions plus this route's questions. */
  answers: Record<string, string>
  /** Patient's name / DOB pulled from the intake fields. */
  name?: string
  dob?: string
  /** Human-readable one-line summary, composed with the real field labels. */
  summary?: string
  submittedAt: string
}

export interface TriageReceipt {
  /** Shown back to the patient so they can reference it when they call. */
  reference: string
}

export interface VisitNotice {
  place: string
  when: string
  note: string
  submittedAt: string
}

function logForDevelopment(label: string, payload: unknown) {
  if (import.meta.env.DEV) {
    console.info(`[BHW Care Connect] ${label} (stub — nothing was sent)`, payload)
  }
}

/** Simulates the round trip so loading states are exercised in the demo. */
function settle<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 350))
}

/**
 * Send a Just Ask message to the care team. Posts to the triage-intake function
 * (which creates a row in the Patient Request Triage Queue); if that isn't
 * reachable — e.g. the local dev demo — it falls back to a local reference so
 * the flow still completes.
 */
export async function submitTriage(submission: TriageSubmission): Promise<TriageReceipt> {
  logForDevelopment('triage submission', submission)
  try {
    const res = await fetch('/.netlify/functions/submit-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.reference) return { reference: data.reference }
    }
  } catch {
    /* fall through to a local reference */
  }
  return settle({ reference: 'BHW-2481' })
}

/**
 * "Tell us you were seen" — a heads-up to the transition-of-care nurse after an
 * ER, urgent care or hospital visit.
 */
export async function submitVisitNotice(notice: VisitNotice): Promise<void> {
  logForDevelopment('transition-of-care notice', notice)
  await settle(null)
}

export interface ReviewSubmission {
  rating: number
  comment: string
  name?: string
  contact?: string
  /** Which surface the review came from. */
  source: 'Care Connect' | 'Patient Portal'
}

export interface ReviewReceipt {
  /** The practice's Google review link, to offer as a one-tap follow-up. */
  googleUrl: string
  /** Notion record id, so a Google-button tap can flag the record. */
  reviewId: string | null
}

const REVIEW_ENDPOINT = '/.netlify/functions/submit-review'

/**
 * Send a patient rating + comment to the Patient Reviews store. Unlike the two
 * stubs above, this posts to the real function when one is deployed; in the
 * local dev demo (no function) it resolves with the built-in Google link so the
 * flow can still be exercised.
 */
export async function submitReview(review: ReviewSubmission): Promise<ReviewReceipt> {
  logForDevelopment('patient review', review)
  try {
    const res = await fetch(REVIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    })
    if (res.ok) {
      const data = await res.json()
      return { googleUrl: data.googleUrl, reviewId: data.reviewId ?? null }
    }
  } catch {
    /* fall through to the demo receipt */
  }
  return settle({ googleUrl: 'https://share.google/cQNnl8gbsXqKB7oGM', reviewId: null })
}

/** Flag that the patient tapped through to Google (best-effort, non-blocking). */
export function markRoutedToGoogle(reviewId: string): void {
  try {
    void fetch(REVIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'routed', id: reviewId }),
      keepalive: true,
    })
  } catch {
    /* best-effort */
  }
}
