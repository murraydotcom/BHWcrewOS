import { useId, useState, type FormEvent } from 'react'
import { CONTACT } from '../data/contact'
import { markRoutedToGoogle, submitReview } from '../lib/submit'
import styles from './ShareYourExperience.module.css'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const WHY_GOOGLE =
  'A few words on Google helps another Baltimore family find care they can trust.'

/**
 * Ratings + comments from patients. Everything is saved to the practice's own
 * Patient Reviews store; after submitting, everyone is offered a one-tap link to
 * post it on Google (we never gate that link on the rating). Lower ratings are
 * quietly flagged for the team to follow up.
 */
export function ShareYourExperience() {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [googleUrl, setGoogleUrl] = useState('')
  const [reviewId, setReviewId] = useState<string | null>(null)

  const commentId = useId()
  const nameId = useId()
  const contactId = useId()
  const starsLabelId = useId()

  const sending = status === 'sending'
  const shown = hover || rating

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    if (!rating && !comment.trim()) {
      setStatus('error')
      return
    }
    setStatus('sending')
    try {
      const receipt = await submitReview({
        rating,
        comment: comment.trim(),
        name: name.trim(),
        contact: contact.trim(),
        source: 'Care Connect',
      })
      setGoogleUrl(receipt.googleUrl)
      setReviewId(receipt.reviewId)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  const noteLine =
    status === 'error'
      ? rating || comment.trim()
        ? `That didn’t send. Call ${CONTACT.phone} and we’ll take it down for you.`
        : 'Tap a star or write a line first.'
      : 'Your note goes straight to the BHW team. For anything urgent, call ' + CONTACT.phone + '.'

  return (
    <section className={styles.section} aria-labelledby="share-experience-title">
      <div>
        <p className={styles.eyebrow}>Your experience</p>
        <h3 className={styles.title} id="share-experience-title">
          How is your care with us going?
        </h3>
        <p className={styles.body}>
          We read every rating and comment — it’s how we keep getting better for you and your
          family. Tell us in a few words, and if we’ve earned it, you can share it on Google in one
          tap.
        </p>
      </div>

      {status === 'sent' ? (
        <div className={styles.card}>
          <div className={styles.thanks}>
            <h4 className={styles.thanksTitle}>Thank you — we’ve got it.</h4>
            <p className={styles.body} style={{ margin: 0 }}>
              {rating > 0 && rating <= 3
                ? 'A member of the team will look at your note and reach out if it needs a follow-up. If you’d still like to, you can share feedback on Google too:'
                : WHY_GOOGLE}
            </p>
            {googleUrl ? (
              <a
                className={styles.google}
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => reviewId && markRoutedToGoogle(reviewId)}
              >
                <span className={styles.gmark} aria-hidden="true">
                  G
                </span>
                Leave a Google review
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <form className={styles.card} onSubmit={onSubmit}>
          <div className={styles.group} role="group" aria-labelledby={starsLabelId}>
            <span className={styles.groupLabel} id={starsLabelId}>
              Your rating
            </span>
            <div className={styles.stars} onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${styles.star} ${n <= shown ? styles.starOn : ''}`}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  aria-pressed={rating === n}
                  onMouseEnter={() => setHover(n)}
                  onFocus={() => setHover(n)}
                  onBlur={() => setHover(0)}
                  onClick={() => {
                    setRating(n)
                    setStatus('idle')
                  }}
                >
                  {n <= shown ? '★' : '☆'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.group}>
            <label className={styles.groupLabel} htmlFor={commentId}>
              What stood out? (optional)
            </label>
            <textarea
              id={commentId}
              className={`${styles.field} ${styles.textarea}`}
              rows={3}
              value={comment}
              placeholder="The team took time to actually listen…"
              onChange={(event) => {
                setComment(event.target.value)
                setStatus('idle')
              }}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.group}>
              <label className={styles.groupLabel} htmlFor={nameId}>
                Name (optional)
              </label>
              <input
                id={nameId}
                className={styles.field}
                value={name}
                placeholder="First name"
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className={styles.group}>
              <label className={styles.groupLabel} htmlFor={contactId}>
                Email or phone (optional)
              </label>
              <input
                id={contactId}
                className={styles.field}
                value={contact}
                placeholder="So we can follow up"
                autoComplete="email"
                onChange={(event) => setContact(event.target.value)}
              />
            </div>
          </div>

          <button type="submit" className={styles.submit} disabled={sending}>
            {sending ? 'Sending…' : 'Share with the team'}
          </button>
          <p
            className={`${styles.note} ${status === 'error' ? styles.noteError : ''}`}
            role="status"
          >
            {noteLine}
          </p>
        </form>
      )}
    </section>
  )
}
