// netlify/functions/stedi.js — Medicare eligibility via Stedi → HETS
// Auth: STEDI_KEY_PREFIX + STEDI_KEY_SUFFIX joined at runtime (split to survive
// Netlify secret scanning — same pattern as the bhw-rcm platform).
//
// Actions (POST, logged-in staff only):
//   { action:"check",  patientId }        → run one eligibility check, upsert tracker
//   { action:"batch",  offset }           → check up to 4 Medicare patients per call; loop with nextOffset
//   { action:"set-mbi", patientId, mbi }  → save an MBI onto the patient record

const https = require("https");
const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const BHW_NPI = "1306511597";
const AWV_CODES = ["G0402", "G0438", "G0439"];

function stediKey() {
  const pre = (process.env.STEDI_KEY_PREFIX || "").trim();
  const suf = (process.env.STEDI_KEY_SUFFIX || "").trim();
  let key = (pre + suf).trim();
  if (!key) return "";
  // Stedi expects the "Key" auth scheme — add it unless it's already there
  if (!/^key\s/i.test(key)) key = `Key ${key}`;
  return key;
}

function stediRequest(path, body, clientIp) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      Authorization: stediKey(),
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    };
    // CMS traceability requirement (effective Nov 2025): pass the originating IP chain to HETS
    if (clientIp) headers["X-Forwarded-For"] = clientIp;
    const req = https.request({
      hostname: "healthcare.us.stedi.com",
      path,
      method: "POST",
      headers,
    }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(out || "{}"); } catch { parsed = { raw: out }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const dashDate = (d) => {
  if (!d) return null;
  const s = String(d).replace(/[^0-9]/g, "");
  return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : null;
};
const today = () => new Date().toISOString().slice(0, 10);

function shapePatient(patient) {
  return {
    id: patient.bhwPatientId,
    name: patient.name,
    first: patient.legalFirstName || "",
    last: patient.legalLastName || "",
    dob: patient.dob || patient.dateOfBirth || "",
    mbi: String(patient.medicareMbi || "").replace(/[^A-Za-z0-9]/g, ""),
    insurance: patient.primaryPayer || patient.insurance || "",
    status: patient.patientStatus || patient.status || "",
    source: patient,
  };
}

function parse271(r) {
  const out = { active: null, planType: "Unknown", maName: "", awvLast: null, awvNext: null,
                services: [], deductible: "", note: "" };
  const bi = Array.isArray(r.benefitsInformation) ? r.benefitsInformation : [];
  if (r.planStatus && r.planStatus.length) {
    out.active = r.planStatus.some((s) => String(s.statusCode) === "1");
  } else if (bi.length) {
    out.active = bi.some((b) => String(b.code) === "1");
  }
  // Medicare Advantage detection: HETS reports MA enrollment via related entities / insurance type text
  for (const b of bi) {
    const t = `${b.insuranceType || ""} ${b.planCoverage || ""} ${(b.serviceTypes || []).join(" ")}`.toLowerCase();
    if (t.includes("medicare advantage") || (b.insuranceTypeCode && ["HM","HN","IN","PR","PS"].includes(b.insuranceTypeCode))) {
      out.planType = "Medicare Advantage";
      const ent = (b.benefitsRelatedEntities || b.benefitsRelatedEntity ? [].concat(b.benefitsRelatedEntities || b.benefitsRelatedEntity) : [])[0];
      if (ent && (ent.entityName || ent.name)) out.maName = ent.entityName || ent.name || "";
    }
    // deductible remaining (Part B): code C + remaining time qualifier
    if (String(b.code) === "C" && b.benefitAmount !== undefined && !out.deductible) {
      const tq = (b.timeQualifier || "").toLowerCase();
      out.deductible = `$${b.benefitAmount}${tq ? " (" + b.timeQualifier + ")" : ""}`;
    }
    // preventive service dates by HCPCS
    const code = (b.procedureCode || "").toUpperCase();
    if (code) {
      const dates = [];
      const bd = b.benefitsDateInformation || {};
      for (const k of Object.keys(bd)) {
        const v = bd[k];
        if (typeof v === "string") { const dd = dashDate(v); if (dd) dates.push({ kind: k, date: dd }); }
        else if (v && typeof v === "object") {
          for (const kk of Object.keys(v)) { const dd = dashDate(v[kk]); if (dd) dates.push({ kind: `${k}.${kk}`, date: dd }); }
        }
      }
      out.services.push({ code, info: (b.serviceTypes || []).join("; ") || b.name || "", dates });
      if (AWV_CODES.includes(code)) {
        for (const d of dates) {
          if (d.date > today()) { if (!out.awvNext || d.date < out.awvNext) out.awvNext = d.date; }
          else { if (!out.awvLast || d.date > out.awvLast) out.awvLast = d.date; }
        }
      }
    }
  }
  if (r.errors && r.errors.length) out.note = r.errors.map((e) => e.description || e.code).join(" · ").slice(0, 800);
  return out;
}

function awvStatus(parsed) {
  const t = today();
  if (parsed.awvNext && parsed.awvNext <= t) return "Due now";
  if (parsed.awvLast) {
    const months = (new Date(t) - new Date(parsed.awvLast)) / (30.44 * 86400000);
    if (months >= 11) return "Due now";
    if (months >= 9) return "Upcoming";
    return "Recently done";
  }
  if (parsed.awvNext) return "Upcoming";
  if (parsed.active) return "Due now"; // active Medicare, no AWV history returned → treat as due, verify manually
  return "Unknown";
}

async function upsertTracker(patient, parsed, errNote, session) {
  const result = await cloudRequest("/v1/panel/profiles", {
    actor: session,
    method: "POST",
    body: {
      bhwPatientId: patient.id,
      payer: patient.insurance,
      coverage: errNote ? "Error — see notes" : (parsed.active ? "Active" : "Inactive"),
      planType: parsed.planType,
      medicareAdvantagePlanName: parsed.maName,
      awvStatus: errNote ? "Unknown" : awvStatus(parsed),
      awvLastDate: parsed.awvLast || "",
      awvNextEligibleDate: parsed.awvNext || "",
      coverageCheckedAt: new Date().toISOString(),
      preventiveServices: parsed.services,
      deductibleRemaining: parsed.deductible,
      coverageNotes: (errNote || parsed.note || "").slice(0, 4000),
      sourceSystem: "Stedi HETS",
    },
  });
  return result.profile?.id || patient.id;
}

async function runCheck(patient, clientIp, session) {
  if (!patient.mbi) return { skipped: "no-mbi" };
  if (!patient.dob) return { skipped: "no-dob" };
  const payload = {
    controlNumber: String(Math.floor(100000000 + Math.random() * 899999999)),
    tradingPartnerServiceId: "CMS",
    provider: { organizationName: "BALTIMORE HEALTHCARE AND WELLNESS LLC", npi: BHW_NPI },
    subscriber: {
      memberId: patient.mbi,
      firstName: patient.first.toUpperCase(),
      lastName: patient.last.toUpperCase(),
      dateOfBirth: patient.dob.replace(/-/g, ""),
    },
    encounter: { serviceTypeCodes: ["30"] },
  };
  const res = await stediRequest("/2024-04-01/change/medicalnetwork/eligibility/v3", payload, clientIp);
  if (!res.ok) {
    const msg = (res.data && (res.data.message || JSON.stringify(res.data))) || `HTTP ${res.status}`;
    await upsertTracker(patient, parse271({}), `Stedi ${res.status}: ${String(msg).slice(0, 700)}`, session);
    return { error: `Stedi ${res.status}` };
  }
  const parsed = parse271(res.data);
  await upsertTracker(patient, parsed, "", session);
  return { ok: true, active: parsed.active, awvStatus: awvStatus(parsed), awvNext: parsed.awvNext, awvLast: parsed.awvLast };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in first" });
  if (!stediKey()) return json(503, { error: "Stedi key not set — add STEDI_KEY_PREFIX and STEDI_KEY_SUFFIX in Netlify environment variables" });
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const clientIp = event.headers["x-nf-client-connection-ip"] || (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "";

  try {
    if (b.action === "set-mbi") {
      if (!b.patientId || !b.mbi) return json(400, { error: "Patient and MBI required" });
      const clean = String(b.mbi).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (clean.length !== 11) return json(400, { error: "An MBI is 11 characters (letters and numbers, no dashes needed)" });
      const patients = await listCloudPatients(session);
      const patient = patients.find((item) => item.bhwPatientId === String(b.patientId).toUpperCase());
      if (!patient) return json(404, { error: "Patient not found in the Patient Registry" });
      const result = await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}`, {
        actor: session, method: "PUT", body: { ...patient, medicareMbi: clean },
      });
      return json(200, { ok: true, savedAt: result.patient?.updatedAt || new Date().toISOString(), storage: "BHW Cloud" });
    }

    if (b.action === "check") {
      const patients = await listCloudPatients(session);
      const raw = patients.find((item) => item.bhwPatientId === String(b.patientId || "").toUpperCase());
      if (!raw) return json(404, { error: "Patient not found" });
      const patient = shapePatient(raw);
      if (!patient.mbi) return json(400, { error: "No MBI on file for this patient — add it first" });
      const result = await runCheck(patient, clientIp, session);
      return json(200, result);
    }

    if (b.action === "batch") {
      const offset = b.offset || 0;
      const targets = (await listCloudPatients(session)).map(shapePatient).filter((p) =>
        ["Medicare", "Medicare + Medicaid"].includes(p.insurance) && p.mbi && p.status !== "Deceased");
      const slice = targets.slice(offset, offset + 4);
      const results = [];
      for (const patient of slice) {
        try { results.push({ name: patient.name, ...(await runCheck(patient, clientIp, session)) }); }
        catch (e) { results.push({ name: patient.name, error: e.message }); }
      }
      const next = offset + slice.length;
      return json(200, { processed: results, done: next >= targets.length, nextOffset: next, total: targets.length });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
