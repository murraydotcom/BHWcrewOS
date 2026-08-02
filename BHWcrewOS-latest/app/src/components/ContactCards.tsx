import { CONTACT } from '../data/contact'
import styles from './ContactCards.module.css'

/** The three "rather do it another way" doors, then hours and address. */
export function ContactCards() {
  return (
    <>
      <section className={styles.cards} aria-label="Other ways to reach us">
        <div className={styles.card}>
          <p className={styles.eyebrow}>Rather talk</p>
          <p className={styles.value}>
            <a href={CONTACT.phoneHref}>{CONTACT.phone}</a>
          </p>
          <p className={styles.detail}>
            Front desk, {CONTACT.frontDeskHours}. Fax {CONTACT.fax}.
          </p>
        </div>

        <div className={styles.card}>
          <p className={styles.eyebrow}>Rather text</p>
          <p className={styles.value}>
            <a href={`sms:+1${CONTACT.phone.replace(/\D/g, '')}`}>Text {CONTACT.phone}</a>
          </p>
        </div>

        <div className={styles.card}>
          <p className={styles.eyebrow}>Rather look it up yourself</p>
          <p className={styles.value}>
            <a href={CONTACT.blueprintUrl}>Health Blueprint</a>
          </p>
        </div>
      </section>

      <div className={styles.hours}>
        <span>
          <strong>Mon–Thu</strong> 8:30–5:00 · <strong>Fri</strong> 8:30–1:00
        </span>
        <span>
          {CONTACT.street}, {CONTACT.cityStateZip}
        </span>
      </div>
    </>
  )
}
