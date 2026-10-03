import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  HETS_MEDICARE_SERVICE_BUNDLE,
  normalizeHetsMeasures,
} = require("../netlify/functions/lib/hets-preventive.js");

test("CMS request bundle asks for general, AWV, audiology, Pap, and preventive HCPCS benefits", () => {
  const requested = new Set(HETS_MEDICARE_SERVICE_BUNDLE.map(({ system, value }) => `${system}:${value}`));
  for (const code of ["STC:30", "STC:BZ", "STC:71", "STC:BT", "HCPCS:77067", "HCPCS:G0444", "HCPCS:81528"]) {
    assert.equal(requested.has(code), true, `missing ${code}`);
  }
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
