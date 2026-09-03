import test from "node:test";
import assert from "node:assert/strict";
import { activeCendPatients, buildCendRosterFile, CEND_ROSTER_HEADERS } from "../engine/cend-roster.mjs";

function syntheticPatient(overrides = {}) {
  return {
    bhwPatientId: "BHW9998",
    legalFirstName: "Synthetic",
    legalLastName: "Roster",
    dateOfBirth: "1980-01-02",
    gender: "F",
    address1: "100 Test Avenue",
    city: "Baltimore",
    state: "MD",
    postalCode: "21201",
    memberId: "SYNTH-MEMBER",
    patientStatus: "active",
    ...overrides,
  };
}

test("the current CEND roster includes only active permanent patients", () => {
  const patients = [
    syntheticPatient(),
    syntheticPatient({ bhwPatientId: "BHW9997", patientStatus: "inactive" }),
    syntheticPatient({ bhwPatientId: "BHW0000" }),
    syntheticPatient({ bhwPatientId: "TEMP-1234" }),
  ];
  assert.deepEqual(activeCendPatients(patients).map((patient) => patient.bhwPatientId), ["BHW9998"]);
});

test("the CEND roster builder requires its subscriber code and complete demographics", () => {
  assert.equal(buildCendRosterFile([syntheticPatient()]).reason, "subscriber-required");
  const incomplete = buildCendRosterFile([syntheticPatient({ gender: "" })], { subscriberCode: "BHW-CEND" });
  assert.equal(incomplete.reason, "incomplete-demographics");
  assert.equal(incomplete.incompleteCount, 1);
});

test("the CEND roster builder creates the expected CRISP CSV without synthetic fixture rows", () => {
  const result = buildCendRosterFile([
    syntheticPatient({ legalLastName: 'Roster, "Test"' }),
    syntheticPatient({ bhwPatientId: "BHW0000" }),
  ], {
    subscriberCode: " BHW-CEND! ",
    now: new Date(2026, 8, 2),
  });

  assert.equal(result.ok, true);
  assert.equal(result.activeCount, 1);
  assert.equal(result.filename, "BHW-CEND-1-z-09-02-2026.csv");
  assert.equal(result.csv.split("\n")[0], CEND_ROSTER_HEADERS.join(","));
  assert.match(result.csv, /"Roster, ""Test""",Synthetic,1980-01-02,F/);
  assert.doesNotMatch(result.csv, /BHW0000/);
  assert.match(result.csv, /BHW9998,SYNTH-MEMBER,BHW-CEND$/);
});

test("the CrewOS TCM page exposes the protected active-roster builder separately from local matching", async () => {
  const html = await (await import("node:fs/promises")).readFile(new URL("../provider/tcm.html", import.meta.url), "utf8");
  assert.match(html, /id="cendRosterTitle">Current active CEND roster/);
  assert.match(html, /id="crispSubscriberCode"/);
  assert.match(html, /id="cendRosterBtn"[^>]*>Build current active CEND roster/);
  assert.match(html, /ACTIVE_PATIENT_REGISTRY = await CLOUD\.listPatients\(\)/);
  assert.match(html, /Optional discharge match roster:/);
  assert.match(html, /The downloaded CSV contains PHI/);
});
