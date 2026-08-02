/**
 * The two knobs that were "Tweaks" in the design prototype. Defaults match the
 * design the practice signed off on.
 */

/** Announcement box treatment in the masthead. */
export type AnnouncementStyle = 'sage' | 'violet' | 'card' | 'stone' | 'gold' | 'blue'

export const config = {
  /** Soft sage with a tinted edge — the chosen default. */
  announcementStyle: 'sage' as AnnouncementStyle,
  /** Show the partner discount codes on Ask NP Am recommendations. */
  showAffiliateCodes: true,
}
