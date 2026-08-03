import type { Ref } from 'react'
import { ContactCards } from '../components/ContactCards'
import { CrisisStrip } from '../components/CrisisStrip'
import { ErOrUrgentCare } from '../components/ErOrUrgentCare'
import { HubResources } from '../components/HubResources'
import { JustAsk } from '../components/JustAsk'
import { Masthead } from '../components/Masthead'
import { ProgramCards } from '../components/ProgramCards'
import { ResourcesPromo } from '../components/ResourcesPromo'
import { ShareYourExperience } from '../components/ShareYourExperience'
import { TellUsYouWereSeen } from '../components/TellUsYouWereSeen'
import { TriageForm } from '../components/TriageForm'
import type { Triage } from '../components/useTriage'
import { useHubContent } from '../lib/useHubContent'
import type { Theme } from '../lib/useTheme'

interface HubPageProps {
  triage: Triage
  theme: Theme
  askRef: Ref<HTMLElement>
  onOpenResources: () => void
}

/** Section order is deliberate — don't reorder without asking. */
export function HubPage({ triage, theme, askRef, onOpenResources }: HubPageProps) {
  const { announcements, resources } = useHubContent()
  return (
    <main className="page" id="main">
      <Masthead announcements={announcements} />
      <JustAsk triage={triage} sectionRef={askRef} />
      <TriageForm triage={triage} />
      <ProgramCards theme={theme} />
      <HubResources resources={resources} />
      <ResourcesPromo onOpenResources={onOpenResources} />
      <CrisisStrip variant="hub" />
      <ErOrUrgentCare />
      <TellUsYouWereSeen />
      <ShareYourExperience />
      <ContactCards />
    </main>
  )
}
