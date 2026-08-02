import { useId, useState, type FormEvent } from 'react'
import { CONTACT } from '../data/contact'
import { submitVisitNotice } from '../lib/submit'
import styles from './TellUsYouWereSeen.module.css'

const PLACES = ['Emergency room', 'Urgent care', 'Admitted to hospital', 'Another office']
const WHENS = ['Today', 'Yesterday', 'This week', 'Longer ago']

const WHY = [
  'Best within 48 hours of going home — sooner if you were admitted.',
  'Bring or photograph your discharge summary and any new prescriptions.',
  'Most insurers cover a transition-of-care visit at no cost to you.',
]

type Status = 'idle' | 'sending' | 'sent' | 'error'

/** Transition-of-care heads-up after an ER, urgent care or hospital visit. */
export function TellUsYouWereSeen() {
  const [place, setPlace] = useState('')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const placeLabelId = useId()
  const whenLabelId = useId()
  const noteId = useId()

  const sending = status === 'sending'

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    setStatus('sending')
    try {
      await submitVisitNotice({ place, when, note, submittedAt: new Date().toISOString() })
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  const label =
    status === 'sent' ? 'Got it — thank you' : sending ? 'Sending…' : 'Let my care team know'

  const noteLine =
    status === 'sent'
      ? 'A nurse will request your records and call about a follow-up, usually the next business day.'
      : status === 'error'
        ? `That didn’t send. Call ${CONTACT.phone} and we’ll take it down for you.`
        : `Goes straight to the transition-of-care nurse. For anything urgent right now, call ${CONTACT.phone}.`

  return (
    <section className={styles.section} aria-labelledby="tell-us-title">
      <div>
        <p className={styles.eyebrow}>After a hospital or urgent care visit</p>
        <h3 className={styles.title} id="tell-us-title">
          Tell us you were seen
        </h3>
        <p className={styles.body}>
          Records don’t always reach us, and when they do it can take a week. A two-line heads-up
          lets us pull your discharge paperwork, restart or stop the right medications, and get you
          a follow-up before anything unravels.
        </p>
        <ul className={styles.list}>
          {WHY.map((item) => (
            <li className={styles.item} key={item}>
              <span className={styles.dot} aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.group} role="group" aria-labelledby={placeLabelId}>
          <span className={styles.groupLabel} id={placeLabelId}>
            Where were you seen?
          </span>
          <div className={styles.options}>
            {PLACES.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.option}
                aria-pressed={place === option}
                onClick={() => {
                  setPlace(place === option ? '' : option)
                  setStatus('idle')
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group} role="group" aria-labelledby={whenLabelId}>
          <span className={styles.groupLabel} id={whenLabelId}>
            When?
          </span>
          <div className={styles.options}>
            {WHENS.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.option}
                aria-pressed={when === option}
                onClick={() => {
                  setWhen(when === option ? '' : option)
                  setStatus('idle')
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <label className={styles.groupLabel} htmlFor={noteId}>
            Which hospital or clinic, and what for?
          </label>
          <textarea
            id={noteId}
            className={styles.textarea}
            rows={3}
            value={note}
            placeholder="Sinai ER for chest pain, sent home with a new inhaler"
            onChange={(event) => {
              setNote(event.target.value)
              setStatus('idle')
            }}
          />
        </div>

        <button type="submit" className={styles.submit} disabled={sending}>
          {label}
        </button>
        <p
          className={`${styles.note} ${status === 'error' ? styles.noteError : ''}`}
          role="status"
        >
          {noteLine}
        </p>
      </form>
    </section>
  )
}
