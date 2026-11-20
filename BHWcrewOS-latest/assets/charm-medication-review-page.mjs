import {parseMedicationExport} from "./charm-medication-review.mjs";

const $ = id => document.getElementById(id);
const input = $("export");
const button = $("match");
const output = $("results");
const status = $("status");
const api = "/.netlify/functions/charm-medication-match";

async function request(body) {
  const token = sessionStorage.getItem("crewos_token");
  const headers = {Authorization:`Bearer ${token || ""}`};
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(api, {method:body ? "POST" : "GET", body, headers, cache:"no-store"});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Patient Registry matching is unavailable.");
  return data;
}

function appendCell(row, value, type = "td") {
  const cell = document.createElement(type);
  cell.textContent = value;
  if (type === "th") cell.scope = "col";
  row.append(cell);
}

function render(rows, matches) {
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const value of ["CSV row", "Export patient ID", "Medication", "Export status", "Registry match", "Review"]) appendCell(header,value,"th");
  const body = table.createTBody();
  rows.forEach((row,index) => {
    const candidate = matches[index];
    const record = body.insertRow();
    appendCell(record,row.row);
    appendCell(record,row.patientId);
    appendCell(record,[row.medication,row.strength].filter(Boolean).join(" "));
    appendCell(record,row.status || "Not provided");
    appendCell(record,candidate.bhwPatientId ? `${candidate.name} · ${candidate.bhwPatientId}` : candidate.reason);
    const review = record.insertCell();
    if (candidate.bhwPatientId && row.medication) {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      label.append(check," Match reviewed");
      review.append(label);
    } else review.textContent = "Needs reconciliation";
  });
  output.replaceChildren(table);
  const count = rows.filter((row,index) => row.medication && matches[index].bhwPatientId).length;
  status.textContent = `${count} of ${rows.length} rows have an exact Registry match and a medication name.`;
}

input.addEventListener("change", () => {
  output.replaceChildren();
  button.disabled = !input.files.length;
  status.textContent = "Select Find patient matches to review the export.";
});

button.addEventListener("click", async () => {
  const [file] = input.files;
  if (!file) return;
  button.disabled = input.disabled = true;
  output.replaceChildren();
  status.textContent = "Matching patient identifiers…";
  try {
    if (file.size > 2_000_000) throw new Error("Select a CSV smaller than 2 MB.");
    const rows = parseMedicationExport(await file.text());
    if (!rows.length || rows.length > 2000) throw new Error("Select a CSV with 1 to 2,000 medication rows.");
    const identities = rows.map(row => ({patientId:row.patientId.slice(0,81),dob:row.birthDate.slice(0,31)}));
    const unique = [...new Map(identities.map(identity => [JSON.stringify(identity),identity])).values()];
    const matches = new Map();
    for (let index = 0; index < unique.length; index += 250) {
      const batch = unique.slice(index,index+250);
      const data = await request(JSON.stringify({rows:batch}));
      if (data.matches?.length !== batch.length) throw new Error("Registry matching returned an incomplete result.");
      batch.forEach((identity,offset) => matches.set(JSON.stringify(identity),data.matches[offset]));
    }
    render(rows,identities.map(identity => matches.get(JSON.stringify(identity))));
  } catch (error) {
    status.textContent = error.message;
  } finally {
    input.disabled = button.disabled = false;
  }
});

try {
  await request();
  $("review").hidden = false;
  status.textContent = "Choose an export to review.";
} catch (error) {
  status.textContent = error.message;
}
