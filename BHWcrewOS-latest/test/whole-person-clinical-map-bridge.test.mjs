import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLINICAL_MAP_SUBTITLE,
  CLINICAL_MAP_TITLE,
  healthCoreDestinations,
  loadClinicalMapConnections,
  SYNTHETIC_CLINICAL_MAP_PATIENT_ID,
  validateHealthCoreOrigin,
} from "../provider/whole-person-clinical-map-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = path.join(root, "provider");
const moduleSource = fs.readFileSync(path.join(provider, "whole-person-clinical-map-bridge.mjs"), "utf8");
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

test("all eight legacy Patient 360 routes present the formal Whole-Person Clinical Map identity", () => {
  assert.equal(CLINICAL_MAP_TITLE, "BHW Whole-Person Clinical Map");
  assert.equal(CLINICAL_MAP_SUBTITLE, "PSCM longitudinal synthesis, body-system mapping, and feasible care planning");
  assert.equal(SYNTHETIC_CLINICAL_MAP_PATIENT_ID, "BHW0000");
  for (const page of pages) {
    const html = fs.readFileSync(path.join(provider, page), "utf8");
    assert.match(html, /BHW Whole-Person Clinical Map/);
    assert.match(html, /PSCM longitudinal synthesis/);
    assert.match(html, /◉ Clinical Map/);
    assert.match(html, /name="bhw-health-core-ehr-origin"/);
    assert.match(html, /whole-person-clinical-map-bridge\.css/);
    assert.match(html, /patient-360-app\.mjs/);
    assert.match(html, /whole-person-clinical-map-bridge\.mjs/);
    assert.match(html, /family=Montserrat/);
  }
});

test("existing Patient 360 filenames remain stable while display naming changes", () => {
  const discovered = fs.readdirSync(provider).filter((name) => /^patient-360(?:-[a-z]+)?\.html$/.test(name));
  assert.equal(discovered.length, 8);
  assert.deepEqual(new Set(discovered), new Set(pages));
});

test("Health Core destinations remain synthetic, source-specific, and open the canonical workflows", () => {
  const destinations = healthCoreDestinations("https://bhw-health-core-ehr-awknhudemq-uk.a.run.app");
  assert.deepEqual(destinations.map((item) => item.id), [
    "chart-summary",
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
  assert.match(destinations.find((item) => item.id === "encounter").href, /clinical-documentation\.html.*#encounter-note/);
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

test("Clinical Map reads the connected Health Core workspaces without creating a second record", async () => {
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

test("bridge remains read-only and names the application boundaries", () => {
  assert.match(moduleSource, /Clinical Map is the synthesis workspace/);
  assert.match(moduleSource, /Health Core remains the canonical record/);
  assert.match(moduleSource, /CrewOS owns operational follow-through/);
  assert.match(moduleSource, /Care Connect receives only provider-approved patient-safe information/);
  assert.match(moduleSource, /opaque, short-lived, treatment-purpose context/);
  assert.match(moduleSource, /target="_blank" rel="noopener noreferrer"/);
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
  assert.doesNotMatch(css, /font-family:\s*(?!var)/);
});
