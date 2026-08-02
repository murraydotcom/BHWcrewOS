import type { CSSProperties } from 'react'
import { CONTACT } from '../data/contact'
import { ER_ITEMS, URGENT_CARE_ITEMS } from '../data/erUrgentCare'
import styles from './ErOrUrgentCare.module.css'

export function ErOrUrgentCare() {
  return (
    <section className={styles.section} aria-labelledby="er-urgent-title">
      <p className={styles.eyebrow}>Where to go</p>
      <h3 className={styles.title} id="er-urgent-title">
        ER or urgent care?
      </h3>
      <p className={styles.lede}>
        When you can’t wait for us and you’re not sure which door to walk through. When in doubt,
        choose the ER.
      </p>

      <div className={styles.columns}>
        <Column
          tint="var(--danger)"
          eyebrow="Emergency room · call 911"
          title="Go now, don’t drive yourself"
          note="Anything that could threaten life, limb, or eyesight."
          items={ER_ITEMS}
        />
        <Column
          tint="var(--accent-2)"
          eyebrow="Urgent care · walk in"
          title="Needs today, not an emergency"
          note="Send us a note afterward so it lands in your chart."
          items={URGENT_CARE_ITEMS}
        />
      </div>

      <p className={styles.footnote}>
        Still unsure? Call {CONTACT.phone} during office hours, or press 1 after hours to reach the
        on-call clinician.
      </p>
    </section>
  )
}

interface ColumnProps {
  tint: string
  eyebrow: string
  title: string
  note: string
  items: string[]
}

function Column({ tint, eyebrow, title, note, items }: ColumnProps) {
  return (
    <div className={styles.card} style={{ '--card-tint': tint } as CSSProperties}>
      <p className={styles.cardEyebrow}>{eyebrow}</p>
      <h4 className={styles.cardTitle}>{title}</h4>
      <p className={styles.cardNote}>{note}</p>
      <ul className={styles.list}>
        {items.map((item) => (
          <li className={styles.item} key={item}>
            <span className={styles.dot} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
