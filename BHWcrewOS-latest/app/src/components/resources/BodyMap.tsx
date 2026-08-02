import { useId, useState, type CSSProperties } from 'react'
import { config } from '../../config'
import { REGIONS, type Region } from '../../data/resources'
import styles from './BodyMap.module.css'

const SIDE_CLASS = {
  left: styles.regionLeft,
  right: styles.regionRight,
  top: styles.regionTop,
} as const

/**
 * Ask NP Am body map — point at what's bothering you and that system's picks
 * come up. The figure is a placeholder; drop in the real illustration and the
 * label pills keep working (they anchor to the card edges, not the drawing).
 */
export function BodyMap() {
  const [activeKey, setActiveKey] = useState(REGIONS[0].key)
  const panelId = useId()
  const active = REGIONS.find((region) => region.key === activeKey) ?? REGIONS[0]

  return (
    <div className={styles.layout}>
      <div className={styles.mapPanel}>
        <p className={styles.eyebrow}>Body map</p>
        <div className={styles.figure}>
          <svg viewBox="0 0 120 300" width="150" height="440" aria-hidden="true">
            <g fill="var(--bg-muted)" stroke="var(--border-strong)" strokeWidth="1">
              <circle cx="60" cy="26" r="19" />
              <rect x="52" y="45" width="16" height="11" rx="5" />
              <path d="M38 58 q22 -8 44 0 l6 62 q-28 8 -56 0 z" />
              <path d="M38 60 l-16 12 -8 56 q6 4 11 0 l7 -48 12 -10 z" />
              <path d="M82 60 l16 12 8 56 q-6 4 -11 0 l-7 -48 -12 -10 z" />
              <path d="M42 120 q18 6 36 0 l4 34 q-22 6 -44 0 z" />
              <path d="M44 154 l-2 70 3 60 q7 3 12 0 l-1 -60 4 -66 z" />
              <path d="M76 154 l2 70 -3 60 q-7 3 -12 0 l1 -60 -4 -66 z" />
            </g>
          </svg>

          {REGIONS.map((region) => (
            <button
              key={region.key}
              type="button"
              className={`${styles.region} ${SIDE_CLASS[region.side]}`}
              style={
                { '--region-y': region.y, '--region-tint': region.tint } as CSSProperties
              }
              aria-pressed={region.key === activeKey}
              aria-controls={panelId}
              onClick={() => setActiveKey(region.key)}
            >
              <span className={styles.regionDot} aria-hidden="true" />
              {region.label}
            </button>
          ))}
        </div>
        <p className={styles.figureNote}>
          Placeholder figure — drop in the real illustration when you have it.
        </p>
      </div>

      <RecommendationPanel region={active} id={panelId} />
    </div>
  )
}

interface RecommendationPanelProps {
  region: Region
  id: string
}

function RecommendationPanel({ region, id }: RecommendationPanelProps) {
  return (
    <div className={styles.listPanel} id={id} aria-live="polite">
      <div
        className={styles.listHead}
        style={{ '--region-quiet': region.quiet } as CSSProperties}
      >
        <p className={styles.eyebrow}>{region.system}</p>
        <h3 className={styles.listTitle}>{region.label}</h3>
        <p className={styles.listNote}>{region.note}</p>
      </div>

      {region.items.map((item) => (
        <div className={styles.item} key={`${region.key}-${item.product}`}>
          <span className={styles.mark} aria-hidden="true">
            {item.mark}
          </span>
          <div className={styles.itemBody}>
            <div className={styles.itemHead}>
              <p className={styles.product}>{item.product}</p>
              <p className={styles.brand}>
                {item.brand} · {item.kind}
              </p>
            </div>
            <p className={styles.why}>{item.why}</p>
            <div className={styles.itemFoot}>
              {config.showAffiliateCodes && <span className={styles.code}>{item.code}</span>}
              {item.href ? (
                <a className={styles.visit} href={item.href} rel="nofollow sponsored noopener">
                  Visit →
                </a>
              ) : (
                <span className={styles.visit}>Visit →</span>
              )}
            </div>
          </div>
        </div>
      ))}

      <p className={styles.disclosure}>
        Some links are affiliate or discount partnerships. They never change what we recommend, and
        nothing here replaces your clinician's advice.
      </p>
    </div>
  )
}
