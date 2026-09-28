import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const careImport = require("../netlify/functions/care-log-import.js")._test;
const careDue = require("../netlify/functions/care-due-data.js")._test;
const careLogData = require("../netlify/functions/care-log-data.js")._test;

test("monthly care-log preparation recognizes every care-management program shown in CrewOS", () => {
  assert.deepEqual(careImport.normalizedPrograms([
    "Chronic Care Management", "APCM", "Principal Care Management", "Remote Patient Monitoring", "RTM",
    "Behavioral Health Integration", "Collaborative Care", "CharmEd Minds",
  ]), ["CCM", "APCM", "PCM", "RPM", "RTM", "BHI", "COCM", "CHARMED MINDS"]);
});

test("recent monthly enrollment is recovered for no more than two months", () => {
  const recent = careImport.recentPrograms([
    { bhwPatientId: "BHW0001", program: "BHI", type: "Monthly", serviceMonth: "2026-08-01" },
    { bhwPatientId: "BHW0002", program: "RPM", type: "Monthly", serviceMonth: "2026-07-01" },
    { bhwPatientId: "BHW0003", program: "CCM", type: "Monthly", serviceMonth: "2026-06-01" },
    { bhwPatientId: "BHW0004", program: "TCM", type: "Episode", serviceMonth: "2026-08-01" },
  ], "2026-09");
  assert.deepEqual([...recent.get("BHW0001")], ["BHI"]);
  assert.deepEqual([...recent.get("BHW0002")], ["RPM"]);
  assert.equal(recent.has("BHW0003"), false);
  assert.equal(recent.has("BHW0004"), false);
});

test("CM Due excludes fax rows without changing the shared Front Desk queue", () => {
  assert.equal(careDue.isFaxRequest({ requestType: "fax", source: "iFax" }), true);
  assert.equal(careDue.isFaxRequest({ requestType: "referral", source: "phone" }), false);
});

test("Care Management uses a rolling 30-day window and builds prior-month close gaps", async () => {
  assert.deepEqual(careLogData.monthsInWindow("2026-08-30", "2026-09-28"), ["2026-08", "2026-09"]);
  assert.equal(careLogData.previousMonth("2026-09-28"), "2026-08");
  assert.equal(careLogData.monthEnd("2026-02"), "2026-02-28");
  assert.deepEqual(careLogData.documentationGaps({ program: "TCM", status: "Open" }), ["activity/documentation", "first contact", "visit date", "next follow-up"]);
  const page = await readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8");
  assert.match(page, /Rolling day-to-day tracking/);
  assert.match(page, /documentation &amp; claim close/);
  assert.match(page, /First \/ last contact/);
  const scripts = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test("Population Health and Hospital Visits share Registry identity, contact details, and TCM status", async () => {
  const [population, discharges, shell] = await Promise.all([
    readFile(new URL("../bhw-panel-performance.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-discharges.html", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /Population Health/);
  assert.doesNotMatch(shell, /Panel &amp; Discharges/);
  assert.match(population, /registryMatchForRow/);
  assert.match(population, /First Contact At/);
  assert.match(population, /Discharge Details Obtained/);
  assert.match(population, /TCM Log ID/);
  assert.match(population, /Object\.assign\(existingEvent,cloudFields\)/);
  assert.match(population, /dischargeAt:row\['Discharge Date \/ Time'\]/);
  assert.match(discharges, /registryMatch/);
  assert.match(discharges, /Connect existing patient/);
  assert.match(discharges, /TCM care-log connection/);
  assert.match(discharges, /read back from BHW Cloud/);
  for (const [name, html] of [["Population Health", population], ["Hospital Visits", discharges]]) {
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script), `${name} inline script should compile`);
  }
});
