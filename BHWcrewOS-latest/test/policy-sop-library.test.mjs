import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const library = readFileSync(resolve(root, "bhw-policy-sop-library.html"), "utf8");
const hq = readFileSync(resolve(root, "hq-home.mjs"), "utf8");
const crew = readFileSync(resolve(root, "index.html"), "utf8");

const policies = [
  "Master Compliance Plan",
  "HIPAA Security and Technology Policy",
  "Infection Control and OSHA Exposure Control Policy",
  "CLIA Waived and Point of Care Testing Policy",
  "Medication Management and Refill Policy",
  "Controlled Substance and Maryland PDMP Policy",
  "Lab, Imaging, Referral, and Critical Result Tracking Policy",
  "Vaccine and ImmuNet Policy",
  "Emergency Preparedness Policy",
  "Nondiscrimination, Accessibility, and Language Access Policy",
  "Reportable Disease and Public Health Policy",
  "BHW Care Standard and Communication Culture Policy",
  "Internal Handoff, Role Accountability, and Mission Drift Policy",
];

const appendices = [
  "Staff Documentation Audit Tool",
  "Group Pathway Approval Form",
  "Patient Rights and Responsibilities Handout",
  "Attendance and Cancellation Policy",
  "Staff Confidentiality Agreement",
  "Incident Report Form",
  "Release of Information Form",
  "Part 2 Consent Addendum",
];

test("protected BHW policy and SOP library includes every required section", () => {
  assert.match(library, /<script src="\/crew-provider-gate\.js"><\/script>/);
  assert.ok(library.indexOf("crew-provider-gate.js") < library.indexOf("</head>"));
  for (const title of [...policies, ...appendices]) assert.ok(library.includes(title), `${title} missing`);
  assert.match(library, /Controlled Draft/);
  assert.match(library, /not effective policy until the approval and effective-date fields are completed/i);
});

test("CrewHQ and division resource sections expose the controlled library", () => {
  assert.match(hq, /Policies & SOPs/);
  assert.match(hq, /\/bhw-policy-sop-library\.html/);
  assert.match(crew, /BHW Medical Group Policy & SOP Library/);
  assert.match(crew, /BHW Medical Group Appendix Forms/);
  assert.match(crew, /const cats = \["Policy"/);
});

test("policy PDFs are available inside the authenticated site bundle", () => {
  for (const name of [
    "BHW_Master_Compliance_Safety_Culture_Policies.pdf",
    "BHW_Policy_Appendix_Forms.pdf",
    "BHW_Policies_Procedures_Manual.pdf",
  ]) {
    const path = resolve(root, "docs", name);
    assert.equal(existsSync(path), true, `${name} missing`);
    assert.ok(statSync(path).size > 100_000, `${name} is unexpectedly small`);
  }
});
