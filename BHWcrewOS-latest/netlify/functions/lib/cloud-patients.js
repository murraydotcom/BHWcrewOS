const crypto = require("crypto");

const apiBase = () => String(process.env.RCM_CLOUD_API_URL || "").replace(/\/$/, "");

function cloudToken(actor = {}) {
  const secret = process.env.CREWHQ_CLOUD_TOKEN_SECRET;
  if (!secret) throw new Error("CREWHQ_CLOUD_TOKEN_SECRET is not configured");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${actor.staffId || actor.sub || "server"}`,
    staffId: actor.staffId || actor.sub || "server",
    name: actor.name || "CrewOS server",
    role: actor.role || "operations",
    access: actor.access || "",
    ...(actor.scope ? { scope: actor.scope } : {}),
    ...(actor.authTime ? { authTime: Number(actor.authTime) } : {}),
    iss: "bhw-crewhq",
    aud: "bhw-rcm-cloud",
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function cloudRequest(path, { actor, method = "GET", body } = {}) {
  const base = apiBase();
  if (!base) throw new Error("RCM_CLOUD_API_URL is not configured");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cloudToken(actor)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Google Cloud patient registry returned ${response.status}`);
  return data;
}

const fullName = (p) => [p.legalFirstName, p.middleName, p.legalLastName].filter(Boolean).join(" ").trim();
const sourceRecordId = (p) => p.source?.recordId || p.sourceRecordId || "";
const sourceUrl = (p) => p.source?.recordUrl || p.sourceUrl || "";

function legacyPatient(p) {
  const programs = Array.isArray(p.programEnrollment) ? p.programEnrollment : [];
  const snapshot = p.clinicalSnapshot || {};
  return {
    ...p,
    id: p.bhwPatientId,
    bhwId: p.bhwPatientId,
    ctl: p.bhwPatientId,
    name: fullName(p),
    dob: p.dateOfBirth || "",
    chart: p.mrn || "",
    mrn: p.mrn || p.bhwPatientId,
    payer: p.primaryPayer || p.payerName || "",
    mco: p.medicaidMco || "",
    insurance: p.insurancePlanName || p.primaryPayer || p.payerName || "",
    member: p.memberId || "",
    pageUrl: p.patientPageUrl || "",
    page: p.patientPageUrl || "",
    sourceUrl: sourceUrl(p),
    pageId: sourceRecordId(p),
    notionPageId: sourceRecordId(p),
    program: programs.join(" · "),
    programs,
    status: p.patientStatus || "",
    snapshot: snapshot.updatedAt || "",
    allergies: snapshot.allergies || p.allergies || "",
    meds: snapshot.medications || p.medications || "",
    lastVisit: p.preventiveCare?.lastVisitDate || "",
    nextVisit: p.preventiveCare?.nextVisitDate || "",
    icds: Array.isArray(snapshot.icds) ? snapshot.icds : [],
  };
}

async function listCloudPatients(actor) {
  const data = await cloudRequest("/v1/patients", { actor });
  return (Array.isArray(data.patients) ? data.patients : []).map(legacyPatient);
}

async function findCloudPatient(id, actor) {
  const value = String(id || "").trim();
  const patients = await listCloudPatients(actor);
  return patients.find((p) => p.bhwPatientId === value || p.notionPageId === value) || null;
}

function searchCloudPatients(patients, query, limit = 25) {
  const q = String(query || "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return patients.filter((p) => {
    const haystack = [p.name, p.bhwPatientId, p.mrn, p.email, p.memberId].join(" ").toLowerCase();
    if (haystack.includes(q)) return true;
    return qDigits.length >= 7 && String(p.phone || "").replace(/\D/g, "").endsWith(qDigits.slice(-10));
  }).slice(0, limit);
}

module.exports = { cloudRequest, legacyPatient, listCloudPatients, findCloudPatient, searchCloudPatients };
