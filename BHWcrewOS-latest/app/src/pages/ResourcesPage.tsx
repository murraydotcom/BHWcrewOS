import type { CSSProperties } from 'react'
import { BodyMap } from '../components/resources/BodyMap'
import { CrisisStrip } from '../components/CrisisStrip'
import { COMMUNITY, HANDOUTS } from '../data/resources'
import styles from './ResourcesPage.module.css'

interface ResourcesPageProps {
  onBack: () => void
}

export function ResourcesPage({ onBack }: ResourcesPageProps) {
  return (
    <main className="page" id="main">
      <div className={styles.backRow}>
        <button type="button" className={styles.back} onClick={onBack}>
          ← Back to Care Connect
        </button>
      </div>

      <section className={styles.hero} aria-labelledby="resources-title">
        <p className={`${styles.eyebrow} ${styles.heroEyebrow}`}>Resource library</p>
        <h1 className={styles.heroTitle} id="resources-title">
          Everything we'd otherwise write on the back of a card
        </h1>
        <p className={styles.heroBody}>
          Community help in Baltimore, handouts you can print, and NP Am's own shortlist of brands,
          products and services — organized by the part of you it's for.
        </p>
      </section>

      <section className={styles.askSection} aria-labelledby="ask-np-am-title">
        <div className={styles.askHead}>
          <div>
            <p className={styles.script} aria-hidden="true">
              Ask NP Am
            </p>
            <h2 className={styles.askTitle} id="ask-np-am-title">
              <span className="srOnly">Ask NP Am — </span>
              Point at what's bothering you.
            </h2>
          </div>
          <p className={styles.askHint}>
            Pick a spot on the diagram and NP Am's picks for that system come up.
          </p>
        </div>

        <BodyMap />
      </section>

      <section className={styles.section} aria-labelledby="handouts-title">
        <p className={styles.eyebrow}>Education library</p>
        <h2 className={styles.sectionTitle} id="handouts-title">
          Handouts worth printing
        </h2>
        <div className={styles.handouts}>
          {HANDOUTS.map((handout) => (
            <div className={styles.handout} key={handout.title}>
              <span className={styles.pdfMark} aria-hidden="true">
                PDF
              </span>
              <div className={styles.handoutBody}>
                <p className={styles.handoutTitle}>{handout.title}</p>
                <p className={styles.handoutMeta}>
                  {handout.topic} · {handout.pages}
                </p>
              </div>
              {handout.href ? (
                <a className={styles.download} href={handout.href} download>
                  Download
                </a>
              ) : (
                <span className={styles.download}>Download</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="community-title">
        <p className={styles.eyebrow}>Community resources</p>
        <h2 className={styles.sectionTitle} id="community-title">
          Baltimore help beyond our four walls
        </h2>
        <div className={styles.community}>
          {COMMUNITY.map((resource) => (
            <div
              className={styles.communityCard}
              key={resource.name}
              style={{ '--community-tint': resource.tint } as CSSProperties}
            >
              <span className={styles.communityTag}>{resource.tag}</span>
              <p className={styles.communityName}>{resource.name}</p>
              <p className={styles.communityBody}>{resource.body}</p>
              {resource.href ? (
                <a className={styles.communityCta} href={resource.href}>
                  {resource.cta}
                </a>
              ) : (
                <p className={styles.communityCta}>{resource.cta}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <CrisisStrip variant="resources" />
    </main>
  )
}
