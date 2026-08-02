import styles from './ResourcesPromo.module.css'

const ROWS = [
  { label: 'Ask NP Am recommendations', value: '32 picks' },
  { label: 'Education handouts (PDF)', value: '18 files' },
  { label: 'Baltimore community resources', value: 'Food, housing, crisis' },
  { label: 'Insurance & sliding scale', value: 'How it works' },
]

interface ResourcesPromoProps {
  onOpenResources: () => void
}

export function ResourcesPromo({ onOpenResources }: ResourcesPromoProps) {
  return (
    <section className={styles.promo} aria-labelledby="resources-promo-title">
      <div>
        <p className={styles.script} aria-hidden="true">
          Ask NP Am
        </p>
        <h3 className={styles.title} id="resources-promo-title">
          <span className="srOnly">Ask NP Am — </span>
          Community help, handouts, and the picks she stands behind
        </h3>
        <p className={styles.body}>
          Baltimore resources, education PDFs, and the products and services NP Am actually
          recommends — sorted by body system, discount codes included.
        </p>
        <button type="button" className={styles.cta} onClick={onOpenResources}>
          Open the resource library
        </button>
      </div>

      <div className={styles.list}>
        {ROWS.map((row) => (
          <div className={styles.row} key={row.label}>
            <span className={styles.rowLabel}>{row.label}</span>
            <span className={styles.rowValue}>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
