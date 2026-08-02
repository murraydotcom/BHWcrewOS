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
 * Send a Just Ask message to the care team.
 * Replace the stub with your real POST; return the reference the queue assigns.
 */
export async function submitTriage(submission: TriageSubmission): Promise<TriageReceipt> {
  logForDevelopment('triage submission', submission)
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
