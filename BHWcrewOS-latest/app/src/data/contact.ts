/**
 * Every place the practice's real-world details appear. Change them here.
 */
export const CONTACT = {
  practice: 'BHW Medical Group',
  brand: 'Baltimore Healthcare & Wellness',
  street: '2131 Maryland Ave',
  cityStateZip: 'Baltimore, MD 21218',
  phone: '443.762.5343',
  phoneHref: 'tel:+14437625343',
  fax: '833.258.3941',
  hours: 'Mon–Thu 8:30–5:00 · Fri 8:30–1:00',
  frontDeskHours: '8:30–4:30',
  /** Shown in the masthead status pill. Wire to real hours when there's a source for it. */
  openStatus: 'Open now · until 5:00',
  /** Date stamp above the announcement list. */
  newsUpdated: 'From the office · updated Jul 30',
  crisisLine: '988',
  baltimoreCrisisResponse: '(410) 433-5175',
  /**
   * The Personal Health Blueprint — never call it a patient portal.
   * Wired to the BHWcrewOS patient app (served alongside Care Connect at root).
   */
  blueprintUrl: 'bhw-patient-portal-mockup.html',
  /** BHW staff / provider console (CrewCare). */
  providerUrl: 'bhw-crewcare-portal.html',
} as const
