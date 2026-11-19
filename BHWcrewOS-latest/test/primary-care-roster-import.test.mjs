import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const from = html.indexOf("/* ============ Primary Care — daily readiness");
const to = html.indexOf("/* ============ Medicare Prevention", from);
assert.ok(from >= 0 && to > from, "Primary Care roster block exists");
const code = html.slice(from, to);
const { primaryRosterImportCsv, primaryRosterNormalizeDate } = new Function(
  code + "\nreturn {primaryRosterImportCsv,primaryRosterNormalizeDate};"
)();

test("CSV import handles quoted patient names and explicit patient identifiers", () => {
  const rows = primaryRosterImportCsv(
    'BHW Patient ID,Date,Time,Patient Name,Visit Type,Status\n' +
    'BHW1234,2026-11-09,09:00,"Doe, Example",Follow-up,Scheduled\n' +
    ',11/09/2026,09:30,Unmatched Example,New patient,Confirmed\n'
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].bhwPatientId, "BHW1234");
  assert.equal(rows[0].name, "Doe, Example");
  assert.equal(rows[1].bhwPatientId, "");
  assert.equal(rows[1].date, "2026-11-09");
});

test("CSV without an explicit BHW Patient ID column is refused", () => {
  assert.throws(
    () => primaryRosterImportCsv("Date,Time,Patient Name\n2026-11-09,09:00,Example"),
    /Required columns/
  );
});
test("CSV with malformed rows and dates is refused", () => {
  assert.throws(
    () => primaryRosterImportCsv("BHW Patient ID,Date,Time\nBHW1234,tomorrow,09:00"),
    /Invalid appointment date/
  );
  assert.throws(
    () => primaryRosterImportCsv('BHW Patient ID,Date,Time\n"BHW1234,2026-11-09,09:00'),
    /Unclosed quoted field/
  );
});
test("non-ambiguous date normalization", () => {
  assert.equal(primaryRosterNormalizeDate("11/09/2026"), "2026-11-09");
  assert.equal(primaryRosterNormalizeDate("2026-11-09"), "2026-11-09");
  assert.equal(primaryRosterNormalizeDate("09-Nov-26"), "");
});
test("source has no automatic send or browser persistence of import", () => {
  assert.match(code, /PRIMARY_IMPORT = null/);
  assert.match(code, /PRIMARY_IMPORT=\{appointments,filename:file.name\}/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|fetch\(/);
});
