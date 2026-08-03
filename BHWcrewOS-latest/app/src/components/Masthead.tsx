import type { CSSProperties } from 'react'
import { bhwLockup } from '../assets'
import { config, type AnnouncementStyle } from '../config'
import { CONTACT } from '../data/contact'
import { NEWS, type Announcement } from '../data/news'
import styles from './Masthead.module.css'

interface MastheadProps {
  /** Live announcements from Notion; falls back to the built-in defaults when empty. */
  announcements?: Announcement[]
}

/** The five alternate treatments the practice reviewed, plus the sage default. */
const NEWS_SKIN: Record<AnnouncementStyle, CSSProperties> = {
  sage: {
    '--news-bg': 'var(--accent-quiet)',
    '--news-border': '1px solid var(--accent-tint)',
    '--news-shadow': 'var(--shadow-sm)',
  },
  violet: {
    '--news-bg': 'var(--accent-3-quiet)',
    '--news-border': '1px solid var(--accent-3-tint)',
    '--news-shadow': 'var(--shadow-sm)',
  },
  card: {
    '--news-bg': 'var(--bg-elevated)',
    '--news-border': '1px solid var(--border)',
    '--news-shadow': 'var(--shadow-sm), var(--edge-gold)',
  },
  stone: {
    '--news-bg': 'var(--opal-stone)',
    '--news-border': '1px solid var(--border)',
    '--news-shadow': 'var(--shadow-sm), var(--edge-gold)',
  },
  gold: {
    '--news-bg': 'var(--warning-bg)',
    '--news-border': '1px solid transparent',
    '--news-shadow': 'none',
  },
  blue: {
    '--news-bg': 'var(--accent-2-quiet)',
    '--news-border': '1px solid var(--accent-2-tint)',
    '--news-shadow': 'none',
  },
} as Record<AnnouncementStyle, CSSProperties>

export function Masthead({ announcements }: MastheadProps = {}) {
  const skin = NEWS_SKIN[config.announcementStyle] ?? NEWS_SKIN.sage
  const news = announcements && announcements.length ? announcements : NEWS

  return (
    <section className={styles.masthead} aria-labelledby="masthead-title">
      <div>
        <img
          className={styles.lockup}
          src={bhwLockup}
          alt="BHW Medical Group — Healthcare Excellence, together"
        />
        <span className={styles.status}>{CONTACT.openStatus}</span>
        <h1 className={styles.title} id="masthead-title">
          BHW Care&nbsp;Connect
        </h1>
        <p className={styles.eyebrow}>{CONTACT.brand}</p>
        <p className={styles.intro}>
          Your one page for reaching your care team, finding a resource, or opening your Health
          Blueprint.
        </p>
      </div>

      <div className={styles.news} style={skin}>
        <div className={styles.newsHead}>
          <span className={styles.newsDot} aria-hidden="true" />
          <h2 className={styles.newsHeadLabel}>{CONTACT.newsUpdated}</h2>
        </div>

        {news.map((item) => (
          <article className={styles.item} key={`${item.date}-${item.title}`}>
            <div className={styles.itemMeta}>
              <p className={styles.itemTag} style={{ '--tag-tint': item.tint } as CSSProperties}>
                {item.tag}
              </p>
              <p className={styles.itemDate}>{item.date}</p>
            </div>
            <h3 className={styles.itemTitle}>{item.title}</h3>
            <p className={styles.itemBody}>{item.body}</p>
          </article>
        ))}

        {/* TODO: point at the announcement archive once there is one to point at. */}
        <button type="button" className={styles.older}>
          Older announcements
        </button>
      </div>
    </section>
  )
}
