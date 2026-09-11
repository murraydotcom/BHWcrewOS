import { createEncounterCloudClient } from "./cloud-queue.mjs";

export const SYNTHETIC_CLINICAL_MAP_PATIENT_ID = "BHW0000";
export const CLINICAL_MAP_TITLE = "BHW Whole-Person Clinical Map";
export const CLINICAL_MAP_SUBTITLE = "PSCM longitudinal synthesis, body-system mapping, and feasible care planning";

const DEFAULT_HEALTH_CORE_ORIGIN = "https://bhw-health-core-ehr-awknhudemq-uk.a.run.app";
const TRUSTED_BHW_DOMAIN = /(^|\.)bhwmedical\.org$/i;
const TRUSTED_CLOUD_RUN_DOMAIN = /(^|\.)a\.run\.app$/i;
const CONNECTION_ORDER = Object.freeze([
  "health-record",
  "body-system-atlas",
  "clinical-events",
  "visit-documentation",
  "nutrition-intelligence",
]);

const clean = (value, maximum = 800) => String(value ?? "").trim().slice(0, maximum);
const list = (value) => Array.isArray(value) ? value : [];

export function escapeClinicalMapHtml(value) {
  return String(value ?? "").replace(/[&<>'\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

export function validateHealthCoreOrigin(value = DEFAULT_HEALTH_CORE_ORIGIN) {
  let url;
  try {
    url = new URL(clean(value, 500) || DEFAULT_HEALTH_CORE_ORIGIN);
  } catch {
    throw new Error("The Health Core destination is not configured safely.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || !["", "/"].includes(url.pathname)
    || (!TRUSTED_BHW_DOMAIN.test(url.hostname) && !TRUSTED_CLOUD_RUN_DOMAIN.test(url.hostname))) {
    throw new Error("The Health Core destination must be a trusted HTTPS service origin.");
  }
  return url.origin;
}

export function healthCoreDestinations(origin = DEFAULT_HEALTH_CORE_ORIGIN) {
  const safeOrigin = validateHealthCoreOrigin(origin);
  const patient = SYNTHETIC_CLINICAL_MAP_PATIENT_ID;
  return Object.freeze([
    Object.freeze({
      id: "chart-summary",
      label: "Health Core Chart Summary",
      description: "Canonical problems, medications, allergies, vitals, referrals, and current clinical record.",
      href: `${safeOrigin}/chart-summary.html?patient=${patient}`,
    }),
    Object.freeze({
      id: "encounter",
      label: "Encounter Documentation",
      description: "Open the canonical encounter note, history verification, and encounter-linked artifacts.",
      href: `${safeOrigin}/clinical-documentation.html?patient=${patient}#encounter-note`,
    }),
    Object.freeze({
      id: "labs",
      label: "Labs & Diagnostics",
      description: "Open verified results, longitudinal trends, imaging, and interpretation review.",
      href: `${safeOrigin}/clinical-record.html?patient=${patient}`,
    }),
    Object.freeze({
      id: "orders",
      label: "Orders & Justifications",
      description: "Open the exact laboratory order package and its encounter-linked medical-necessity justification.",
      href: `${safeOrigin}/order-composer.html?patient=${patient}`,
    }),
    Object.freeze({
      id: "blueprint",
      label: "Care Plans & Blueprints",
      description: "Open the provider-reviewed plan and patient-safe Blueprint workflow.",
      href: `${safeOrigin}/personal-health-blueprint-review.html?patient=${patient}`,
    }),
  ]);
}

function resourceArray(payload) {
  const source = payload?.record || payload?.healthRecord || payload?.bundle || payload || {};
  const entries = list(source.entry).map((entry) => entry?.resource || entry).filter(Boolean);
  if (entries.length) return entries;
  return list(source.resources).length ? source.resources : list(payload?.resources);
}

function resourceCount(resources, resourceType) {
  return resources.filter((resource) => clean(resource?.resourceType, 80) === resourceType).length;
}

export function summarizeHealthRecord(payload) {
  const resources = resourceArray(payload);
  const problems = resourceCount(resources, "Condition");
  const results = resourceCount(resources, "Observation") + resourceCount(resources, "DiagnosticReport");
  const plans = resourceCount(resources, "CarePlan");
  const operational = resourceCount(resources, "ServiceRequest") + resourceCount(resources, "Task");
  return Object.freeze({
    count: resources.length,
    detail: resources.length
      ? `${resources.length} source-linked resources · ${problems} problems · ${results} results · ${plans} plans · ${operational} operational links`
      : "Health Core responded, but no source-linked resources are available in this synthetic projection.",
  });
}

function summarizeAtlas(payload) {
  const workspace = payload?.workspace || payload?.atlasWorkspace || payload?.atlas || {};
  const draftRevision = Number(workspace?.draft?.revision) || 0;
  const approvedVersion = Number(workspace?.approved?.version) || 0;
  return {
    count: approvedVersion || draftRevision,
    detail: approvedVersion
      ? `Provider-approved Atlas v${approvedVersion}${draftRevision ? ` · draft r${draftRevision} also present` : ""}`
      : draftRevision
        ? `Atlas draft r${draftRevision} · provider approval still required`
        : "No saved Atlas version is present in the current synthetic workspace.",
  };
}

function summarizeClinicalEvents(payload) {
  const workspace = payload?.workspace || payload?.clinicalEventsWorkspace || {};
  const approved = list(workspace.approvedEvents);
  const draftRevision = Number(workspace?.draft?.revision) || 0;
  return {
    count: approved.length,
    detail: approved.length
      ? `${approved.length} provider-approved longitudinal event${approved.length === 1 ? "" : "s"}${draftRevision ? ` · draft r${draftRevision} pending` : ""}`
      : draftRevision
        ? `Clinical-event draft r${draftRevision} · provider approval still required`
        : "No approved longitudinal clinical events are present.",
  };
}

function summarizeVisitNotes(payload) {
  const notes = list(payload?.notes).length
    ? payload.notes
    : list(payload?.visitNotes).length
      ? payload.visitNotes
      : list(payload?.records);
  return {
    count: notes.length,
    detail: notes.length
      ? `${notes.length} signed or provider-approved visit note${notes.length === 1 ? "" : "s"} available for source tracing`
      : "No signed or provider-approved visit notes are available in this synthetic projection.",
  };
}

function summarizeNutrition(payload) {
  const workspace = payload?.workspace || payload?.nutritionWorkspace || {};
  const draftRevision = Number(workspace?.draft?.revision) || 0;
  const approvedVersion = Number(workspace?.approved?.version) || 0;
  const publishedVersion = Number(workspace?.published?.version) || 0;
  const highest = publishedVersion || approvedVersion || draftRevision;
  return {
    count: highest,
    detail: publishedVersion
      ? `Published Nutrition Intelligence v${publishedVersion}`
      : approvedVersion
        ? `Provider-approved Nutrition Intelligence v${approvedVersion} · publication pending`
        : draftRevision
          ? `Nutrition Intelligence draft r${draftRevision} · clinical review pending`
          : "No Nutrition Intelligence version is present in the current synthetic workspace.",
  };
}

function connectionDefinition(id, payload) {
  const definitions = {
    "health-record": {
      title: "Canonical Health Core record",
      owner: "Health Core",
      summary: summarizeHealthRecord(payload),
    },
    "body-system-atlas": {
      title: "Body-System Atlas",
      owner: "Health Core versioned artifact",
      summary: summarizeAtlas(payload),
    },
    "clinical-events": {
      title: "Longitudinal clinical events",
      owner: "Health Core versioned artifact",
      summary: summarizeClinicalEvents(payload),
    },
    "visit-documentation": {
      title: "Signed visit documentation",
      owner: "Health Core clinical source",
      summary: summarizeVisitNotes(payload),
    },
    "nutrition-intelligence": {
      title: "Nutrition Intelligence",
      owner: "Health Core clinical workspace",
      summary: summarizeNutrition(payload),
    },
  };
  return definitions[id];
}

function connectionFailure(id, reason) {
  const message = clean(reason?.message, 360) || "The connection could not be verified.";
  const status = Number(reason?.status) || 0;
  return Object.freeze({
    id,
    state: status === 401 || status === 403 ? "session-required" : status === 503 ? "not-activated" : "unavailable",
    label: status === 401 || status === 403 ? "Secure session required" : status === 503 ? "Not activated" : "Unavailable",
    detail: message,
  });
}

export async function loadClinicalMapConnections(client) {
  if (!client) throw new Error("The CrewHQ clinical cloud connection is not configured.");
  const requests = Object.freeze({
    "health-record": () => client.healthRecord(SYNTHETIC_CLINICAL_MAP_PATIENT_ID),
    "body-system-atlas": () => client.patientAtlas(SYNTHETIC_CLINICAL_MAP_PATIENT_ID),
    "clinical-events": () => client.patientClinicalEvents(SYNTHETIC_CLINICAL_MAP_PATIENT_ID),
    "visit-documentation": () => client.patientVisitNotes(SYNTHETIC_CLINICAL_MAP_PATIENT_ID),
    "nutrition-intelligence": () => client.patientNutritionIntelligence(SYNTHETIC_CLINICAL_MAP_PATIENT_ID),
  });
  const settled = await Promise.allSettled(CONNECTION_ORDER.map((id) => requests[id]()));
  return Object.freeze(CONNECTION_ORDER.map((id, index) => {
    const result = settled[index];
    if (result.status === "rejected") return connectionFailure(id, result.reason);
    const definition = connectionDefinition(id, result.value);
    return Object.freeze({
      id,
      state: "connected",
      label: "Connected",
      title: definition.title,
      owner: definition.owner,
      count: definition.summary.count,
      detail: definition.summary.detail,
    });
  }));
}

function stateLabelClass(state) {
  if (state === "connected") return "complete";
  if (state === "session-required" || state === "not-activated") return "warning";
  return "restricted";
}

function renderConnectionCard(connection) {
  const titles = {
    "health-record": ["Canonical Health Core record", "Health Core"],
    "body-system-atlas": ["Body-System Atlas", "Health Core versioned artifact"],
    "clinical-events": ["Longitudinal clinical events", "Health Core versioned artifact"],
    "visit-documentation": ["Signed visit documentation", "Health Core clinical source"],
    "nutrition-intelligence": ["Nutrition Intelligence", "Health Core clinical workspace"],
  };
  const [title, owner] = titles[connection.id] || [connection.id, "Health Core"];
  return `<article class="clinical-map-connection ${escapeClinicalMapHtml(connection.state)}">
    <div class="clinical-map-connection-head">
      <div><span>${escapeClinicalMapHtml(owner)}</span><h3>${escapeClinicalMapHtml(connection.title || title)}</h3></div>
      <span class="badge ${stateLabelClass(connection.state)}">${escapeClinicalMapHtml(connection.label)}</span>
    </div>
    <p>${escapeClinicalMapHtml(connection.detail)}</p>
  </article>`;
}

function renderCanonicalLinks(origin) {
  return healthCoreDestinations(origin).map((destination) => `<a class="clinical-map-destination" href="${escapeClinicalMapHtml(destination.href)}" target="_blank" rel="noopener noreferrer">
    <b>${escapeClinicalMapHtml(destination.label)}</b>
    <span>${escapeClinicalMapHtml(destination.description)}</span>
  </a>`).join("");
}

function bridgeShell(origin) {
  const section = document.createElement("section");
  section.className = "panel clinical-map-bridge";
  section.id = "clinical-map-connections";
  section.setAttribute("aria-labelledby", "clinical-map-connections-title");
  section.innerHTML = `<div class="clinical-map-bridge-head">
      <div><span class="eyebrow">One patient · separate clinical surfaces · one source of truth</span><h2 id="clinical-map-connections-title">Health Core connections</h2><p>${escapeClinicalMapHtml(CLINICAL_MAP_SUBTITLE)}</p></div>
      <span class="badge warning" data-clinical-map-bridge-status>Checking connections</span>
    </div>
    <div class="clinical-map-boundary"><b>Clinical Map is the synthesis workspace.</b> Health Core remains the canonical record for encounters, signed documentation, problems, medications, results, orders, justifications, and approvals. CrewOS owns operational follow-through; Care Connect receives only provider-approved patient-safe information.</div>
    <div class="clinical-map-connection-grid" data-clinical-map-connections><div class="loading">Checking the protected clinical backbone…</div></div>
    <div class="clinical-map-canonical">
      <div><span class="eyebrow">Open the exact source record</span><h3>Health Core clinical destinations</h3></div>
      <div class="clinical-map-destination-grid">${renderCanonicalLinks(origin)}</div>
    </div>
    <div class="clinical-map-release-note"><b>Current boundary:</b> links use only reserved synthetic patient BHW0000. Real-patient cross-application handoff remains blocked until an opaque, short-lived, treatment-purpose context is separately activated.</div>`;
  return section;
}

function applyFormalName() {
  document.title = document.title.replace(/BHW Clinical Intelligence\s*-\s*Patient 360/i, CLINICAL_MAP_TITLE)
    .replace(/BHW Patient 360/i, CLINICAL_MAP_TITLE);
  const brand = document.querySelector(".brand h1");
  const brandDetail = document.querySelector(".brand div");
  if (brand) brand.textContent = CLINICAL_MAP_TITLE;
  if (brandDetail) brandDetail.textContent = "PSCM longitudinal synthesis";
  document.querySelectorAll("a.nav").forEach((link) => {
    if (/Patient 360/i.test(link.textContent || "")) link.textContent = "◉ Clinical Map";
  });
  const crumb = document.querySelector(".crumb");
  const pageName = document.getElementById("page-name")?.textContent || "Clinical Map";
  if (crumb) crumb.innerHTML = `Whole-Person Clinical Map · <b id="page-name">${escapeClinicalMapHtml(pageName)}</b>`;
}

function insertBridge(section) {
  const content = document.getElementById("content");
  if (!content || document.getElementById(section.id)) return false;
  const hero = content.querySelector(".navigator-hero");
  if (!hero) return false;
  hero.insertAdjacentElement("afterend", section);
  return true;
}

function renderBoundary(section, message) {
  const target = section.querySelector("[data-clinical-map-connections]");
  const status = section.querySelector("[data-clinical-map-bridge-status]");
  target.innerHTML = `<div class="clinical-map-blocked">${escapeClinicalMapHtml(message)}</div>`;
  status.className = "badge restricted";
  status.textContent = "Boundary locked";
}

async function populateBridge(section) {
  const target = section.querySelector("[data-clinical-map-connections]");
  const status = section.querySelector("[data-clinical-map-bridge-status]");
  target.innerHTML = '<div class="loading">Checking the protected clinical backbone…</div>';
  status.className = "badge warning";
  status.textContent = "Checking connections";
  try {
    const client = await createEncounterCloudClient();
    const connections = await loadClinicalMapConnections(client);
    target.innerHTML = connections.map(renderConnectionCard).join("");
    const connected = connections.filter((item) => item.state === "connected").length;
    status.className = `badge ${connected === connections.length ? "complete" : "warning"}`;
    status.textContent = `${connected} of ${connections.length} verified`;
  } catch (error) {
    renderBoundary(section, clean(error?.message, 500) || "The protected clinical backbone could not be verified.");
  }
}

export function bootstrapWholePersonClinicalMapBridge() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  applyFormalName();
  const patientId = new URLSearchParams(window.location.search).get("patient") || SYNTHETIC_CLINICAL_MAP_PATIENT_ID;
  const configuredOrigin = document.querySelector('meta[name="bhw-health-core-ehr-origin"]')?.content
    || DEFAULT_HEALTH_CORE_ORIGIN;
  let origin;
  try {
    origin = validateHealthCoreOrigin(configuredOrigin);
  } catch (error) {
    origin = DEFAULT_HEALTH_CORE_ORIGIN;
  }
  const section = bridgeShell(origin);
  let loaded = false;
  const mount = () => {
    if (!insertBridge(section)) return false;
    if (patientId !== SYNTHETIC_CLINICAL_MAP_PATIENT_ID) {
      renderBoundary(section, "No record opened. This bridge is restricted to reserved synthetic patient BHW0000.");
      return true;
    }
    if (!loaded) {
      loaded = true;
      populateBridge(section);
    }
    return true;
  };
  if (!mount()) {
    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.getElementById("content") || document.body, { childList: true, subtree: true });
  }
  document.getElementById("refresh")?.addEventListener("click", () => {
    window.setTimeout(() => {
      const current = document.getElementById("clinical-map-connections");
      if (current && patientId === SYNTHETIC_CLINICAL_MAP_PATIENT_ID) populateBridge(current);
    }, 250);
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  bootstrapWholePersonClinicalMapBridge();
}
