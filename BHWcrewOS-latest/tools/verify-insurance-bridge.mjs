// Offline acceptance trace: node tools/verify-insurance-bridge.mjs /path/to/bhw-rcm-platform
// All records live only in memory. Fetch is replaced and rejects unexpected destinations.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import registryHandler from "../netlify/functions/patient-registry.mjs";
import { createPatientRegistryClient } from "../provider/patient-registry-client.mjs";
import * as coverage from "../shared/patient-coverage.mjs";
import * as insuranceImport from "../provider/patient-insurance-import.mjs";

if (!process.argv[2]) throw new Error("Pass the local, reviewed RCM checkout path.");
const { createHandler } = await import(pathToFileURL(resolve(process.argv[2], "cloud/rcm-api/app.mjs")));
const require = createRequire(import.meta.url);
const { legacyPatient } = require("../netlify/functions/lib/cloud-patients.js");
const { buildPatientDirectory } = require("../netlify/functions/lib/crew-patient-directory.js");
const mbi = "1EG4TE5MK73";
const stored = new Map();
const backend = createHandler({
  savePatient: async (patient) => stored.set(patient.bhwPatientId, structuredClone(patient)),
  getPatient: async (id) => stored.get(id) || null,
  listPatients: async () => [...stored.values()].map((patient) => structuredClone(patient)),
}, { CREWHQ_CLOUD_TOKEN_SECRET: "synthetic-cloud-secret", ALLOWED_ORIGIN: "https://crew.example.test" });
const environment = new Map([
  ["SESSION_SECRET", "synthetic-session-secret"],
  ["CREWHQ_CLOUD_TOKEN_SECRET", "synthetic-cloud-secret"],
  ["RCM_CLOUD_API_URL", "https://rcm.example.test"],
]);
const session = { staffId: "synthetic-staff", name: "Synthetic Staff", role: "operations-manager", access: "Admin", exp: Date.now() + 300_000 };
const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
const token = `${payload}.${crypto.createHmac("sha256", "synthetic-session-secret").update(payload).digest("base64url")}`;
globalThis.Netlify = { env: { get: (name) => environment.get(name) || "" } };
globalThis.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, "https://rcm.example.test", "Unexpected network destination");
  return backend(new Request(url, options));
};
const client = await createPatientRegistryClient(async (_url, options) => registryHandler(new Request("https://crew.example.test/.netlify/functions/patient-registry", options)), {
  getItem: () => token,
  removeItem() {},
});

// Run the actual Registry form serializer and renderer without its startup/network work.
const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, { value: "", checked: false, innerHTML: "", classList: { add() {}, remove() {} } });
  return elements.get(id);
};
const app = (await readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const source = app.slice(0, app.indexOf('$("search").oninput')).replace(/^import[\s\S]*?;\n/gm, "");
const ui = vm.createContext({ ...coverage, ...insuranceImport, document: { getElementById: element, querySelectorAll: () => [] }, clearTimeout() {}, setTimeout() {} });
vm.runInContext(`${source}\nglobalThis.form = { readPatient, patientFields, renderRows };`, ui);
const scenarios = [
  ["BHW9997", "original-medicare", "Medicare", "medicaid-mco", "Maryland Physicians Care", mbi, "primary", "Medicare + Medicaid"],
  ["BHW9998", "commercial", "CareFirst BCBS", "original-medicare", "Medicare", mbi, "secondary", "Medicare"],
  ["BHW9999", "medicare-advantage", "UnitedHealthcare Dual Complete", "", "", "", "primary", "Medicare + Medicaid"],
];
stored.set("BHW9998", {
  bhwPatientId: "BHW9998",
  legalFirstName: "Synthetic",
  legalLastName: "BHW9998",
  dateOfBirth: "1980-01-02",
  patientStatus: "active",
  mrn: "SYNTHETIC-MRN",
  address: "Synthetic Baltimore address",
  programEnrollment: ["CCM"],
  sourceRelations: { carePlans: ["synthetic-care-plan"] },
  clinicalSnapshot: { allergies: "Synthetic allergy" },
  createdAt: "2026-10-05T11:00:00.000Z",
  updatedAt: "2026-10-05T12:00:00.000Z",
});
for (const [id, primaryType, primaryName, secondaryType, secondaryName, explicitMbi, order, category] of scenarios) {
  for (const [key, value] of Object.entries({ First: "Synthetic", Last: id, Dob: "1980-01-02", Status: "active", MedicareMbi: explicitMbi })) element(`d${key}`).value = value;
  for (const [slot, type, name] of [["Primary", primaryType, primaryName], ["Secondary", secondaryType, secondaryName], ["Other", "medicare-supplement", "Synthetic Supplement"]]) {
    for (const [field, value] of Object.entries({ Type: type, Payer: name, Plan: "", Member: name ? slot === "Primary" && !explicitMbi ? mbi : `${id}-${slot}` : "", Group: name ? `${slot}-GROUP` : "", PayerId: name ? `${slot}-PAYER` : "", Coverage: "verified", From: name ? "2026-01-01" : "", To: "", MspReason: order === "secondary" && slot === "Secondary" ? "12" : "" })) element(`d${slot}${field}`).value = value;
  }
  const intended = ui.form.readPatient("d", id);
  const current = stored.get(id);
  await client.savePatient(intended, current?.updatedAt || "");
  const actual = (await client.listPatients()).find((patient) => patient.bhwPatientId === id);
  assert.deepEqual(coverage.insuranceStorageForPatient(actual), coverage.insuranceStorageForPatient(intended));
  const html = ui.form.patientFields(actual);
  for (const name of [primaryName, secondaryName, "Synthetic Supplement"].filter(Boolean)) assert.ok(html.includes(name));
  assert.ok(html.includes('data-coverage-order="primary"') && html.includes('data-coverage-order="secondary"') && html.includes('data-coverage-order="other"'));
  const adapted = legacyPatient(actual);
  const [directoryPatient] = buildPatientDirectory([adapted]).patients;
  assert.equal(directoryPatient.insurance, category);
  assert.equal(directoryPatient.medicareCoverageOrder, order);
  assert.equal(directoryPatient.hasMbi, Boolean(explicitMbi));
  assert.equal(adapted.payer, primaryName);
  assert.equal(adapted.memberId, intended.memberId);
  if (id === "BHW9998") {
    assert.equal(actual.mrn, "SYNTHETIC-MRN");
    assert.equal(actual.address, "Synthetic Baltimore address");
    assert.deepEqual(actual.programEnrollment, ["CCM"]);
    assert.deepEqual(actual.sourceRelations.carePlans, ["synthetic-care-plan"]);
    assert.equal(actual.clinicalSnapshot.allergies, "Synthetic allergy");
  }
}
const roster = [...stored.values()].map(legacyPatient);
const fixture = roster.find((patient) => patient.bhwPatientId === "BHW9998");
const common = { getSession: () => session, json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) };
function loadReadSide(filename, cloudRequest) {
  const exports = {};
  const context = { exports, Date, URLSearchParams, require: (id) => {
    if (id === "./_lib") return common;
    if (id === "./lib/cloud-patients") return { listCloudPatients: async () => roster, cloudRequest };
    if (id === "./lib/operations-cloud") return { operationsRequest: async () => ({ requests: [] }) };
    if (id === "./lib/hets-preventive") return require("../netlify/functions/lib/hets-preventive.js");
    throw new Error(`Unexpected dependency: ${id}`);
  } };
  return readFile(new URL(`../netlify/functions/${filename}`, import.meta.url), "utf8").then((text) => { vm.runInNewContext(text, context); return exports.handler; });
}
const gaps = await loadReadSide("care-gaps.js", async () => ({ profiles: [{ bhwPatientId: fixture.bhwPatientId, preventiveGaps: [{ code: "AWV", label: "Annual Wellness Visit", open: true, state: "Open" }], preventiveServices: [{ code: "92552", info: "Synthetic benefit evidence" }] }] }));
const gapResponse = await gaps({ httpMethod: "POST", body: JSON.stringify({ action: "for", bhwPatientId: fixture.bhwPatientId }) });
assert.equal(gapResponse.statusCode, 200);
const gapBody = JSON.parse(gapResponse.body);
assert.equal(gapBody.patient.hasMbi, true);
assert.equal(gapBody.patient.medicareCoverageOrder, "secondary");
assert.equal(gapBody.patient.memberId, fixture.memberId);
assert.equal(gapBody.gaps.find((gap) => gap.measureId === "hearing-audiology-assessment").open, false);
const care = await loadReadSide("care-log-data.js", async (path) => path.includes("/logs?") ? ({ logs: [{ id: "synthetic-log", bhwPatientId: fixture.bhwPatientId, program: "CCM", serviceMonth: "2026-10-01", updatedAt: "2026-10-05", status: "Open" }] }) : ({ enrollments: [{ bhwPatientId: fixture.bhwPatientId, program: "CCM" }] }));
const careResponse = await care({ httpMethod: "POST", body: JSON.stringify({ action: "list", windowEnd: "2026-10-05" }) });
assert.equal(careResponse.statusCode, 200);
const careBody = JSON.parse(careResponse.body);
for (const row of [careBody.entries[0], careBody.enrollments[0], careBody.monthClose.entries[0], careBody.patients.find((patient) => patient.bhwPatientId === fixture.bhwPatientId)]) {
  assert.equal(row.hasMbi, true);
  assert.equal(row.medicareCoverageOrder, "secondary");
}
const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const awvSource = shell.slice(shell.indexOf("function prevCard(){"), shell.indexOf("// ---- Care gaps"));
const awv = vm.createContext({ D: { patients: buildPatientDirectory(roster).patients, prevention: [], awv: [] }, esc: (value) => String(value), gapsCell: () => "", stediConnectionSummary: () => "" });
vm.runInContext(`${awvSource}\nglobalThis.html = prevCard();`, awv);
for (const patient of roster) assert.ok(awv.html.includes(patient.name));
assert.ok(awv.html.includes("MBI on file · secondary"));
assert.ok(awv.html.includes("MBI needed"));
const stale = structuredClone(stored.get("BHW9998"));
stored.set("BHW9998", { ...stale, phone: "4105550199", updatedAt: "2026-10-05T13:00:00.000Z" });
await assert.rejects(
  () => client.savePatient({ ...stale, phone: "4105550100" }, stale.updatedAt),
  /changed after it was loaded/i,
);
assert.equal(stored.get("BHW9998").phone, "4105550199");
const invalid = { ...stored.get("BHW9998"), coverageRecords: [{ coverageOrder: "secondary", insuranceType: "original-medicare", payerName: "Medicare", medicareSecondaryReason: "99" }] };
const beforeInvalid = JSON.stringify(stored.get("BHW9998"));
await assert.rejects(() => client.savePatient(invalid), /Medicare-secondary reason is not supported/);
await assert.rejects(() => client.savePatient({ ...stored.get("BHW9998"), medicareMbi: "invalid" }), /valid 11-character MBI/);
assert.equal(JSON.stringify(stored.get("BHW9998")), beforeInvalid);
console.log("PASS: offline Registry form → signed proxy → reviewed RCM → read-back → AWV, care gaps, Care Management; primary, secondary, additional, MBI/MSP and HETS boundaries verified.");
