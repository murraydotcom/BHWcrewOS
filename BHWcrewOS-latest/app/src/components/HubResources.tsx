import type { HubResource } from '../lib/useHubContent'
import styles from './HubResources.module.css'

interface HubResourcesProps {
  resources: HubResource[]
}

/**
 * Forms, handouts and PDFs the practice publishes from the Care Connect Hub
 * Content database. Renders nothing until there's at least one active resource,
 * so an empty database leaves the hub unchanged.
 */
export function HubResources({ resources }: HubResourcesProps) {
  if (!resources.length) return null

  return (
    <section className={styles.section} aria-labelledby="hub-resources-title">
      <h2 className={styles.head} id="hub-resources-title">
        Forms &amp; resources
      </h2>
      <p className={styles.sub}>
        Paperwork, handouts and links your care team wants you to have — grab what you need.
      </p>
      <div className={styles.grid}>
        {resources.map((r) => {
          const inner = (
            <>
              <div className={styles.cardTop}>
                {r.tag ? <span className={styles.tag}>{r.tag}</span> : <span />}
                <span className={styles.icon} aria-hidden="true">
                  ↓
                </span>
              </div>
              <h3 className={styles.title}>{r.title || 'Resource'}</h3>
              {r.body ? <p className={styles.body}>{r.body}</p> : null}
              {r.url ? <span className={styles.open}>Open →</span> : null}
            </>
          )
          return r.url ? (
            <a
              key={`${r.title}-${r.url}`}
              className={styles.card}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {inner}
            </a>
          ) : (
            <div key={r.title} className={styles.card}>
              {inner}
            </div>
          )
        })}
      </div>
    </section>
  )
}
