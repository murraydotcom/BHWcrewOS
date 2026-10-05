import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  HETS_MEDICARE_SERVICE_BUNDLE,
  normalizeHetsMeasures,
  preventiveCatalogForUi,
} = require("../netlify/functions/lib/hets-preventive.js");

test("CMS request bundle asks for general, AWV, audiology, Pap, and preventive HCPCS benefits", () => {
  const requested = new Set(HETS_MEDICARE_SERVICE_BUNDLE.map(({ system, value }) => `${system}:${value}`));
  for (const code of ["STC:30", "STC:BZ", "STC:71", "STC:BT", "STC:67", "STC:CQ", "STC:80", "STC:CO", "STC:BD", "HCPCS:77067", "HCPCS:G0444", "HCPCS:81528"]) {
    assert.equal(requested.has(code), true, `missing ${code}`);
  }
});

test("catalog covers every current CMS preventive-service category without making every service a gap", () => {
  const catalog = preventiveCatalogForUi();
  const cmsServices = catalog.flatMap((item) => item.cmsServices);
  assert.equal(cmsServices.length, 34);
  for (const name of [
    "Annual wellness visits",
    "Diabetes self-management training",
    "Glaucoma screening",
    "Medical nutrition therapy",
    "Medicare Part D vaccines",
    "Screening pelvic exams including clinical breast exam",
  ]) assert.equal(cmsServices.includes(name), true, `missing ${name}`);
  assert.equal(catalog.find((item) => item.measureId === "glaucoma-screening").hetsQueryable, false);
  assert.equal(catalog.find((item) => item.measureId === "annual-wellness-visit").hetsQueryable, true);
});

test("HETS service-type responses normalize to one clinical decision per benefit", () => {
  const result = normalizeHetsMeasures({ preventiveServices: [
    { code: "STC:67", info: "Synthetic tobacco cessation benefit" },
    { code: "STC:CQ", info: "Synthetic MDPP benefit" },
    { code: "STC:80", info: "Synthetic COVID vaccination benefit" },
  ] });
  assert.deepEqual(result.map((item) => item.measureId), [
    "covid-19-vaccination",
    "medicare-diabetes-prevention-program",
    "tobacco-cessation-counseling",
  ]);
  assert.equal(result.every((item) => item.open === false), true);
});

test("alternate colorectal methods become one clinical measure while retaining source evidence", () => {
  const result = normalizeHetsMeasures({
    preventiveServices: [
      { code: "81528", info: "Synthetic stool DNA benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "G0121", info: "Synthetic colonoscopy benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "G0328", info: "Synthetic FOBT benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].measureId, "colorectal-cancer-screening");
  assert.equal(result[0].open, false);
  assert.deepEqual(result[0].sourceCodes, ["81528", "G0121", "G0328"]);
});

test("reviewed payer gap and HETS variants merge without multiplying the open count", () => {
  const [measure] = normalizeHetsMeasures({
    preventiveGaps: [
      { code: "COLO", label: "Colorectal cancer screening", state: "Open", open: true },
      { code: "G0328", label: "Colorectal cancer screening", state: "Open", open: true },
    ],
    preventiveServices: [{ code: "81528", info: "Synthetic payer benefit" }],
  });
  assert.equal(measure.measureId, "colorectal-cancer-screening");
  assert.equal(measure.open, true);
  assert.equal(measure.codeCount, 3);
});
