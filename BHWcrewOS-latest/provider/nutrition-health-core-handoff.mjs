const SYNTHETIC_CLINICAL_MAP_PATIENT_ID = "BHW0000";
const TRUSTED_BHW_DOMAIN = /(^|\.)bhwmedical\.org$/i;
const TRUSTED_CLOUD_RUN_DOMAIN = /(^|\.)a\.run\.app$/i;
const clean = (value, maximum = 300) => String(value ?? "").trim().slice(0, maximum);

function validateHealthCoreOrigin(value) {
  let url;
  try {
    url = new URL(clean(value, 500));
  } catch {
    throw new Error("Health Core destination is unavailable.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || !["", "/"].includes(url.pathname)
    || (!TRUSTED_BHW_DOMAIN.test(url.hostname) && !TRUSTED_CLOUD_RUN_DOMAIN.test(url.hostname))) {
    throw new Error("Health Core destination is unavailable.");
  }
  return url.origin;
}

function replaceWithHandoff({ href, patientId }) {
  const content = document.querySelector(".nutrition-content");
  if (!content) return;
  const synthetic = patientId === SYNTHETIC_CLINICAL_MAP_PATIENT_ID;
  content.innerHTML = `<section class="nutrition-hero">
    <div>
      <span class="eyebrow">Authoritative clinical destination</span>
      <h1>Nutrition reconciliation has moved to Health Core</h1>
      <p>Care Connect nutrition answers are stored and reconciled with charted physiology in Health Core and Patient 360. CrewOS receives only the minimum operational task metadata needed for follow-through.</p>
    </div>
    <div class="nutrition-identity" data-state="${synthetic ? "verified" : "restricted"}">
      <span>${synthetic ? "Selected synthetic patient" : "Protected patient context"}</span>
      <b>${synthetic ? "BHW Synthetic Patient" : "Open from Patient 360"}</b>
      <strong>${synthetic ? SYNTHETIC_CLINICAL_MAP_PATIENT_ID : "No patient identifier transmitted"}</strong>
      <small>${synthetic ? "Continue in the authoritative Health Core Nutrition Intelligence workspace." : "A verified, short-lived Health Core patient context is required for a real patient."}</small>
      <a class="btn primary" href="${href}">${synthetic ? "Open Health Core Nutrition Intelligence" : "Return to Patient Registry"}</a>
    </div>
  </section>
  <section class="panel"><div class="panel-body">
    <div class="clinical-boundary"><b>System boundary</b><p>Questionnaire answers and clinical reconciliation do not live in CrewOS. Health Core owns the clinical workspace, saved revisions, audit trail, and Patient 360 projection. CrewOS remains the operational follow-through layer.</p></div>
  </div></section>`;
}

export function bootstrapNutritionHealthCoreHandoff() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const patientId = clean(new URLSearchParams(window.location.search).get("patient"), 80)
    || SYNTHETIC_CLINICAL_MAP_PATIENT_ID;
  const configuredOrigin = document.querySelector('meta[name="bhw-health-core-ehr-origin"]')?.content;
  let origin;
  try {
    origin = validateHealthCoreOrigin(configuredOrigin);
  } catch {
    replaceWithHandoff({ href: "patient-registry.html", patientId: "" });
    return;
  }
  const href = patientId === SYNTHETIC_CLINICAL_MAP_PATIENT_ID
    ? `${origin}/nutrition-intelligence.html?patient=${SYNTHETIC_CLINICAL_MAP_PATIENT_ID}`
    : "patient-registry.html";
  replaceWithHandoff({ href, patientId });
  document.getElementById("connection-status")?.replaceChildren("Health Core is the clinical owner");
  for (const id of ["refresh", "print"]) {
    const control = document.getElementById(id);
    if (control) control.hidden = true;
  }
}

bootstrapNutritionHealthCoreHandoff();
