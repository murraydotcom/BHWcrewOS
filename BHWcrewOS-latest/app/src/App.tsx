import { useCallback, useRef } from 'react'
import { Header } from './components/Header'
import { SiteFooter } from './components/SiteFooter'
import { useTriage } from './components/useTriage'
import { HubPage } from './pages/HubPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { useHashRoute } from './lib/useHashRoute'
import { useTheme } from './lib/useTheme'

export default function App() {
  const { page, navigate } = useHashRoute()
  const { theme, toggleTheme, label } = useTheme()
  const triage = useTriage()

  const askRef = useRef<HTMLElement | null>(null)

  const openResources = useCallback(() => navigate('resources'), [navigate])

  /** Header "Ask us" — get to the Just Ask box wherever you are. */
  const askUs = useCallback(() => {
    if (page !== 'hub') {
      navigate('hub')
      // Wait for the hub to mount before measuring where Just Ask landed.
      requestAnimationFrame(() => askRef.current?.scrollIntoView({ block: 'start' }))
      return
    }
    askRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [navigate, page])

  return (
    <div className="app">
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <Header
        page={page}
        onNavigate={navigate}
        onAskUs={askUs}
        themeLabel={label}
        onToggleTheme={toggleTheme}
      />

      {page === 'hub' ? (
        <HubPage
          triage={triage}
          theme={theme}
          askRef={askRef}
          onOpenResources={openResources}
        />
      ) : (
        <ResourcesPage onBack={() => navigate('hub')} />
      )}

      <SiteFooter onOpenResources={openResources} />
    </div>
  )
}
