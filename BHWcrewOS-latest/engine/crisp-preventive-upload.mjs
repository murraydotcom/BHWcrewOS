const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const headerKey = (value) => clean(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "");

const CANONICAL_FIELDS = Object.freeze({
  bhwPatientId: { output: "BHW Patient ID", aliases: ["BHW Patient ID", "BHW ID"] },
  firstName: { output: "First Name", aliases: ["First Name", "Patient First Name", "Member First Name"] },
  lastName: { output: "Last Name", aliases: ["Last Name", "Patient Last Name", "Member Last Name"] },
  patientName: { output: "Patient Name", aliases: ["Patient Name", "Member Name", "Name"] },
  dateOfBirth: { output: "Date of Birth", aliases: ["Date of Birth", "DOB", "Birth Date", "Patient DOB"] },
  category: { output: "Category", aliases: ["Category"] },
  notificationType: { output: "Notification Type", aliases: ["Notification Type"] },
  code: { output: "Code", aliases: ["Code"] },
  description: { output: "Description", aliases: ["Description"] },
  results: { output: "Results", aliases: ["Results"] },
  testName: { output: "Test Name", aliases: ["Test Name"] },
  dataSource: { output: "Data Source", aliases: ["Data Source"] },
  documentEvidenceDate: { output: "Document Evidence Date", aliases: ["Document Evidence Date"] },
  eventDate: { output: "Event Date", aliases: ["Event Date"] },
  facilityName: { output: "Facility Name", aliases: ["Facility Name", "Facility"] },
});

const aliasIndex = Object.fromEntries(Object.values(CANONICAL_FIELDS)
  .flatMap(({ output, aliases }) => aliases.map((alias) => [headerKey(alias), output])));

export function inspectCrispPreventiveColumns(rows = []) {
  const sample = rows.find((row) => row && typeof row === "object") || {};
  const recognized = Object.keys(sample).map((header) => aliasIndex[headerKey(header)]).filter(Boolean);
  const set = new Set(recognized);
  const identityPresent = set.has("BHW Patient ID")
    || ((set.has("First Name") && set.has("Last Name")) || set.has("Patient Name"));
  const missing = [];
  if (!identityPresent) missing.push("patient name");
  if (!set.has("Date of Birth")) missing.push("Date of Birth");
  if (!set.has("Category") && !set.has("Notification Type")) missing.push("Category or Notification Type");
  if (!set.has("Event Date")) missing.push("Event Date");
  return { headers: Object.keys(sample), recognized: [...new Set(recognized)], missing };
}

export function sanitizeCrispPreventiveRows(rows = [], maxRows = 250) {
  return (Array.isArray(rows) ? rows : []).slice(0, maxRows).map((row, index) => {
    const selected = {};
    for (const [header, value] of Object.entries(row || {})) {
      const output = aliasIndex[headerKey(header)];
      if (output) selected[output] = clean(value, output === "Description" ? 500 : 240);
    }
    return { rowNumber: index + 2, row: selected };
  });
}
