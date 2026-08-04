import { useCallback, useMemo, useRef, useState } from 'react'
import {
  detectRoute,
  FALLBACK_ROUTE,
  INTAKE,
  ROUTES,
  type Field,
  type Route,
  type RouteKey,
} from '../data/triage'
import { submitTriage } from '../lib/submit'

export type TriageStatus = 'idle' | 'sending' | 'sent' | 'error'

/**
 * Everything the Just Ask box and the form beneath it share: what was typed,
 * which route won, the answers so far, and the send state.
 *
 * Answers are kept per route so switching route chips to compare doesn't throw
 * away what someone already typed.
 */
export function useTriage() {
  const [ask, setAsk] = useState('')
  const [pinnedRoute, setPinnedRoute] = useState<RouteKey | null>(null)
  const [answersByRoute, setAnswersByRoute] = useState<
    Partial<Record<RouteKey, Record<string, string>>>
  >({})
  const [status, setStatus] = useState<TriageStatus>('idle')
  const [reference, setReference] = useState<string | null>(null)

  /** So "Send it" can hand the patient off to the first form field. */
  const formRef = useRef<HTMLElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  const route: Route = useMemo(() => {
    const pinned = pinnedRoute ? ROUTES.find((r) => r.key === pinnedRoute) : undefined
    return pinned ?? detectRoute(ask) ?? FALLBACK_ROUTE
  }, [pinnedRoute, ask])

  const fields: Field[] = useMemo(() => [...INTAKE, ...route.fields], [route])
  const answers = answersByRoute[route.key] ?? {}

  const updateAsk = useCallback((value: string) => {
    setAsk(value)
    setPinnedRoute(null) // typing beats a previous manual override
    setStatus('idle')
  }, [])

  const pickChip = useCallback((label: string) => {
    setAsk(label)
    setPinnedRoute(null)
    setStatus('idle')
  }, [])

  const pinRoute = useCallback((key: RouteKey) => {
    setPinnedRoute(key)
    setStatus('idle')
  }, [])

  const setAnswer = useCallback(
    (fieldId: string, value: string) => {
      setAnswersByRoute((current) => ({
        ...current,
        [route.key]: { ...current[route.key], [fieldId]: value },
      }))
      setStatus('idle')
    },
    [route.key],
  )

  /** The "Send it" pill hands off to the questions rather than sending blind. */
  const goToForm = useCallback(() => {
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    firstFieldRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = useCallback(async () => {
    if (status === 'sending') return
    setStatus('sending')
    // Compose a readable one-line summary with the real field labels, and pull
    // out name / DOB so the queue row is actionable at a glance.
    const skip = new Set(['name', 'dob', 'blueprint'])
    const detail = fields
      .filter((f) => !skip.has(f.id) && (answers[f.id] || '').trim())
      .map((f) => `${f.label}: ${answers[f.id].trim()}`)
    const summary = [route.label, ask.trim(), ...detail].filter(Boolean).join(' · ')
    try {
      const receipt = await submitTriage({
        route: route.key,
        routeLabel: route.label,
        freeText: ask,
        answers,
        name: (answers.name || '').trim(),
        dob: (answers.dob || '').trim(),
        summary,
        submittedAt: new Date().toISOString(),
      })
      setReference(receipt.reference)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }, [answers, ask, fields, route.key, route.label, status])

  return {
    ask,
    updateAsk,
    pickChip,
    route,
    pinRoute,
    fields,
    answers,
    setAnswer,
    status,
    reference,
    submit,
    goToForm,
    formRef,
    firstFieldRef,
  }
}

export type Triage = ReturnType<typeof useTriage>
