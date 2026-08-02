/**
 * Imported rather than dropped in public/ so Vite resolves and fingerprints
 * them. That matters for the program marks in particular: a bare relative URL
 * inside a var()-substituted background-image resolves against the stylesheet,
 * not the document, which silently 404s from a hashed CSS bundle.
 */
export { default as bhwCircles } from './bhw-circles.svg'
export { default as bhwLockup } from './bhw-lockup.png'
export { default as skylineTagline } from './skyline-tagline.png'
export { default as logoPrimaryCare } from './logo-primary-care.png'
export { default as logoMindMood } from './logo-mind-mood.png'
export { default as logoCharmedMinds } from './logo-charmed-minds.png'
export { default as logoFlow } from './logo-flow.png'
