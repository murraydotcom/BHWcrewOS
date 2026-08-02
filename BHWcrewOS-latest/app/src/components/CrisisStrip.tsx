import { CONTACT } from '../data/contact'
import styles from './CrisisStrip.module.css'

interface CrisisStripProps {
  /** The hub and the resource library sit at different distances from what's above them. */
  variant: 'hub' | 'resources'
}

export function CrisisStrip({ variant }: CrisisStripProps) {
  return (
    <div className={`${styles.strip} ${styles[variant]}`}>
      <span className={styles.bar} aria-hidden="true" />
      {variant === 'hub' ? (
        <p className={styles.text}>
          <strong>Crisis or emergency:</strong> call 911, or {CONTACT.crisisLine} for the Suicide
          &amp; Crisis Lifeline. After hours, call{' '}
          <a href={CONTACT.phoneHref}>{CONTACT.phone}</a> and press 1 — that pages the on-call
          clinician, not a voicemail box.
        </p>
      ) : (
        <p className={styles.text}>
          <strong>Crisis or emergency:</strong> call 911, or {CONTACT.crisisLine} for the Suicide
          &amp; Crisis Lifeline. Baltimore Crisis Response: {CONTACT.baltimoreCrisisResponse}.
        </p>
      )}
    </div>
  )
}
