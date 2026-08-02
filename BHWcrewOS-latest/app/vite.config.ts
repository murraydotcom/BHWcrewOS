import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so a production build can be dropped into any sub-path
  // (e.g. bhwmedical.org/care-connect) without a rebuild.
  base: './',
  build: {
    // The embedded Playfair/Caveat woff2 payloads in tokens/fonts.css are large;
    // keep them as a separate stylesheet request rather than inlining further.
    assetsInlineLimit: 4096,
  },
})
