import {parseCsv} from "../provider/patient-insurance-import.mjs";

const columns = {
  medication: ["medication name", "medication", "drug name", "drug"],
  patientId: ["bhw patient id", "bhw id", "patient id", "mrn", "chart number"],
  birthDate: ["date of birth", "dob", "patient dob", "birth date"],
  strength: ["strength", "medication strength"],
  status: ["medication status", "status"],
};

export function parseMedicationExport(text) {
  const rows = parseCsv(text);
  const normalize = value => value.trim().toLowerCase().replace(/[_-]/g, " ");
  const headerIndex = rows.findIndex(row => {
    const names = row.map(normalize);
    return Object.values(columns).slice(0, 3).every(options => options.some(option => names.includes(option)));
  });
  if (headerIndex < 0) throw new Error("Use a CSV with Patient ID or MRN, Date of Birth, and Medication Name columns.");
  const headers = rows[headerIndex].map(normalize);
  const index = Object.fromEntries(Object.entries(columns).map(([key, options]) => [
    key, options.map(option => headers.indexOf(option)).find(value => value >= 0) ?? -1,
  ]));
  return rows.slice(headerIndex + 1).flatMap((row, offset) => {
    if (!row.some(value => value.trim())) return [];
    const fields = Object.fromEntries(Object.entries(index).map(([key, position]) => [key, row[position]?.trim() ?? ""]));
    return [{...fields, row: headerIndex + offset + 2}];
  });
}
