import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const recordPath = require.resolve("../netlify/functions/positive-ana-record.js");
const step5Page = await readFile(new URL("../bhw-positive-ana-step5.html", import.meta.url), "utf8");

function response(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function loadRecord(cloudRequest, session = { staffId: "synthetic-clinician", name: "Synthetic Clinician", role: "CRNP" }) {
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: { getSession: () => session, json: response },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      cloudRequest,
      findCloudPatient: async (id, actor) => {
        const result = await cloudRequest("/v1/patients", { actor });
        return (result.patients || []).find((patient) => patient.bhwPatientId === id) || null;
      },
    },
  };
  delete require.cache[recordPath];
  return require(recordPath);
}

function event(overrides = {}) {
  return {
    httpMethod: "POST",
    body: JSON.stringify({
      bhwPatientId: "BHW9999",
      responseId: "positive-ana-123e4567-e89b-12d3-a456-426614174000",
      analysis: {
        schemaVersion: "positive-ana-v3",
        analysisMode: "non-ranking-clinician-review",
        anaPatterns: [{ code: "AC-1", label: "AC-1 · Nuclear homogeneous", titer: 160 }],
        sex: "Female",
        cascade: "pos",
        antibodies: [{ key: "dsDNA", label: "dsDNA" }],
        medications: [],
        labs: [{ key: "c3Low", label: "C3 low" }, { key: "seleniumLow", label: "Selenium low" }],
        measurements: [
          { key: "c3Value", label: "C3 numeric value", value: 64, unit: "mg/dL", method: "Nephelometry", referenceRange: "90-180", collectedOn: "2026-10-20" },
          { key: "foodIgGValue", label: "Food-specific IgG numeric result", subject: "Wheat", value: 12.5, unit: "U/mL", method: "ELISA", referenceRange: "<2", collectedOn: "2026-10-20", contextual: true },
          { key: "foodIgGValue", label: "Food-specific IgG numeric result", subject: "Milk", value: 5, unit: "U/mL", method: "ELISA", referenceRange: "<2", collectedOn: "2026-10-20", contextual: true },
          { key: "tryptaseAcuteValue", label: "Acute serum tryptase", value: 14, unit: "ng/mL", method: "Immunoassay", referenceRange: "<11.5", collectedOn: "2026-10-20", contextual: true },
        ],
        symptoms: [{ group: "Renal / Vascular", label: "Blood in urine" }, { group: "Supportive Context / Exposures", label: "Short or disrupted sleep" }],
        patientResponseIds: ["step5-submission-1"],
        priorAnalysisIds: ["client-supplied-id-must-be-replaced"],
        redFlags: ["Blood in urine"],
        review: {
          clinicianReviewRequired: true,
          sourceSupportedContext: ["Food-specific IgG was retained as hypothesis-generating exposure context; it does not diagnose food allergy or intolerance."],
          uncertainty: ["No condition ranking, score, hidden ordering, or automated diagnosis was generated."],
        },
      },
    }),
    ...overrides,
  };
}

test("Positive ANA record saves to the verified BHW ID and requires exact Cloud read-back", async () => {
  const calls = [];
  const cloudRequest = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/v1/patients") return { patients: [{ bhwPatientId: "BHW9999", patientStatus: "active" }] };
    if (options.method === "POST") return { responseId: options.body.responseId, savedAt: "2026-10-25T12:00:00.000Z" };
    return { responses: [
      { responseId: "positive-ana-123e4567-e89b-12d3-a456-426614174000", bhwPatientId: "BHW9999", screeningId: "positive-ana-clinician-analysis", submittedAt: "2026-10-25T12:00:00.000Z" },
      { responseId: "prior-exact-patient", bhwPatientId: "BHW9999", screeningId: "positive-ana-clinician-analysis", submittedAt: "2026-09-01T12:00:00.000Z", answers: {
        anaPatterns: [{ code: "AC-1", label: "AC-1 · Nuclear homogeneous", titer: 80 }],
        antibodies: [{ key: "SSA", label: "SSA / Ro" }],
        labs: [{ key: "c4Low", label: "C4 low" }],
        measurements: [
          { key: "c3Value", label: "C3 numeric value", value: 80, unit: "mg/dL", method: "Nephelometry", referenceRange: "90-180", collectedOn: "2026-08-28" },
          { key: "foodIgGValue", label: "Food-specific IgG numeric result", subject: "Wheat", value: 10, unit: "U/mL", method: "ELISA", referenceRange: "<2", collectedOn: "2026-08-28", contextual: true },
          { key: "foodIgGValue", label: "Food-specific IgG numeric result", subject: "Milk", value: 7, unit: "U/mL", method: "ELISA", referenceRange: "<2", collectedOn: "2026-08-28", contextual: true },
          { key: "tryptaseAcuteValue", label: "Acute serum tryptase", value: 12, unit: "µg/L", method: "Immunoassay", referenceRange: "<11.5", collectedOn: "2026-08-28", contextual: true },
        ],
        symptoms: [{ group: "Joints / Muscle", label: "Joint swelling" }],
      } },
      { responseId: "other-patient-prior", bhwPatientId: "BHW1111", screeningId: "positive-ana-clinician-analysis", submittedAt: "2026-09-15T12:00:00.000Z", answers: { measurements: [{ key: "c3Value", label: "C3 numeric value", value: 1, unit: "mg/dL" }] } },
    ] };
  };
  const { handler } = loadRecord(cloudRequest);
  const result = await handler(event());
  const body = JSON.parse(result.body);

  assert.equal(result.statusCode, 200);
  assert.equal(body.saved, true);
  assert.equal(body.bhwPatientId, "BHW9999");
  assert.equal(body.destination, "BHW Cloud");
  assert.equal(calls.length, 4);
  assert.equal(calls[0].path, "/v1/patients");
  assert.equal(calls[1].path, "/v1/questionnaire-responses");
  assert.equal(calls[1].options.method, undefined);
  assert.equal(calls[2].path, "/v1/questionnaire-responses");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.body.bhwPatientId, "BHW9999");
  assert.equal(calls[2].options.body.screeningId, "positive-ana-clinician-analysis");
  assert.equal(calls[2].options.body.answers.schemaVersion, "positive-ana-v3");
  assert.equal(calls[2].options.body.answers.analysisMode, "non-ranking-clinician-review");
  assert.equal(calls[2].options.body.answers.measurements[0].value, 64);
  assert.equal(calls[2].options.body.answers.measurements[1].subject, "Wheat");
  assert.equal(calls[2].options.body.answers.measurements[1].contextual, true);
  assert.equal(calls[2].options.body.answers.measurements[2].contextual, true);
  assert.equal(calls[2].options.body.answers.measurements[2].subject, "Milk");
  assert.equal(calls[2].options.body.answers.measurements[3].contextual, true);
  assert.ok(!Object.hasOwn(calls[2].options.body.answers, "differential"));
  assert.ok(!Object.hasOwn(calls[2].options.body.answers, "sharedWorkup"));
  assert.deepEqual(calls[2].options.body.answers.patientResponseIds, ["step5-submission-1"]);
  assert.deepEqual(calls[2].options.body.answers.priorAnalysisIds, ["prior-exact-patient"]);
  assert.equal(calls[2].options.body.answers.review.clinicianReviewRequired, true);
  assert.match(calls[2].options.body.answers.review.sourceSupportedContext.join(" "), /Insider’s Guide to Supporting Optimal Immune Function/);
  assert.deepEqual(calls[2].options.body.answers.review.sourceReferences.map((item) => item.pages), ["p. 1; pp. 5–25"]);
  assert.equal(calls[2].options.body.answers.longitudinalComparison.priorReviewCount, 1);
  assert.deepEqual(calls[2].options.body.answers.longitudinalComparison.provenance.map((item) => item.responseId), ["prior-exact-patient"]);
  const c3Comparison = calls[2].options.body.answers.longitudinalComparison.measurements.find((item) => item.key === "c3Value");
  const foodComparison = calls[2].options.body.answers.longitudinalComparison.measurements.find((item) => item.key === "foodIgGValue" && item.subject === "Wheat");
  const milkComparison = calls[2].options.body.answers.longitudinalComparison.measurements.find((item) => item.key === "foodIgGValue" && item.subject === "Milk");
  const tryptaseComparison = calls[2].options.body.answers.longitudinalComparison.measurements.find((item) => item.key === "tryptaseAcuteValue");
  assert.equal(c3Comparison.comparability, "comparable");
  assert.equal(c3Comparison.delta, -16);
  assert.equal(foodComparison.comparability, "comparable");
  assert.equal(foodComparison.delta, 2.5);
  assert.equal(milkComparison.comparability, "comparable");
  assert.equal(milkComparison.delta, -2);
  assert.equal(calls[2].options.body.answers.longitudinalComparison.foodContext.length, 2);
  assert.equal(tryptaseComparison.comparability, "not-comparable");
  assert.match(tryptaseComparison.comparison, /Units are not comparable/);
  assert.deepEqual(calls[2].options.body.answers.longitudinalComparison.symptoms.currentOnly, ["Blood in urine", "Short or disrupted sleep"]);
  assert.deepEqual(calls[2].options.body.answers.longitudinalComparison.symptoms.previousOnly, ["Joint swelling"]);
  assert.match(calls[2].options.body.answers.longitudinalComparison.patterns[0].comparison, /higher value than the prior recorded endpoint/);
  assert.doesNotMatch(calls[2].options.body.transcript, /ranked differential|none ranked/i);
  assert.match(calls[2].options.body.transcript, /non-ranking clinician review/i);
  assert.match(calls[2].options.body.transcript, /Longitudinal comparison: 1 exact-patient prior review/);
  assert.match(calls[2].options.body.transcript, /Source references: Insider’s Guide to Supporting Optimal Immune Function/);
  assert.equal(calls[3].path, "/v1/questionnaire-responses");
});

test("Positive ANA history returns only the selected patient's clinician analyses", async () => {
  const calls = [];
  const cloudRequest = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/v1/patients") return { patients: [{ bhwPatientId: "BHW9999", patientStatus: "active" }] };
    return { responses: [
      { responseId: "keep", bhwPatientId: "BHW9999", screeningId: "positive-ana-clinician-analysis", submittedAt: "2026-10-25T12:00:00.000Z", respondent: "Provider", answers: { symptoms: [{ group: "Renal / Vascular", label: "Blood in urine" }], differential: [{ condition: "SLE", tier: "Strong", score: 100 }], sharedWorkup: ["CBC"], patientResponseIds: ["step5-1"], priorAnalysisIds: ["prior-1"] } },
      { responseId: "other-patient", bhwPatientId: "BHW1111", screeningId: "positive-ana-clinician-analysis", answers: { symptoms: [{ group: "Test", label: "Wrong patient" }] } },
      { responseId: "other-screening", bhwPatientId: "BHW9999", screeningId: "another-screening", answers: { symptoms: [{ group: "Test", label: "Wrong screening" }] } },
    ] };
  };
  const { handler } = loadRecord(cloudRequest);
  const result = await handler(event({ body: JSON.stringify({ action: "list", bhwPatientId: "BHW9999" }) }));
  const body = JSON.parse(result.body);

  assert.equal(result.statusCode, 200);
  assert.equal(body.bhwPatientId, "BHW9999");
  assert.equal(body.analyses.length, 1);
  assert.equal(body.analyses[0].responseId, "keep");
  assert.ok(!Object.hasOwn(body.analyses[0].analysis, "differential"));
  assert.ok(!Object.hasOwn(body.analyses[0].analysis, "sharedWorkup"));
  assert.equal(body.analyses[0].analysis.analysisMode, "non-ranking-clinician-review");
  assert.equal(body.analyses[0].analysis.legacyRankingOmitted, true);
  assert.deepEqual(body.analyses[0].analysis.patientResponseIds, ["step5-1"]);
  assert.deepEqual(body.analyses[0].analysis.priorAnalysisIds, ["prior-1"]);
  assert.deepEqual(calls.map((call) => call.path), ["/v1/patients", "/v1/questionnaire-responses"]);
});

test("Positive ANA record fails closed for an invalid patient, missing session, or mismatched read-back", async () => {
  let cloudCalls = 0;
  let module = loadRecord(async () => { cloudCalls += 1; return {}; });
  let result = await module.handler(event({ body: JSON.stringify({ bhwPatientId: "BHW0000", analysis: { symptoms: [{ group: "Test", label: "Test" }] } }) }));
  assert.equal(result.statusCode, 400);
  assert.equal(cloudCalls, 0);

  module = loadRecord(async () => { throw new Error("must not call"); }, null);
  result = await module.handler(event());
  assert.equal(result.statusCode, 401);

  module = loadRecord(async (path, options = {}) => path === "/v1/patients" ? { patients: [{ bhwPatientId: "BHW9999", patientStatus: "active" }] } : options.method === "POST" ? { ok: true } : { responses: [] });
  result = await module.handler(event());
  assert.equal(result.statusCode, 502);
  assert.match(JSON.parse(result.body).error, /could not be verified/i);
});

test("patient Step 5 page uses only the opaque assignment capability and returns structured answers", () => {
  assert.match(step5Page, /noindex,nofollow,noarchive/);
  assert.match(step5Page, /\/v1\/public\/content-assignments/);
  assert.match(step5Page, /assignment\.questions/);
  assert.match(step5Page, /question\.type==='multi'/);
  assert.match(step5Page, /\/v1\/public\/content-submissions/);
  assert.match(step5Page, /urgentConcern/);
  assert.match(step5Page, /This form does not diagnose an autoimmune condition/);
  assert.doesNotMatch(step5Page, /id="patientId"|bhwPatientId|BHW\d{4}/);
  const scripts = [...step5Page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((script, index) => assert.doesNotThrow(() => Function(script), `Step 5 inline script ${index + 1}`));
});
