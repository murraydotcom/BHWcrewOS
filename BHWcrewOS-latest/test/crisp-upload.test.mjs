import test from "node:test";
import assert from "node:assert/strict";
import { readSpreadsheet, parseDelimited, detectDelimiter, sheetToObjects } from "../engine/xlsx-lite.mjs";
import { buildWorklist, inspectCrispColumns, normalizeRecord, partitionTcmImportRows } from "../engine/tcm-parse.mjs";

const HEADERS = [
  "First Name", "Last Name", "Gender", "Primary Care Provider", "Address", "Location",
  "Admit Date / Time", "ER Last 90 Days", "Admit Source", "Discharge To Location", "Cell Phone",
  "Encounter Type", "Facility", "Patient Complaint", "Primary Diagnosis Description",
  "Primary Diagnosis Codes", "Middle Name", "Date of Birth", "Death Indicator",
  "Discharge Date / Time", "Date of Death", "Discharge Disposition",
];
const ROW = [
  "Jane", "Doe", "F", "Dr Primary", "123 Main St", "Unit 2", "2026-08-01 10:00", "1",
  "Home", "Home", "555-0100", "Inpatient", "BHW Test Hospital", "Chest pain",
  "Chest pain, unspecified", "R07.9", "Q", "1980-01-01", "N", "2026-08-02 12:00", "", "Home",
];

test("the exact CRISP tab-separated header is separated when the file is named .csv", async () => {
  const text = `${HEADERS.join("\t")}\n${ROW.join("\t")}\n`;
  const result = await readSpreadsheet({ name: "PanelDetails.csv", async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
  assert.equal(result.delimiter, "\t");
  assert.equal(Object.keys(result.rows[0]).length, 22);
  assert.equal(result.rows[0]["First Name"], "Jane");
  assert.equal(result.rows[0]["Patient Complaint"], "Chest pain");
  assert.equal(result.rows[0]["Primary Diagnosis Codes"], "R07.9");
  assert.deepEqual(inspectCrispColumns(result.rows).missing, []);
  const worklist = buildWorklist(result.rows, { today: "2026-08-03" });
  assert.equal(worklist.items[0].category, "tcm");
  assert.equal(worklist.items[0].dob, "1980-01-01");
  assert.equal(worklist.items[0].dischargeAt, "2026-08-02T12:00");
});

test("CRISP delimiter detection supports semicolons, an Excel sep line, and title rows", () => {
  const semicolon = `${HEADERS.join(";")}\n${ROW.join(";")}\n`;
  assert.equal(detectDelimiter(semicolon), ";");
  assert.equal(parseDelimited(`sep=;\n${semicolon}`)[0]["Facility"], "BHW Test Hospital");

  const titled = `CRISP ENS Panel Details\nGenerated 2026-08-25\n${HEADERS.join("\t")}\n${ROW.join("\t")}\n`;
  assert.equal(parseDelimited(titled)[0]["Last Name"], "Doe");
});

test("XLSX parsing finds the CRISP header below a title row", () => {
  const strings = ["CRISP ENS Panel Details", "First Name", "Last Name", "Date of Birth", "Jane", "Doe"];
  const xml = `
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c><c r="C3"><v>29221</v></c></row>`;
  const rows = sheetToObjects(xml, strings);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["First Name"], "Jane");
  assert.equal(rows[0]["Date of Birth"], "1980-01-01");
});

test("upload validation rejects an unseparated header and aliases remain supported", () => {
  const broken = { "First Name\tLast Name\tDate of Birth\tEncounter Type": "Jane\tDoe\t1980-01-01\tInpatient" };
  assert.equal(inspectCrispColumns([broken]).missing.length, 8);

  const record = normalizeRecord({
    "First Name": "Jane", "Last Name": "Doe", DOB: "1980-01-01",
    "Chief Complaint": "Chest pain", "Diagnosis Codes": "R07.9", "Diagnosis Description": "Chest pain",
  });
  assert.equal(record.dob, "1980-01-01");
  assert.equal(record.complaint, "Chest pain");
  assert.equal(record.dxCodes, "R07.9");
  assert.equal(record.dxDesc, "Chest pain");
});

test("incomplete patient-only rows are skipped without blocking complete CRISP events", () => {
  const valid = Object.fromEntries(HEADERS.map((header, index) => [header, ROW[index]]));
  const incomplete = {
    ...valid,
    "Encounter Type": "",
    "Admit Date / Time": "",
    "Discharge Date / Time": "",
  };
  const partition = partitionTcmImportRows([valid, incomplete]);

  assert.deepEqual(partition.valid, [valid]);
  assert.deepEqual(partition.skipped, [{
    rowNumber: 3,
    missing: ["Encounter Type", "Admit Date / Time or Discharge Date / Time"],
  }]);
});
