import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PATIENT_WORKSPACE_DESTINATIONS } from "../cloud/operations-api/clinical-context.mjs";
import {
  PATIENT_360_LEGACY_ALIASES,
  PATIENT_360_SHORT_TITLE,
  PATIENT_360_SUBTITLE,
  PATIENT_360_TITLE,
  PROVIDER_360_BOUNDARY,
  PROVIDER_360_SHORT_TITLE,
  PROVIDER_360_TITLE,
} from "../provider/provider-360-naming.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = path.join(root, "provider");
const docs = path.join(root, "docs");
const registry = path.join(provider, "patient-registry.html");
const patientPages = [
  "patient-360.html",
  "patient-360-atlas.html",
  "patient-360-timeline.html",
  "patient-360-mechanism.html",
  "patient-360-context.html",
  "patient-360-plan.html",
  "patient-360-data.html",
  "patient-360-sources.html",
];

test("Provider 360 contains the canonical Patient 360 workspace", () => {
  assert.equal(PROVIDER_360_TITLE, "BHW Provider 360");
  assert.equal(PROVIDER_360_SHORT_TITLE, "Provider 360");
  assert.equal(PATIENT_360_TITLE, "BHW Patient 360");
  assert.equal(PATIENT_360_SHORT_TITLE, "Patient 360");
  assert.equal(PATIENT_360_SUBTITLE, "PSCM longitudinal synthesis, body-system mapping, and feasible care planning");
  assert.match(PROVIDER_360_BOUNDARY, /Provider 360 is the provider environment/);
  assert.match(PROVIDER_360_BOUNDARY, /Patient 360 is the selected-patient longitudinal workspace/);
  assert.ok(PATIENT_360_LEGACY_ALIASES.includes("PSCM Complex Patient Navigator"));
  assert.ok(PATIENT_360_LEGACY_ALIASES.includes("BHW Whole-Person Clinical Map"));
  assert.ok(!PATIENT_360_LEGACY_ALIASES.includes("Patient 360"));
});

test("all patient-specific synthesis views display Patient 360 while routes remain stable", () => {
  for (const page of patientPages) {
    const html = fs.readFileSync(path.join(provider, page), "utf8");
    assert.match(html, /BHW Patient 360/);
    assert.match(html, /◉ Patient 360/);
    assert.match(html, /Patient 360 ·/);
    assert.match(html, /clinical-map-entry\.mjs/);
    assert.doesNotMatch(html, /BHW Provider 360|BHW Whole-Person Clinical Map|PSCM Complex Patient Navigator/);
  }
});

test("Patient Registry and Operations API launch Patient 360 without changing compatibility IDs", () => {
  const registryHtml = fs.readFileSync(registry, "utf8");
  const launcher = fs.readFileSync(path.join(provider, "patient-workspace-launcher.mjs"), "utf8");
  const operations = fs.readFileSync(path.join(provider, "patient-operations.html"), "utf8");
  assert.match(registryHtml, /Patient 360 — Synthetic/);
  assert.match(registryHtml, /Open synthetic Patient 360/);
  assert.doesNotMatch(registryHtml, /Whole-Person Clinical Map|Open synthetic Clinical Map/);
  assert.match(launcher, /Open Patient 360/);
  assert.match(launcher, /data-workspace-destination="clinical-map"/);
  assert.match(operations, /href="patient-360\.html">◉ Patient 360/);
  assert.equal(PATIENT_WORKSPACE_DESTINATIONS["clinical-map"].label, "BHW Patient 360");
  assert.equal(PATIENT_WORKSPACE_DESTINATIONS["clinical-map"].launchPath, "/provider/patient-360.html");
  assert.equal(PATIENT_WORKSPACE_DESTINATIONS["clinical-map"].requiredScope, "clinical-map.read");
});

test("governance documentation separates Patient 360, Health Core, and Patient Operations", () => {
  const naming = fs.readFileSync(path.join(docs, "PROVIDER_360_NAMING_CONTRACT.md"), "utf8");
  const handoff = fs.readFileSync(path.join(docs, "PATIENT_REGISTRY_SECURE_WORKSPACE_HANDOFF.md"), "utf8");
  assert.match(naming, /Provider 360.*provider environment/i);
  assert.match(naming, /Patient 360.*selected-patient longitudinal workspace/i);
  assert.match(naming, /Health Core Clinical Access.*current-visit/i);
  assert.match(naming, /Patient Operations \/ Patient Worklist.*execution workspace/i);
  assert.match(naming, /Care Connect.*provider-approved, patient-safe information/i);
  assert.match(naming, /There is no Trauma program label/i);
  assert.match(handoff, /### Patient 360/);
  assert.match(handoff, /technical destination key `clinical-map`/);
  assert.match(handoff, /program-lens launch controls are required next-phase work/i);
  assert.match(handoff, /There is no Trauma program/i);
});
