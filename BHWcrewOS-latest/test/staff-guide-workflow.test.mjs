import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff guide teaches the current Patient Requests and alert workflow", async () => {
  const html = await readFile(new URL("../bhw-staff-guide.html", import.meta.url), "utf8");

  assert.match(html, /Updated September 3, 2026/);
  assert.match(html, /crewhq\.bhwmedical\.org\/crewos/);
  assert.match(html, /id="patient-requests-training"/);
  assert.match(html, /Patient Requests is the one queue/);
  assert.match(html, /15-minute trainer-led walkthrough/);
  assert.match(html, /Automated patient SMS is gated off/);
  assert.match(html, /BHW0000/);
  assert.match(html, /five BHW0000 scenarios/);
  assert.match(html, /Competency check and sign-off/);
  assert.match(html, /Read is not resolved/);
  assert.match(html, /PA submitted means awaiting a decision/);
  assert.match(html, /Referral sent ≠ ready to schedule ≠ scheduled/);
  assert.match(html, /“automation-not-enabled”/);
  assert.match(html, /SMS and Google Chat stay no-PHI/);
  assert.match(html, /Notion is legacy\/transitional/);
  assert.match(html, /WelcomeToBHW.*HR\/onboarding only/);
  assert.match(html, /bhw-alert-center\.mjs/);
  assert.match(html, /Notifications on\/off/);
  assert.match(html, /providers receive triage\/provider-question/i);
  assert.doesNotMatch(html, /bhwcrewos\.netlify\.app/);
  assert.doesNotMatch(html, /duplicate the .*template/i);
});
