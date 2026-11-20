const {getSession, json} = require("./_lib");
const {canAccessAdminMaster} = require("./lib/staff-access");
const {listCloudPatients} = require("./lib/cloud-patients");

function birthDate(value) {
  const text = String(value ?? "").trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = us ? `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10) === iso ? iso : "";
}

function matchRows(rows, patients) {
  const byId = new Map();
  for (const patient of patients) {
    for (const key of new Set([patient.bhwPatientId, patient.chart].filter(Boolean).map(value => String(value).trim().toUpperCase()))) {
      const matches = byId.get(key) || [];
      matches.push(patient);
      byId.set(key, matches);
    }
  }
  return rows.map(({patientId, dob}) => {
    const birthday = birthDate(dob);
    const key = patientId.trim().toUpperCase();
    if (!key || !birthday) return {reason:"ID or date of birth is missing or invalid"};
    const candidates = byId.get(key) || [];
    if (candidates.length !== 1) return {reason:candidates.length ? "ID is ambiguous" : "ID is not in Patient Registry"};
    const [patient] = candidates;
    if (birthday !== birthDate(patient.dob)) return {reason:"Date of birth differs from Patient Registry"};
    if (!/^BHW\d{4}$/.test(patient.bhwPatientId) || patient.bhwPatientId === "BHW0000" || String(patient.status).toLowerCase() !== "active") {
      return {reason:"Patient Registry record is not eligible for this review"};
    }
    return {bhwPatientId:patient.bhwPatientId, name:patient.name};
  });
}

async function handle(event, listPatients = listCloudPatients) {
  const session = getSession(event);
  if (!session) return json(401, {error:"Sign in to CrewOS first."});
  if (!canAccessAdminMaster(session)) return json(403, {error:"Admin Master access is required."});
  if (event.httpMethod === "GET") return json(200, {ok:true});
  if (event.httpMethod !== "POST") return json(405, {error:"Method unavailable."});
  try {
    const body = event.body || "";
    if (Buffer.byteLength(body) > 64000) return json(413, {error:"The match batch is too large."});
    const {rows} = JSON.parse(body);
    if (!Array.isArray(rows) || !rows.length || rows.length > 250 || !rows.every(row =>
      typeof row?.patientId === "string" && row.patientId.length <= 80 && typeof row.dob === "string" && row.dob.length <= 30)) {
      return json(400, {error:"Provide up to 250 bounded identity pairs."});
    }
    return json(200, {matches:matchRows(rows, await listPatients(session))});
  } catch {
    return json(502, {error:"Patient Registry matching could not be completed."});
  }
}

exports.handler = event => handle(event);
exports._test = {handle, matchRows};
