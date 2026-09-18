const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const list = (value) => Array.isArray(value) ? value : [];

const REGION_POSITIONS = Object.freeze({
  mouth_esophagus: { x: 88, y: 42, labelX: 128, labelY: 48 },
  stomach: { x: 88, y: 104, labelX: 128, labelY: 110 },
  duodenum: { x: 95, y: 164, labelX: 128, labelY: 170 },
  jejunum: { x: 88, y: 226, labelX: 128, labelY: 232 },
  ileum: { x: 88, y: 292, labelX: 128, labelY: 298 },
  colon: { x: 88, y: 358, labelX: 128, labelY: 364 },
});

export function renderNutritionDigestionMap(contract = {}) {
  const regions = list(contract?.regions);
  if (!regions.length) {
    return `<section class="digestion-map digestion-map-unavailable" aria-labelledby="digestion-map-title"><div class="digestion-map-heading"><div><span class="eyebrow">BHW digestive orientation</span><h3 id="digestion-map-title">GI orientation temporarily unavailable</h3><p>The current Health Core response did not include the digestion map. The rest of Nutrition Intelligence remains available.</p></div><span class="badge warning">Awaiting Health Core</span></div></section>`;
  }
  const markers = regions.map((region, index) => {
    const position = REGION_POSITIONS[region.code] || { x: 88, y: 42 + (index * 62), labelX: 128, labelY: 48 + (index * 62) };
    return `<g class="digestion-map-marker digestion-map-marker-${esc(region.code)}"><circle cx="${position.x}" cy="${position.y}" r="15"></circle><text x="${position.x}" y="${position.y + 5}" text-anchor="middle">${index + 1}</text><line x1="${position.x + 18}" y1="${position.y}" x2="${position.labelX - 7}" y2="${position.labelY - 5}"></line><text class="digestion-map-label" x="${position.labelX}" y="${position.labelY}">${esc(region.label)}</text></g>`;
  }).join("");
  const cards = regions.map((region, index) => `<article class="digestion-region-card"><div class="digestion-region-number" aria-hidden="true">${index + 1}</div><div><h4>${esc(region.label)}</h4><ul>${list(region.primary_functions).map((item) => `<li>${esc(item)}</li>`).join("")}</ul><p><b>Clinical lens:</b> ${esc(region.clinical_lens)}</p></div></article>`).join("");
  return `<section class="digestion-map" aria-labelledby="digestion-map-title"><div class="digestion-map-heading"><div><span class="eyebrow">BHW digestive orientation</span><h3 id="digestion-map-title">${esc(contract?.title || "Where digestion and absorption happen")}</h3><p>${esc(contract?.subtitle || "Functions overlap; this orientation map is not diagnostic.")}</p></div><span class="badge neutral">Clinician view</span></div><div class="digestion-map-layout"><div class="digestion-map-figure"><svg viewBox="0 0 430 420" role="img" aria-labelledby="digestion-svg-title digestion-svg-desc"><title id="digestion-svg-title">Digestive tract regions from mouth to colon</title><desc id="digestion-svg-desc">An original BHW vertical orientation map showing the mouth and esophagus, stomach, duodenum, jejunum, ileum, and colon. Numbered markers match the explanatory cards.</desc><path class="digestive-path" d="M88 20 L88 78 C58 82 58 126 88 132 C112 137 112 155 88 164 C54 177 54 207 88 218 C120 229 120 257 88 270 C54 284 54 316 88 328 L88 396"></path><path class="digestive-stomach" d="M86 76 C48 80 47 126 86 134 C119 127 126 98 103 83 C97 79 92 77 86 76 Z"></path><path class="digestive-small" d="M88 151 C46 164 49 205 88 217 C126 229 126 258 88 271 C50 284 51 317 88 329"></path><path class="digestive-colon" d="M52 328 L52 390 L124 390 L124 328"></path>${markers}</svg><p class="digestion-map-boundary">Symptoms help localize a presentation. Chart diagnoses, medications, examination, labs, imaging, and specialist plans establish physiology and treatment.</p></div><div class="digestion-region-list">${cards}</div></div></section>`;
}
