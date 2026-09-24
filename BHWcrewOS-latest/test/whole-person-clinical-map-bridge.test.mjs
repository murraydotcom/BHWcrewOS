import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  healthCoreDestinations,
  loadClinicalMapConnections,
  SYNTHETIC_CLINICAL_MAP_PATIENT_ID,
  validateHealthCoreOrigin,
} from "../provider/whole-person-clinical-map-bridge.mjs";
import {
  PROVIDER_360_LEGACY_ALIASES,
  PROVIDER_360_SHORT_TITLE,
  PROVIDER_360_SUBTITLE,
  PROVIDER_360_TITLE,
} from "../provider/provider-360-naming.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = path.join(root, "provider");
const moduleSource = fs.readFileSync(path.join(provider, "whole-person-clinical-map-bridge.mjs"), "utf8");
const namingSource = fs.readFileSync(path.join(provider, "provider-360-naming.mjs"), "utf8");
const entrySource = fs.readFileSync(path.join(provider, "clinical-map-entry.mjs"), "utf8");
const launcherSource = fs.readFileSync(path.join(provider, "patient-workspace-launcher.mjs"), "utf8");
const css = fs.readFileSync(path.join(provider, "whole-person-clinical-map-bridge.css"), "utf8");

const pages = [
  "patient-360.html",
  "patient-360-atlas.html",
  "patient-360-timeline.html",
  "patient-360-mechanism.html",
  "patient-360-context.html",
  "patient-360-plan.html",
  "patient-360-data.html",
  "patient-360-sources.html",
];

test("all eight legacy Patient 360 routes present the canonical Provider 360 identity", () => {
  assert.equal(PROVIDER_360_TITLE, "BHW Provider 360");
  assert.equal(PROVIDER_360_SHORT_TITLE, "Provider 360");
  assert.equal(PROVIDER_360_SUBTITLE, "PSCM longitudinal synthesis, body-system mapping, and feasible care planning");
  assert.equal(SYNTHETIC_CLINICAL_MAP_PATIENT_ID, "BHW0000");
  assert.ok(PROVIDER_360_LEGACY_ALIASES.includes("PSCM Complex Patient Navigator"));
  assert.ok(PROVIDER_360_LEGACY_ALIASES.includes("BHW Whole-Person Clinical Map"));

  for (const page of pages) {
    const html = fs.readFileSync(path.join(provider, page), "utf8");
    assert.match(html, /BHW Provider 360/);
    assert.match(html, /PSCM longitudinal synthesis/);
    assert.match(html, /◉ Provider 360/);
    assert.doesNotMatch(html, /BHW Whole-Person Clinical Map|PSCM Complex Patient Navigator/);
    assert.match(html, /name="bhw-health-core-ehr-origin"/);
    assert.match(html, /whole-person-clinical-map-bridge\.css/);
    assert.match(html, /clinical-map-entry\.mjs/);
    assert.match(html, /family=Montserrat/);
  }
  const entry = fs.readFileSync(path.join(provider, "clinical-map-entry.mjs"), "utf8");
  assert.match(entry, /import\("\.\/whole-person-clinical-map-bridge\.mjs"\)/);
});

test("existing Patient 360 filenames and clinical-map compatibility identifiers remain stable", () => {
  const discovered = fs.readdirSync(provider).filter((name) => /^patient-360(?:-[a-z]+)?\.html$/.test(name));
  assert.equal(discovered.length, 8);
  assert.deepEqual(new Set(discovered), new Set(pages));
  assert.match(entrySource, /patient-360/);
  assert.match(launcherSource, /data-workspace-destination="clinical-map"/);
  assert.match(launcherSource, /Open Provider 360/);
});

test("Provider 360 naming layer supersedes historical display aliases without changing routes", () => {
  assert.match(namingSource, /BHW Provider 360/);
  assert.match(namingSource, /Whole-Person Clinical Map/);
  assert.match(namingSource, /Complex Patient Navigator/);
  assert.match(entrySource, /applyProvider360Naming/);
  assert.match(entrySource, /observeProvider360Naming/);
  assert.match(entrySource, /treatment-purpose read access to Provider 360/);
});

test("Health Core destinations remain synthetic, source-specific, and open the canonical workflows", () => {
  const destinations = healthCoreDestinations("https://bhw-health-core-ehr-awknhudemq-uk.a.run.app");
  assert.deepEqual(destinations.map((item) => item.id), [
    "chart-summary",
    "nutrition",
    "encounter",
    "labs",
    "orders",
    "blueprint",
  ]);
  for (const destination of destinations) {
    assert.match(destination.href, /^https:\/\/bhw-health-core-ehr-awknhudemq-uk\.a\.run\.app\//);
    assert.match(destination.href, /patient=BHW0000/);
  }
  assert.match(destinations.find((item) => item.id === "orders").href, /order-composer\.html/);
  assert.match(destinations.find((item) => item.id === "nutrition").href, /nutrition-intelligence\.html/);
  assert.match(destinations.find((item) => item.id === "encounter").href, /clinical-documentation\.html.*#encounter-note/);
});

test("CrewOS Nutrition Intelligence is a safe handoff to the Health Core-owned workspace", () => {
  const html = fs.readFileSync(path.join(provider, "nutrition-intelligence.html"), "utf8");
  const handoff = fs.readFileSync(path.join(provider, "nutrition-health-core-handoff.mjs"), "utf8");
  assert.match(html, /name="bhw-health-core-ehr-origin"/);
  assert.match(html, /nutrition-health-core-handoff\.mjs/);
  assert.match(html, /id="nutrition-health-core-static-handoff"/);
  assert.match(html, /<form id="nutrition-form" novalidate hidden>/);
  assert.doesNotMatch(html, /<script type="module" src="nutrition-intelligence\.mjs"/);
  assert.match(handoff, /Care Connect nutrition answers are stored and reconciled.*Health Core/);
  assert.match(handoff, /CrewOS receives only the minimum operational task metadata/);
  assert.match(handoff, /No patient identifier transmitted/);
  assert.doesNotMatch(handoff, /savePatientNutritionIntelligence/);
});

test("Health Core link validation accepts only trusted HTTPS service origins", () => {
  assert.equal(
    validateHealthCoreOrigin("https://bhw-health-core-ehr-awknhudemq-uk.a.run.app"),
    "https://bhw-health-core-ehr-awknhudemq-uk.a.run.app",
  );
  assert.equal(validateHealthCoreOrigin("https://ehr.bhwmedical.org"), "https://ehr.bhwmedical.org");
  for (const value of [
    "http://bhwmedical.org",
    "https://example.com",
    "https://user:password@ehr.bhwmedical.org",
    "https://ehr.bhwmedical.org/path",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => validateHealthCoreOrigin(value), /trusted HTTPS service origin|configured safely/);
  }
});

test("Provider 360 reads connected Health Core workspaces without creating a second record", async () => {
  const client = {
    async healthRecord() {
      return { record: { entry: [
        { resource: { resourceType: "Condition" } },
        { resource: { resourceType: "Observation" } },
        { resource: { resourceType: "CarePlan" } },
        { resource: { resourceType: "Task" } },
      ] } };
    },
    async patientAtlas() {
      return { workspace: { approved: { version: 3 } } };
    },
    async patientClinicalEvents() {
      return { workspace: { approvedEvents: [{ eventId: "event-1" }] } };
    },
    async patientVisitNotes() {
      return { notes: [{ noteId: "note-1" }, { noteId: "note-2" }] };
    },
    async patientNutritionIntelligence() {
      return { workspace: { published: { version: 2 } } };
    },
  };
  const connections = await loadClinicalMapConnections(client);
  assert.equal(connections.length, 5);
  assert.equal(connections.every((item) => item.state === "connected"), true);
  assert.match(connections.find((item) => item.id === "health-record").detail, /4 source-linked resources/);
  assert.match(connections.find((item) => item.id === "body-system-atlas").detail, /approved Atlas v3/);
  assert.match(connections.find((item) => item.id === "visit-documentation").detail, /2 signed or provider-approved visit notes/);
  assert.match(connections.find((item) => item.id === "nutrition-intelligence").detail, /Published Nutrition Intelligence v2/);
});

test("bridge remains read-only and the naming layer presents Provider 360 boundaries", () => {
  assert.match(moduleSource, /Health Core remains the canonical record/);
  assert.match(moduleSource, /CrewOS owns operational follow-through/);
  assert.match(moduleSource, /Care Connect receives only provider-approved patient-safe information/);
  assert.match(moduleSource, /opaque, short-lived, treatment-purpose context/);
  assert.match(moduleSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(namingSource, /Provider 360 is the synthesis workspace/);
  assert.doesNotMatch(moduleSource, /\.savePatientAtlas\(/);
  assert.doesNotMatch(moduleSource, /\.savePatientClinicalEvent\(/);
  assert.doesNotMatch(moduleSource, /\.savePatientNutritionIntelligence\(/);
});

test("bridge styling inherits the existing Opal and Ironstone tokens", () => {
  assert.match(css, /var\(--card\)/);
  assert.match(css, /var\(--green\)/);
  assert.match(css, /var\(--teal\)/);
  assert.match(css, /var\(--gold\)/);
  assert.match(css, /var\(--edge-gold\)/);
  assert.match(css, /clinical-map-connection-grid/);
  assert.match(css, /clinical-map-destination-grid/);
  assert.doesNotMatch(css, /font-family:/);
});
