import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("Primary Care and Care Management cards receive persistent collapse controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /COLLAPSIBLE_DIVISION_VIEWS = \["view-primary-care", "view-care-management"\]/);
  assert.match(html, /function installDivisionCollapsibles\(\)/);
  assert.match(html, /installDivisionCollapsibles\(\);/);
  assert.match(html, /aria-controls/);
  assert.match(html, /aria-expanded/);
  assert.match(html, /Collapse all sections/);
  assert.match(html, /Expand all sections/);
  assert.match(html, /bhw-crewos-collapse:/);
  assert.match(html, /sessionStorage\.setItem/);
  assert.match(html, /record\.closest\("\.collapsible-card\.is-collapsed"\)/);
});

function loadStatusHandler(source, env = {}) {
  const exports = {};
  const context = {
    Buffer,
    exports,
    process: { env },
    require(id) {
      if (id === "https") return { request() { throw new Error("status must not call Stedi"); } };
      if (id === "./_lib") return {
        getSession: () => ({ staffId: "synthetic-test" }),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      };
      if (id === "./lib/cloud-patients") return {
        cloudRequest: async () => { throw new Error("status must not call BHW Cloud"); },
        listCloudPatients: async () => { throw new Error("status must not load patients"); },
      };
      throw new Error(`Unexpected require: ${id}`);
    },
  };
  vm.runInNewContext(source, context);
  return exports.handler;
}

test("Stedi status is authenticated, patient-free, and distinguishes configured credentials", async () => {
  const source = await readFile(new URL("../netlify/functions/stedi.js", import.meta.url), "utf8");
  const event = { httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "status" }) };

  const missing = await loadStatusHandler(source)(event);
  assert.equal(missing.statusCode, 200);
  assert.deepEqual(JSON.parse(missing.body), {
    configured: false,
    provider: "Stedi",
    product: "CMS HETS 270/271 eligibility",
    checksPatientData: false,
  });

  const configured = await loadStatusHandler(source, { STEDI_KEY_PREFIX: "part-a", STEDI_KEY_SUFFIX: "part-b" })(event);
  assert.equal(configured.statusCode, 200);
  assert.equal(JSON.parse(configured.body).configured, true);
});

test("AWV connection copy separates configured credentials from successful eligibility responses", async () => {
  const [html, opsData, stedi] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/stedi.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Stedi credentials configured/);
  assert.match(html, /No successful eligibility response recorded yet/);
  assert.doesNotMatch(html, /Live from CMS \(HETS\) via Stedi/);
  assert.match(opsData, /profile\.coverageCheckedAt \|\| profile\.updatedAt/);
  assert.match(opsData, /sourceSystem: profile\.sourceSystem/);
  assert.match(opsData, /coverageError:/);
  assert.match(stedi, /hostname: "healthcare\.us\.stedi\.com"/);
  assert.match(stedi, /medicalnetwork\/eligibility\/v3/);
  assert.match(stedi, /resolveMedicareMbi\(patient\)/);
  assert.match(html, /\(div==="Care Management"\|\|div==="Primary Care"\) \? prevCard\(\) : ""/);
});

test("shared AWV queue links payer gaps by authoritative patient ID and refreshes both views", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /bhwPatientId:p\.id\|\|""/);
  assert.match(html, /byPatientId\[String\(pt\.bhwPatientId\)\.toUpperCase\(\)\]/);
  assert.match(html, /CARE_GAPS\.byPatientId\[String\(p\.id\|\|""\)\.toUpperCase\(\)\]/);
  assert.match(html, /function gapsRefresh\(\)/);
  assert.match(html, /CARE_GAPS = null;\s+CARE_GAPS_ERROR = "";\s+buildRail\(\); buildViews\(\);/);
  assert.match(html, /Open care gaps come from the reviewed payer gap feed in BHW Cloud/);
  assert.match(html, /payer gaps never change the clinical chart without provider review/);
  assert.match(html, /No payer row/);
  assert.match(html, /Gap feed unavailable/);
});
