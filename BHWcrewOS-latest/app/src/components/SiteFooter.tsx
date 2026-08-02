import { skylineTagline } from '../assets'
import { CONTACT } from '../data/contact'
import styles from './SiteFooter.module.css'

const CARE_LINKS: { label: string; href: string }[] = [
  { label: 'Primary Care', href: 'bhw-patient-portal-mockup.html' },
  { label: 'Mind & Mood', href: 'bhw-mindmood-patient-mockup.html' },
  { label: 'CharmEd Minds', href: 'bhw-charmed-patient-mockup.html' },
  { label: 'Flow', href: 'bhw-flow-patient-mockup.html' },
  { label: 'Meet the care team', href: '#' },
]

const PATIENT_LINKS: { label: string; href: string }[] = [
  { label: 'Personal Health Blueprint', href: CONTACT.blueprintUrl },
  { label: 'New patient forms', href: '#' },
  { label: 'Billing & insurance', href: '#' },
  { label: 'Good Faith Estimate', href: '#' },
  { label: 'Request your records', href: '#' },
]

const LEGAL_LINKS = [
  'Privacy Policy',
  'Notice of Privacy Practices (HIPAA)',
  'Terms of Use',
  'Accessibility Statement',
  'Nondiscrimination & Language Assistance',
  'Patient Rights & Responsibilities',
  'Affiliate disclosure',
  'Cookie preferences',
]

interface SiteFooterProps {
  onOpenResources: () => void
}

export function SiteFooter({ onOpenResources }: SiteFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.columns}>
        <div className={styles.column}>
          <p className={styles.practice}>{CONTACT.practice}</p>
          <p className={`${styles.detail} ${styles.address}`}>
            {CONTACT.street}
            <br />
            {CONTACT.cityStateZip}
          </p>
          <p className={styles.detail}>
            Phone {CONTACT.phone}
            <br />
            Fax {CONTACT.fax}
          </p>
          <p className={styles.detail}>{CONTACT.hours}</p>
        </div>

        <div className={styles.column}>
          <p className={styles.columnHead}>Care</p>
          {CARE_LINKS.map(({ label, href }) => (
            <a className={styles.link} href={href} key={label}>
              {label}
            </a>
          ))}
        </div>

        <div className={styles.column}>
          <p className={styles.columnHead}>Patients</p>
          {PATIENT_LINKS.map(({ label, href }) => (
            <a className={styles.link} href={href} key={label}>
              {label}
            </a>
          ))}
          <button type="button" className={styles.link} onClick={onOpenResources}>
            Resource library
          </button>
          <a className={styles.link} href={CONTACT.providerUrl}>
            BHW staff · Provider sign-in
          </a>
        </div>

        <div className={styles.legalColumn}>
          <p className={`${styles.columnHead} ${styles.legalHead}`}>Legal</p>
          {LEGAL_LINKS.map((label) => (
            <a className={styles.link} href="#" key={label}>
              {label}
            </a>
          ))}
        </div>
      </div>

      <div className={styles.fineprintWrap}>
        <p className={styles.fineprint}>
          This site is for communication with established BHW patients. Nothing here is medical
          advice, and messages sent through it are not monitored around the clock — in an emergency
          call 911, or {CONTACT.crisisLine} for the Suicide &amp; Crisis Lifeline. Language
          assistance and auxiliary aids are available free of charge; ask the front desk or call{' '}
          {CONTACT.phone}.
        </p>
        <div className={styles.copyright}>
          <span>
            © {new Date().getFullYear()} {CONTACT.brand} / {CONTACT.practice}. All rights reserved.
          </span>
          <span>Discrimination is against the law. Se habla español.</span>
        </div>
      </div>

      <img className={styles.skyline} src={skylineTagline} alt="" aria-hidden="true" />
    </footer>
  )
}
