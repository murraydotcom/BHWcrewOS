import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const submitPath = require.resolve("../netlify/functions/questionnaire-submit.js");

test("division pages keep sender, receiver, and closed coordination records reviewable", async () => {
  const [html, data, action, alerts] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/action.js", import.meta.url), "utf8"),
    readFile(new URL("../bhw-alert-center.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Warm handoffs we sent/);
  assert.match(html, /Closed coordination history/);
  assert.match(html, /function reviewReferral\(/);
  assert.match(html, /function reviewHandoff\(/);
  assert.match(html, /data-request-id/);
  assert.match(data, /inVis\(h\.from\) \|\| inVis\(h\.to\)/);
  assert.match(data, /inVis\(r\.from\) \|\| inVis\(r\.to\)/);
  assert.match(action, /notificationMode: "manual"/);
  assert.match(action, /manualNotifyOnly: true/);
  assert.doesNotMatch(action, /notificationMode: "none"/);
  assert.match(alerts, /\?view=\$\{encodeURIComponent\(divisionView\(destination\)\)\}&request=/);
});

test("closed assessments and Elevated Wellness readiness remain reviewable", async () => {
  const [html, data, action, questionnaire] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/action.js", import.meta.url), "utf8"),
    readFile(new URL("../bhw-questionnaire.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /function reviewCharmedAssessment\(/);
  assert.match(html, /Review record/);
  assert.match(html, /function phReview\(/);
  assert.match(html, /Closed readiness records/);
  assert.match(html, /Elevated Wellness readiness record/);
  assert.match(html, /\/provider\/patient-360\.html\?patient=/);
  assert.doesNotMatch(html, /The Porter House/);
  assert.match(data, /normalizeDivision\(plan\.program\) === "Elevated Wellness"/);
  assert.match(action, /verifyCloudCharmedAssessment/);
  assert.match(action, /verifyProgramCarePlan/);
  assert.match(questionnaire, /QUESTIONNAIRES\["porter-lifeskills"\] = QUESTIONNAIRES\["elevated-wellness-lifeskills"\]/);
});

test("CharmEd intake forms report saved only after the cloud returns read-back evidence", async () => {
  require.cache[libPath] = {
    id: libPath,
    filename: libPath,
    loaded: true,
    exports: { json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) },
  };
  delete require.cache[submitPath];
  const { handler } = require(submitPath);
  const originalFetch = global.fetch;
  const originalCloudUrl = process.env.RCM_CLOUD_API_URL;
  try {
    process.env.RCM_CLOUD_API_URL = "https://rcm.example.test";
    global.fetch = async () => new Response(JSON.stringify({
      ok: true,
      responseId: "synthetic-response",
      savedAt: "2026-09-23T12:00:00.000Z",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
    const saved = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        slug: "charmed-intake",
        case: "synthetic-invitation",
        screeningId: "charmed-intake",
        responseToken: "synthetic-capability",
        transcript: "Synthetic answer",
        answers: { hopes: "Synthetic answer" },
      }),
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(JSON.parse(saved.body).responseId, "synthetic-response");

    global.fetch = async () => new Response(JSON.stringify({ ok: true, savedAt: "2026-09-23T12:00:00.000Z" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const unverified = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        slug: "charmed-adult",
        case: "synthetic-invitation",
        responseToken: "synthetic-capability",
        transcript: "Synthetic answer",
      }),
    });
    assert.equal(unverified.statusCode, 502);
    assert.match(JSON.parse(unverified.body).error, /could not be verified/);
  } finally {
    global.fetch = originalFetch;
    if (originalCloudUrl === undefined) delete process.env.RCM_CLOUD_API_URL;
    else process.env.RCM_CLOUD_API_URL = originalCloudUrl;
    delete require.cache[submitPath];
    delete require.cache[libPath];
  }
});
