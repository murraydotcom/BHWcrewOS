/** Office announcements — listed in the masthead, not hidden behind a button. */
export interface Announcement {
  tag: string
  tint: string
  date: string
  title: string
  body: string
}

export const NEWS: Announcement[] = [
  {
    tag: 'Hours',
    tint: 'var(--warning)',
    date: 'Jul 30',
    title: 'Friday hours move to 8:30–1:00 starting August 7',
    body: 'Friday afternoons become telehealth-only. Existing appointments are unaffected — we’ll call if anything shifts.',
  },
  {
    tag: 'Blueprint',
    tint: 'var(--accent)',
    date: 'Jul 22',
    title: 'Lab results now post to your Health Blueprint in 24 hours',
    body: 'You may see a result before we’ve reviewed it. If something looks alarming, message us before you spiral — that’s what we’re for.',
  },
  {
    tag: 'Staff',
    tint: 'var(--accent-3)',
    date: 'Jul 14',
    title: 'Welcome Dana Reyes, LCSW-C to CharmEd Minds',
    body: 'Now taking new therapy patients, Tuesdays through Fridays, in person and virtual.',
  },
]
