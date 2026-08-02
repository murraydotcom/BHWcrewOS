import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

/** Keep in sync with the boot script in index.html. */
const STORAGE_KEY = 'bhw-cc-theme'

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* private mode, blocked storage — fall through */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Light opal / Black opal. The boot script in index.html has already pinned
 * `data-theme` before first paint; this hook only mirrors and toggles it.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === 'undefined' ? 'light' : readTheme(),
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Follow the OS while the patient hasn't chosen for themselves.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return

    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return
      } catch {
        /* ignore */
      }
      setTheme(event.matches ? 'dark' : 'light')
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return {
    theme,
    toggleTheme,
    label: theme === 'dark' ? 'Switch to Light Opal' : 'Switch to Dark Opal',
  }
}
