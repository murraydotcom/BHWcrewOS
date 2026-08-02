import type { CSSProperties, FormEvent } from 'react'
import { CHIPS } from '../data/triage'
import type { Triage } from './useTriage'
import styles from './JustAsk.module.css'

interface JustAskProps {
  triage: Triage
  /** The header's "Ask us" button scrolls here. */
  sectionRef: React.Ref<HTMLElement>
}

export function JustAsk({ triage, sectionRef }: JustAskProps) {
  const { ask, updateAsk, pickChip, route, goToForm } = triage

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    goToForm()
  }

  return (
    <section className={styles.justAsk} ref={sectionRef} aria-labelledby="just-ask-heading">
      <p className={styles.script} aria-hidden="true">
        Good to see you
      </p>
      <h2 className={styles.heading} id="just-ask-heading">
        <span className="srOnly">Good to see you. </span>
        What's going on today?
      </h2>
      <p className={styles.lede}>
        Say it however it comes out. You don't have to know which department it belongs to — that's
        our job, and we're weirdly good at it.
      </p>

      <form className={styles.searchRow} onSubmit={onSubmit}>
        <label className="srOnly" htmlFor="just-ask-input">
          Tell us what's going on
        </label>
        <input
          id="just-ask-input"
          className={styles.searchInput}
          value={ask}
          onChange={(event) => updateAsk(event.target.value)}
          placeholder={'e.g. "my sertraline runs out Friday"'}
          autoComplete="off"
        />
        <button type="submit" className={styles.send}>
          Send it
        </button>
      </form>

      <div className={styles.chips}>
        {CHIPS.map((label) => (
          <button key={label} type="button" className={styles.chip} onClick={() => pickChip(label)}>
            {label}
          </button>
        ))}
      </div>

      <div
        className={styles.readout}
        style={{ '--route-tint': route.tint } as CSSProperties}
        role="status"
      >
        <span className={styles.readoutDot} aria-hidden="true" />
        <p className={styles.readoutText}>
          <strong>{route.readout}</strong> {route.hint}
        </p>
        <p className={styles.readoutSla}>{route.sla}</p>
      </div>
    </section>
  )
}
