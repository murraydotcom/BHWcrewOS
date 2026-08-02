import type { CSSProperties, FormEvent } from 'react'
import { CONTACT } from '../data/contact'
import { ROUTES, SELF_HELP, type Field } from '../data/triage'
import type { Triage } from './useTriage'
import styles from './TriageForm.module.css'

interface TriageFormProps {
  triage: Triage
}

export function TriageForm({ triage }: TriageFormProps) {
  const {
    route,
    pinRoute,
    fields,
    answers,
    setAnswer,
    status,
    reference,
    submit,
    formRef,
    firstFieldRef,
  } = triage

  const sending = status === 'sending'
  const sent = status === 'sent'

  const submitLabel = sent
    ? 'Sent — you’re in the queue'
    : sending
      ? 'Sending…'
      : 'Send to my care team'

  const submitNote = sent
    ? `You’re in the queue as ${reference}. We’ll answer in your Health Blueprint inbox.`
    : status === 'error'
      ? `That didn’t send. Try once more, or call ${CONTACT.phone} and we’ll take it down for you.`
      : 'A real person on your care team claims this, and nothing sits unread.'

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit()
  }

  return (
    <section
      className={styles.form}
      ref={formRef as React.Ref<HTMLElement>}
      style={{ '--route-quiet': route.quiet } as CSSProperties}
      aria-labelledby="triage-form-title"
    >
      <div className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.eyebrow}>A few quick questions</p>
          <p className={styles.formTitle} id="triage-form-title">
            {route.formTitle}
          </p>
        </div>
        <div className={styles.tabs} role="group" aria-label="What is this about?">
          {ROUTES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={styles.tab}
              aria-pressed={option.key === route.key}
              onClick={() => pinRoute(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div className={styles.fields}>
          {fields.map((field, index) => (
            <FieldControl
              key={`${route.key}-${field.id}`}
              field={field}
              value={answers[field.id] ?? ''}
              onChange={(value) => setAnswer(field.id, value)}
              inputRef={index === 0 ? firstFieldRef : undefined}
            />
          ))}
        </div>

        {route.safety && (
          <div className={styles.safety}>
            <span className={styles.safetyBar} aria-hidden="true" />
            <p className={styles.safetyText}>{route.safety}</p>
          </div>
        )}

        <div className={styles.submitBar}>
          <button type="submit" className={styles.submit} disabled={sending}>
            {submitLabel}
          </button>
          <p
            className={`${styles.submitNote} ${status === 'error' ? styles.submitNoteError : ''}`}
            role="status"
          >
            {submitNote}
          </p>
          <p className={styles.secure}>
            <span className={styles.secureDot} aria-hidden="true" />
            Secure · Care team only
          </p>
        </div>
      </form>

      {sent && (
        <div className={styles.selfHelp}>
          <p className={styles.eyebrow}>While you wait</p>
          <p className={styles.selfHelpTitle}>
            Three things that often sort this out before we even reply
          </p>
          <div className={styles.selfHelpGrid}>
            {SELF_HELP[route.key].map((tip) => (
              <div className={styles.selfHelpCard} key={tip.title}>
                <p className={styles.selfHelpCardTitle}>{tip.title}</p>
                <p className={styles.selfHelpCardBody}>{tip.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

interface FieldControlProps {
  field: Field
  value: string
  onChange: (value: string) => void
  inputRef?: React.Ref<HTMLInputElement>
}

function FieldControl({ field, value, onChange, inputRef }: FieldControlProps) {
  const controlId = `triage-${field.id}`
  const helpId = field.help ? `${controlId}-help` : undefined
  const style = { '--field-span': field.span ?? 'auto' } as CSSProperties

  if (field.type === 'chips') {
    // A pick-one row. role=group + aria-pressed keeps the pill look while
    // still announcing the question and the current answer.
    return (
      <div className={styles.field} style={style} role="group" aria-labelledby={controlId}>
        <span className={styles.label} id={controlId}>
          {field.label}
        </span>
        <div className={styles.optionRow}>
          {field.options?.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.option}
              aria-pressed={value === option}
              onClick={() => onChange(value === option ? '' : option)}
            >
              {option}
            </button>
          ))}
        </div>
        {field.help && (
          <p className={styles.help} id={helpId}>
            {field.help}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={styles.field} style={style}>
      <label className={styles.label} htmlFor={controlId}>
        {field.label}
      </label>
      {field.type === 'area' ? (
        <textarea
          id={controlId}
          className={styles.textarea}
          rows={3}
          value={value}
          placeholder={field.placeholder}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={controlId}
          ref={inputRef}
          className={styles.input}
          value={value}
          placeholder={field.placeholder}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.help && (
        <p className={styles.help} id={helpId}>
          {field.help}
        </p>
      )}
    </div>
  )
}
