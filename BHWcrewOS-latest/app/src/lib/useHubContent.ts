import { useEffect, useState } from 'react'
import type { Announcement } from '../data/news'

/** A downloadable/linkable resource shown on the hub (PDF, form, page). */
export interface HubResource {
  tag: string
  title: string
  body: string
  url: string
}

export interface HubContent {
  announcements: Announcement[]
  resources: HubResource[]
  /** True once a successful fetch has resolved (so callers can prefer defaults until then). */
  ready: boolean
}

/** Announcement tags map to a tint so staff never have to touch CSS variables. */
const TAG_TINT: Record<string, string> = {
  Hours: 'var(--warning)',
  Blueprint: 'var(--accent)',
  Staff: 'var(--accent-3)',
  Program: 'var(--accent-2)',
  Insurance: 'var(--accent-3)',
  Form: 'var(--accent-2)',
  General: 'var(--accent-2)',
}

const ENDPOINT = '/.netlify/functions/hub-content'

/**
 * Pulls the hub's editable content (announcements + resources) from Notion at
 * runtime, so the practice can change it without a rebuild. On any failure the
 * hook simply returns empty arrays and `ready:false`, and callers fall back to
 * the built-in defaults compiled into the app.
 */
export function useHubContent(): HubContent {
  const [content, setContent] = useState<HubContent>({
    announcements: [],
    resources: [],
    ready: false,
  })

  useEffect(() => {
    let live = true
    fetch(ENDPOINT)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!live) return
        const announcements: Announcement[] = (data.announcements || []).map(
          (a: Partial<Announcement>) => ({
            tag: a.tag || 'General',
            tint: TAG_TINT[a.tag || 'General'] || 'var(--accent-2)',
            date: a.date || '',
            title: a.title || '',
            body: a.body || '',
          }),
        )
        const resources: HubResource[] = (data.resources || []).filter(
          (r: HubResource) => r.title || r.url,
        )
        setContent({ announcements, resources, ready: true })
      })
      .catch(() => {
        /* keep defaults — the app still works fully offline */
      })
    return () => {
      live = false
    }
  }, [])

  return content
}
