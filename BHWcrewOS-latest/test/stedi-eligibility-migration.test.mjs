import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const hetsPreventive = require("../netlify/functions/lib/hets-preventive.js");

const syntheticPatient = {
  bhwPatientId: "BHWTEST1",
  name: "Synthetic Medicare",
  legalFirstName: "Synthetic",
  legalLastName: "Medicare",
  dateOfBirth: "1950-01-02",
  medicareMbi: "1EG4TE5MK73",
  primaryPayer: "Medicare",
  patientStatus: "Active",
};

async function loadHarness({ response, statusCode = 200, patients = [syntheticPatient] }) {
  const source = await readFile(new URL("../netlify/functions/stedi.js", import.meta.url), "utf8");
  const httpCalls = [];
  const cloudCalls = [];
  const https = {
    request(options, callback) {
      const call = { options, body: "" };
      httpCalls.push(call);
      const request = {
        on(event, handler) { if (event === "error") call.onError = handler; return request; },
        write(chunk) { call.body += String(chunk); },
        end() {
          const res = new EventEmitter();
          res.statusCode = statusCode;
          callback(res);
          res.emit("data", JSON.stringify(response));
          res.emit("end");
        },
      };
      return request;
    },
  };
  const exports = {};
  const context = {
    Buffer,
    exports,
    process: { env: { STEDI_KEY_PREFIX: "synthetic-", STEDI_KEY_SUFFIX: "key" } },
    require(id) {
      if (id === "https") return https;
      if (id === "./_lib") return {
        getSession: () => ({ staffId: "synthetic-test" }),
        json: (code, body) => ({ statusCode: code, body: JSON.stringify(body) }),
      };
      if (id === "./lib/cloud-patients") return {
        cloudRequest: async (path, options) => {
          cloudCalls.push({ path, options: JSON.parse(JSON.stringify(options)) });
          return { profile: { id: "synthetic-profile" } };
        },
        listCloudPatients: async () => patients,
        normalizeMedicareMbi: (value) => value,
        isValidMedicareMbi: () => true,
        resolveMedicareMbi: (patient) => patient.medicareMbi || "",
      };
      if (id === "./lib/hets-preventive") return hetsPreventive;
      throw new Error(`Unexpected require: ${id}`);
    },
  };
  vm.runInNewContext(source, context);
  return { handler: exports.handler, httpCalls, cloudCalls };
}

function checkEvent() {
  return {
    httpMethod: "POST",
    headers: {
      "x-nf-client-connection-ip": "192.0.2.44",
    },
    body: JSON.stringify({ action: "check", patientId: syntheticPatient.bhwPatientId }),
  };
}

test("an inconclusive HTTP 200 response remains Unknown in the saved tracker", async () => {
  const harness = await loadHarness({ response: { errors: [], plans: [] } });
  const result = JSON.parse((await harness.handler(checkEvent())).body);
  assert.equal(result.active, null);
  const tracker = harness.cloudCalls[0].options.body;
  assert.equal(tracker.coverage, "Unknown");
  assert.equal(tracker.awvStatus, "Unknown");
  assert.match(tracker.coverageNotes, /could not be determined/);
});

test("explicit inactive coverage remains Inactive rather than Unknown", async () => {
  const harness = await loadHarness({ response: { plans: [{ benefits: { statuses: [{ status: "INACTIVE_COVERAGE", service: { system: "STC", value: "30" } }] } }] } });
  const result = JSON.parse((await harness.handler(checkEvent())).body);
  assert.equal(result.active, false);
  assert.equal(harness.cloudCalls[0].options.body.coverage, "Inactive");
  assert.equal(harness.cloudCalls[0].options.body.coverageNotes, "");
});

test("CrewOS check notification preserves unknown, active and inactive outcomes", async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = page.slice(page.indexOf('async function prevCheck('), page.indexOf('function prevMbi('));
  for (const [active, expected] of [[null, 'unknown — needs review'], [true, 'coverage active'], [false, 'coverage inactive']]) {
    const notices = [];
    const context = { API_STEDI: '/stedi', api: async () => ({ active, awvStatus: 'Unknown' }), toast: message => notices.push(message), refreshSoft: async () => {} };
    vm.runInNewContext(source, context);
    await context.prevCheck('BHWTEST1');
    assert.ok(notices.at(-1).includes(expected));
  }
});

test("Stedi eligibility check uses the redesigned request and preserves the BHW tracker contract", async () => {
  const response = {
    id: "ec_synthetic",
    payerId: "CMS",
    payer: { identification: "CMS", name: { organization: "Centers for Medicare and Medicaid Services" } },
    errors: [],
    plans: [{
      name: "Medicare",
      benefits: {
        statuses: [{
          coverageLevel: "INDIVIDUAL",
          status: "ACTIVE_COVERAGE",
          service: { system: "STC", value: "30", definition: "Health Benefit Plan Coverage" },
        }],
        deductible: [
          {
            amount: "240",
            coverageLevel: "INDIVIDUAL",
            timePeriod: "CALENDAR_YEAR",
            service: { system: "STC", value: "30", definition: "Health Benefit Plan Coverage" },
          },
          {
            amount: "85",
            coverageLevel: "INDIVIDUAL",
            timePeriod: "REMAINING",
            service: { system: "STC", value: "30", definition: "Health Benefit Plan Coverage" },
          },
        ],
        contactFollowingEntityForInformation: [{
          coverageLevel: "INDIVIDUAL",
          service: { system: "STC", value: "30", definition: "Health Benefit Plan Coverage" },
          messages: ["MA Bill Option Code - A"],
          relatedEntities: [{ type: "PRIMARY_PAYER", name: { organization: "Synthetic MA Plan" } }],
        }],
        benefitDescription: [{
          coverageLevel: "INDIVIDUAL",
          service: { system: "HCPCS", value: "G0439", definition: "Subsequent annual wellness visit" },
          dates: {
            latestVisit: { start: "2000-01-15" },
            benefit: { start: "2099-01-15", end: "2099-12-31" },
          },
        }],
        invalidEntries: {
          deductible: [{
            coverageLevel: "INDIVIDUAL",
            service: { system: "HCPCS", value: "G0402", definition: "Initial preventive physical exam" },
            dates: { latestVisit: { start: "1999-02-20" } },
            invalidReasons: [{ code: "SYNTHETIC_NON_STANDARD", description: "Synthetic fixture" }],
          }],
        },
      },
    }],
  };
  const harness = await loadHarness({ response });

  const result = await harness.handler(checkEvent());

  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).ok, true);
  assert.equal(harness.httpCalls.length, 1);
  const request = harness.httpCalls[0];
  assert.equal(request.options.hostname, "healthcare.us.stedi.com");
  assert.equal(request.options.path, "/2026-06-01/eligibility-check");
  assert.equal(request.options.headers.Authorization, "Key synthetic-key");
  assert.equal(request.options.headers["X-Forwarded-For"], "192.0.2.44");
  const submitted = JSON.parse(request.body);
  assert.equal(submitted.payerId, "CMS");
  assert.equal(submitted.externalPatientId, "BHWTEST1");
  assert.deepEqual(submitted.provider, {
    name: { organization: "BALTIMORE HEALTHCARE AND WELLNESS LLC" },
    npi: "1306511597",
  });
  assert.deepEqual(submitted.subscriber, {
    memberId: "1EG4TE5MK73",
    name: { person: { firstName: "SYNTHETIC", lastName: "MEDICARE" } },
    dateOfBirth: "1950-01-02",
  });
  const requested = new Set(submitted.encounter.services.map(({ system, value }) => `${system}:${value}`));
  for (const code of ["STC:30", "STC:BZ", "STC:71", "STC:BT", "HCPCS:77067", "HCPCS:G0444"]) {
    assert.equal(requested.has(code), true, `missing ${code}`);
  }

  assert.equal(harness.cloudCalls.length, 1);
  const tracker = harness.cloudCalls[0];
  assert.equal(tracker.path, "/v1/panel/profiles");
  assert.equal(tracker.options.method, "POST");
  assert.equal(tracker.options.body.bhwPatientId, "BHWTEST1");
  assert.equal(tracker.options.body.coverage, "Active");
  assert.equal(tracker.options.body.planType, "Medicare Advantage");
  assert.equal(tracker.options.body.medicareAdvantagePlanName, "Synthetic MA Plan");
  assert.equal(tracker.options.body.deductibleRemaining, "$85 (Remaining)");
  assert.equal(tracker.options.body.awvLastDate, "2000-01-15");
  assert.equal(tracker.options.body.awvNextEligibleDate, "2099-01-15");
  assert.equal(tracker.options.body.sourceSystem, "Stedi HETS");
  assert.equal(tracker.options.body.coverageNotes, "");
  assert.equal(tracker.options.body.sourceRulesVersion, "cms-hets-2026-2-v15.1");
  assert.deepEqual(tracker.options.body.preventiveServices.map(({ code }) => code), ["G0439", "G0402"]);
});

test("payer errors inside an HTTP 200 response write an error tracker row and ignore stub benefits", async () => {
  const harness = await loadHarness({
    response: {
      payerId: "CMS",
      errors: [{ code: "75", description: "Subscriber not found" }],
      plans: [{ benefits: { statuses: [{
        coverageLevel: "INDIVIDUAL",
        status: "ACTIVE_COVERAGE",
        service: { system: "STC", value: "30" },
      }] } }],
    },
  });

  const result = await harness.handler(checkEvent());

  assert.equal(JSON.parse(result.body).error, "Stedi 200");
  assert.equal(harness.cloudCalls.length, 1);
  const tracker = harness.cloudCalls[0].options.body;
  assert.equal(tracker.coverage, "Error — see notes");
  assert.equal(tracker.awvStatus, "Unknown");
  assert.equal(tracker.deductibleRemaining, "");
  assert.deepEqual(tracker.preventiveServices, []);
  assert.equal(tracker.coverageNotes, "Stedi 200: Subscriber not found");
});

test("non-success Stedi responses still write the existing BHW Cloud error shape", async () => {
  const harness = await loadHarness({
    statusCode: 422,
    response: { message: "Synthetic request rejected" },
  });

  const result = await harness.handler(checkEvent());

  assert.equal(JSON.parse(result.body).error, "Stedi 422");
  assert.equal(harness.cloudCalls.length, 1);
  const tracker = harness.cloudCalls[0].options.body;
  assert.equal(tracker.coverage, "Error — see notes");
  assert.equal(tracker.planType, "Unknown");
  assert.equal(tracker.awvStatus, "Unknown");
  assert.equal(tracker.coverageNotes, "Stedi 422: Synthetic request rejected");
  assert.equal(tracker.sourceSystem, "Stedi HETS");
});

test("BHW0000 never becomes a production CMS HETS request", async () => {
  const fixture = { ...syntheticPatient, bhwPatientId: "BHW0000" };
  const harness = await loadHarness({ response: {}, patients: [fixture] });
  const result = await harness.handler({
    ...checkEvent(),
    body: JSON.stringify({ action: "check", patientId: "BHW0000" }),
  });
  assert.equal(result.statusCode, 409);
  assert.match(JSON.parse(result.body).error, /approved Stedi mock or local fixture/);
  assert.equal(harness.httpCalls.length, 0);
  assert.equal(harness.cloudCalls.length, 0);
});
