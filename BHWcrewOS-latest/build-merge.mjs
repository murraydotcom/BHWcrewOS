// After `vite build` produces app/dist, bring the existing static pages and
// their assets into the publish folder, so Care Connect (the new root) and the
// legacy pages (Personal Health Blueprint, CrewCare, program pages, ops tools)
// are served together from one deploy.
//
// The old internal ops hub (index.html) is preserved as crewos.html so Care
// Connect can own the root index.html. Nothing is deleted from the repo.
import { cpSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = new URL('./', import.meta.url) // BHWcrewOS-latest/
const dist = new URL('./app/dist/', import.meta.url) // Netlify publish dir

if (!existsSync(fileURLToPath(dist))) {
  console.error('build-merge: app/dist not found — run the Vite build first.')
  process.exit(1)
}

// 1) Legacy assets → dist/assets (merges with Vite's hashed output; names don't clash).
const assetsSrc = new URL('./assets/', base)
if (existsSync(fileURLToPath(assetsSrc))) {
  cpSync(assetsSrc, new URL('./assets/', dist), { recursive: true })
}

// 2) Legacy *.html → dist. index.html (the internal ops hub) is kept as crewos.html.
let copied = 0
for (const f of readdirSync(base)) {
  if (!f.endsWith('.html')) continue
  const from = new URL('./' + f, base)
  const to = f === 'index.html' ? new URL('./crewos.html', dist) : new URL('./' + f, dist)
  copyFileSync(from, to)
  copied++
}
console.log(`build-merge: copied ${copied} legacy page(s) + assets into app/dist`)
