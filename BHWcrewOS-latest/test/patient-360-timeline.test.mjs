import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { clinicalTimelineCategory, clinicalTimelineCounts, clinicalTimelineEvents } from "../provider/patient-360-timeline.mjs";

test("clinical timeline keeps patient history and excludes operational workflow updates", () => {
  const events = [
    { date: "2026-08-29", type: "ServiceRequest", label: "Referral coordination - Endocrinology" },
    { date: "2026-08-28", type: "Task", label: "Call imaging center" },
    { date: "2026-08-27", type: "Condition", label: "Migraine" },
    { date: "2026-08-26", type: "ClinicalEvent", label: "Migraine flare-up" },
    { date: "2026-08-25", type: "LifeEvent", label: "Returned to work with reduced hours" },
    { date: "2026-08-24", type: "DiagnosticReport", label: "Brain MRI result" },
  ];
  assert.deepEqual(clinicalTimelineEvents(events).map((event) => event.clinicalCategory), ["diagnosis", "flare", "life-function", "imaging-result"]);
});

test("clinical timeline recognizes additional meaningful turning points", () => {
  assert.equal(clinicalTimelineCategory({ type: "MedicationRequest", label: "Dose changed" }), "treatment");
  assert.equal(clinicalTimelineCategory({ type: "Encounter", label: "Emergency department visit" }), "acute-care");
  assert.equal(clinicalTimelineCategory({ type: "Procedure", label: "Synthetic surgery" }), "acute-care");
  assert.equal(clinicalTimelineCategory({ type: "Observation", label: "Important synthetic laboratory result" }), "imaging-result");
});

test("clinical timeline counts filters without counting referrals or coordination", () => {
  const counts = clinicalTimelineCounts([
    { type: "Condition", label: "Synthetic diagnosis" },
    { type: "Condition", label: "Synthetic symptom relapse" },
    { type: "ServiceRequest", label: "Referral sent" },
  ]);
  assert.equal(counts.diagnosis, 1);
  assert.equal(counts.flare, 1);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 2);
});

test("timeline page prioritizes clinical turning points and names its boundaries", () => {
  const app = fs.readFileSync(new URL("../provider/patient-360-app.mjs", import.meta.url), "utf8");
  assert.match(app, /Diagnoses, symptom flare-ups, major life and functional changes/);
  assert.match(app, /routine referral and coordination updates are kept out of this view/);
  assert.match(app, /Referral sent, scheduling and routine coordination remain in Patient Operations and the care plan/);
  assert.match(app, /const latestTimeline = clinicalTimelineEvents\(timeline\)\.slice\(0,4\)/);
  assert.match(app, /wireClinicalTimeline/);
});
