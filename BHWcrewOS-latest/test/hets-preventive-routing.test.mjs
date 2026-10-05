import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const HEALTH_CORE_REVIEW_URL = "https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/preventive-review.html?patient=BHW0000";

test("CrewOS launches provider HETS review in the protected Health Core EHR", async () => {
  const [html, index] = await Promise.all([
    readFile(new URL("../provider/preventive.html", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(index, /Review HETS in Health Core/);
  assert.match(index, new RegExp(HEALTH_CORE_REVIEW_URL.replace(/[.?]/g, "\\$&")));
  assert.match(html, /CMS HETS provider review is in Health Core/);
  assert.match(html, /CrewOS no longer presents or saves a provider clinical disposition/);
  assert.match(html, /Clinical authority: Health Core/);
  assert.match(html, /Compliance operational review/);
  assert.match(html, new RegExp(HEALTH_CORE_REVIEW_URL.replace(/[.?]/g, "\\$&")));
  assert.doesNotMatch(html, /data-hets-disposition|hetsReviewCheck|Preview and save reviewed measures|\/api\/hets-preventive-review/);
  const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new Function(moduleScript));
});

test("CrewOS no longer exposes a provider-review write function", async () => {
  await assert.rejects(stat(new URL("../netlify/functions/hets-preventive-review.mjs", import.meta.url)), { code: "ENOENT" });
});
