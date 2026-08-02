import { useState, type CSSProperties } from 'react'
import { DARK_SURFACE, LIGHT_SURFACE, PROGRAMS, type Program } from '../data/programs'
import type { Theme } from '../lib/useTheme'
import styles from './ProgramCards.module.css'

interface ProgramCardsProps {
  theme: Theme
}

export function ProgramCards({ theme }: ProgramCardsProps) {
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => setFlipped((current) => ({ ...current, [key]: !current[key] }))

  return (
    <section className={styles.section} aria-labelledby="programs-title">
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Our programs</p>
          <h3 className={styles.title} id="programs-title">
            The four programs your care might live in
          </h3>
        </div>
        <p className={styles.hint}>Tap a card to see what happens at a first visit.</p>
      </div>

      <div className={styles.grid}>
        {PROGRAMS.map((program) => (
          <ProgramCard
            key={program.key}
            program={program}
            theme={theme}
            flipped={Boolean(flipped[program.key])}
            onFlip={() => toggle(program.key)}
          />
        ))}
      </div>
    </section>
  )
}

interface ProgramCardProps {
  program: Program
  theme: Theme
  flipped: boolean
  onFlip: () => void
}

function ProgramCard({ program, theme, flipped, onFlip }: ProgramCardProps) {
  const dark = theme === 'dark'
  const surface = dark ? DARK_SURFACE : LIGHT_SURFACE

  const style = {
    '--program-veil': program.veil,
    '--program-iris': program.iris,
    '--program-tint': program.tint,
    '--program-back': program.back,
    '--program-back-tint': program.backTint,
    '--program-logo': `url(${program.logo})`,
    '--program-wash': surface.wash,
    '--program-front-filter': surface.glow,
    // The back face is always a dark surface, so its mark always gets the
    // lightened treatment regardless of theme.
    '--program-back-filter': DARK_SURFACE.glow,
  } as CSSProperties

  return (
    <div className={styles.scene}>
      <div
        className={`${styles.card} ${flipped ? styles.cardFlipped : ''}`}
        style={style}
      >
        <button
          type="button"
          className={styles.front}
          onClick={onFlip}
          aria-pressed={flipped}
          aria-hidden={flipped}
          inert={flipped}
        >
          <span className={styles.wash} aria-hidden="true" />
          <span className={styles.frontMark} aria-hidden="true" />
          <span className={styles.num} aria-hidden="true">
            {program.num}
          </span>
          <span className={styles.name}>{program.name}</span>
          <span className={styles.blurb}>{program.blurb}</span>
          <span className={styles.flipHint}>
            Flip for details
            <span className={styles.flipGlyph} aria-hidden="true">
              ↻
            </span>
          </span>
        </button>

        <div
          className={`${styles.face} ${styles.back}`}
          aria-hidden={!flipped}
          inert={!flipped}
        >
          <span className={styles.backMark} aria-hidden="true" />
          <button
            type="button"
            className={styles.backCover}
            onClick={onFlip}
            aria-label={`Flip ${program.name} back over`}
          />
          <div className={styles.backBody}>
            <span className={styles.backName}>{program.name}</span>
            <span className={styles.backGroup}>
              <span className={styles.backLabel}>Who it's for</span>
              <span className={styles.backValue}>{program.who}</span>
            </span>
            <span className={styles.backGroup}>
              <span className={styles.backLabel}>Your first visit</span>
              <span className={styles.backValue}>{program.first}</span>
            </span>
            <a className={styles.backLink} href={program.href}>
              Open the program page →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
