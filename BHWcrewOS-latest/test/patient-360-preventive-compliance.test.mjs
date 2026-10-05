import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../provider/patient-360-app.mjs", import.meta.url), "utf8");

test("Patient 360 displays Health Core preventive compliance status without action side effects", () => {
  assert.match(source, /Compliance reviewed/);
  assert.match(source, /Compliance pending/);
  assert.match(source, /Compliance follow-up/);
  assert.match(source, /operational attestation only/);
  assert.match(source, /does not schedule care, create or send an order, message a patient, submit a claim, or publish to Care Connect/);
});
