import { useCallback, useEffect, useState } from 'react'

export type PageName = 'hub' | 'resources'

/**
 * Hash routing, deliberately: the built site drops onto any static host — a
 * sub-path, S3, GitHub Pages — with no server rewrite rules, and the back
 * button and shareable links still work.
 *
 *   #/           the Care Connect hub
 *   #/resources  the Ask NP Am resource library
 */
function pageFromHash(): PageName {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0] === 'resources'
    ? 'resources'
    : 'hub'
}

export function useHashRoute() {
  const [page, setPage] = useState<PageName>(() =>
    typeof window === 'undefined' ? 'hub' : pageFromHash(),
  )

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: PageName) => {
    const hash = next === 'resources' ? '#/resources' : '#/'
    if (window.location.hash === hash) {
      window.scrollTo(0, 0)
      return
    }
    window.location.hash = hash // the hashchange listener handles the rest
  }, [])

  return { page, navigate }
}
