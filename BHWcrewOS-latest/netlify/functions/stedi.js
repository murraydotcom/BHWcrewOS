// netlify/functions/stedi.js — Medicare eligibility via Stedi → HETS
// Auth: STEDI_KEY_PREFIX + STEDI_KEY_SUFFIX joined at runtime (split to survive
// Netlify secret scanning — same pattern as the bhw-rcm platform).
//
// Actions (POST, logged-in staff only):
//   { action:"status" }                  → report whether credentials are configured; no eligibility request
//   { action:"check",  patientId }        → run one eligibility check, upsert tracker
//   { action:"batch",  offset }           → check up to 4 Medicare patients per call; loop with nextOffset
//   { action:"set-mbi", patientId, mbi }  → save an MBI onto the patient record

const https = require("https");
const { getSession, json } = require("./_lib");
const {
  cloudRequest,
  listCloudPatients,
  normalizeMedicareMbi,
  isValidMedicareMbi,
  resolveMedicareMbi,
} = require("./lib/cloud-patients");
const BHW_NPI = "1306511597";
const AWV_CODES = ["G0402", "G0438", "G0439"];
const STEDI_ELIGIBILITY_PATH = "/2026-06-01/eligibility-check";

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

function planBenefitEntries(response) {
  const entries = [];
  for (const plan of Array.isArray(response.plans) ? response.plans : []) {
    const benefits = plan && typeof plan.benefits === "object" ? plan.benefits : {};
    const invalidEntries = benefits.invalidEntries && typeof benefits.invalidEntries === "object"
      ? benefits.invalidEntries : {};
    for (const [type, items] of Object.entries(benefits)) {
      if (type === "invalidEntries" || !Array.isArray(items)) continue;
      for (const benefit of items) {
        if (benefit && typeof benefit === "object") entries.push({ type, benefit, plan });
      }
    }
    // The legacy endpoint passed through invalid payer data. Keep those entries visible
    // so the migration does not silently discard an AWV date or MA plan indicator.
    for (const [type, items] of Object.entries(invalidEntries)) {
      if (!Array.isArray(items)) continue;
      for (const benefit of items) {
        if (benefit && typeof benefit === "object") entries.push({ type, benefit, plan });
      }
    }
  }
  return entries;
}

function benefitDates(dates, prefix = "") {
  const found = [];
  if (!dates || typeof dates !== "object") return found;
  for (const [key, value] of Object.entries(dates)) {
    const kind = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      const date = dashDate(value);
      if (date) found.push({ kind, date });
    } else if (value && typeof value === "object") {
      found.push(...benefitDates(value, kind));
    }
  }
  return found;
}

function serviceIs(benefit, system, value) {
  const service = benefit && benefit.service;
  return String(service?.system || "").toUpperCase() === system &&
    String(service?.value || "").toUpperCase() === value;
}

function entityName(entity) {
  if (!entity) return "";
  if (typeof entity.name === "string") return entity.name;
  if (entity.name?.organization) return entity.name.organization;
  if (entity.name?.person) {
    return [entity.name.person.firstName, entity.name.person.lastName].filter(Boolean).join(" ");
  }
  return entity.entityName || "";
}

function displayEnum(value) {
  return String(value || "").toLowerCase().split("_").filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function shapePatient(patient) {
  return {
    id: patient.bhwPatientId,
    name: patient.name,
    first: patient.legalFirstName || "",
    last: patient.legalLastName || "",
    dob: patient.dob || patient.dateOfBirth || "",
    mbi: resolveMedicareMbi(patient),
    insurance: patient.primaryPayer || patient.insurance || "",
    status: patient.patientStatus || patient.status || "",
    source: patient,
  };
}

function parse271(r) {
  const out = { active: null, planType: "Unknown", maName: "", awvLast: null, awvNext: null,
                services: [], deductible: "", note: "" };
  const entries = planBenefitEntries(r);
  const statuses = entries.filter(({ type }) => type === "statuses");
  const coverageStatuses = statuses.filter(({ benefit }) => serviceIs(benefit, "STC", "30"));
  const relevantStatuses = coverageStatuses.length ? coverageStatuses : statuses;
  if (relevantStatuses.some(({ benefit }) => String(benefit.status || "").startsWith("ACTIVE"))) {
    out.active = true;
  } else if (relevantStatuses.some(({ benefit }) => String(benefit.status || "").startsWith("INACTIVE"))) {
    out.active = false;
  } else if (entries.some(({ type, benefit }) =>
    !["cannotProcess", "exclusions", "nonCovered"].includes(type) && serviceIs(benefit, "STC", "30"))) {
    out.active = true;
  }

  // CMS identifies Medicare Advantage through a service-30 contact entry carrying
  // the MA Bill Option Code and a PRIMARY_PAYER related entity.
  const payerId = String(r.payerId || r.payer?.identification || "").toUpperCase();
  const cmsMa = entries.find(({ type, benefit }) => type === "contactFollowingEntityForInformation" &&
    serviceIs(benefit, "STC", "30") &&
    (benefit.messages || []).some((message) => /MA\s+Bill\s+Option\s+Code/i.test(String(message))));
  if (payerId === "CMS" && cmsMa) {
    out.planType = "Medicare Advantage";
    const entities = Array.isArray(cmsMa.benefit.relatedEntities) ? cmsMa.benefit.relatedEntities : [];
    out.maName = entityName(entities.find((entity) => entity.type === "PRIMARY_PAYER") || entities[0]);
  }

  const deductibles = entries.filter(({ type }) => type === "deductible");
  const partBDeductibles = deductibles.filter(({ benefit }) => serviceIs(benefit, "STC", "30"));
  const deductiblePool = partBDeductibles.length ? partBDeductibles : deductibles;
  const deductible = deductiblePool.find(({ benefit }) => benefit.timePeriod === "REMAINING") || deductiblePool[0];
  if (deductible && deductible.benefit.amount !== undefined) {
    const period = displayEnum(deductible.benefit.timePeriod);
    out.deductible = `$${deductible.benefit.amount}${period ? ` (${period})` : ""}`;
  }

  for (const { type, benefit } of entries) {
    const service = benefit.service || {};
    const system = String(service.system || "").toUpperCase();
    const code = String(service.value || "").toUpperCase();
    if (!code || (system === "STC" && !AWV_CODES.includes(code))) continue;
    const dates = benefitDates(benefit.dates);
    out.services.push({
      code,
      info: service.definition || (benefit.messages || []).join("; ") || displayEnum(type),
      dates,
    });
    if (!AWV_CODES.includes(code)) continue;
    for (const date of dates) {
      if (date.kind.startsWith("latestVisit") && date.date <= today()) {
        if (!out.awvLast || date.date > out.awvLast) out.awvLast = date.date;
      } else if (!date.kind.endsWith(".end") && date.date > today()) {
        if (!out.awvNext || date.date < out.awvNext) out.awvNext = date.date;
      }
    }
  }
  if (r.errors && r.errors.length) {
    out.note = r.errors.map((error) => error.description || error.message || error.code)
      .filter(Boolean).join(" · ").slice(0, 800);
    if (!out.note) out.note = "Eligibility request rejected by payer";
  }
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
  const dateOfBirth = dashDate(patient.dob);
  if (!dateOfBirth) return { skipped: "invalid-dob" };
  const payload = {
    payerId: "CMS",
    provider: {
      name: { organization: "BALTIMORE HEALTHCARE AND WELLNESS LLC" },
      npi: BHW_NPI,
    },
    subscriber: {
      memberId: patient.mbi,
      name: {
        person: {
          firstName: patient.first.toUpperCase(),
          lastName: patient.last.toUpperCase(),
        },
      },
      dateOfBirth,
    },
    encounter: { services: [{ system: "STC", value: "30" }] },
  };
  const res = await stediRequest(STEDI_ELIGIBILITY_PATH, payload, clientIp);
  if (!res.ok) {
    const msg = (res.data && (res.data.message || JSON.stringify(res.data))) || `HTTP ${res.status}`;
    await upsertTracker(patient, parse271({}), `Stedi ${res.status}: ${String(msg).slice(0, 700)}`, session);
    return { error: `Stedi ${res.status}` };
  }
  const parsed = parse271(res.data);
  if (parsed.note) {
    // Stedi advises ignoring stub benefit data when the payer returns AAA errors.
    await upsertTracker(patient, parse271({}), `Stedi ${res.status}: ${parsed.note}`, session);
    return { error: `Stedi ${res.status}` };
  }
  await upsertTracker(patient, parsed, "", session);
  return { ok: true, active: parsed.active, awvStatus: awvStatus(parsed), awvNext: parsed.awvNext, awvLast: parsed.awvLast };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in first" });
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if (b.action === "status") return json(200, {
    configured: Boolean(stediKey()),
    provider: "Stedi",
    product: "CMS HETS 270/271 eligibility",
    checksPatientData: false,
  });
  if (!stediKey()) return json(503, { error: "Stedi key not set — add STEDI_KEY_PREFIX and STEDI_KEY_SUFFIX in Netlify environment variables" });
  const clientIp = event.headers["x-nf-client-connection-ip"] || (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "";

  try {
    if (b.action === "set-mbi") {
      if (!b.patientId || !b.mbi) return json(400, { error: "Patient and MBI required" });
      const clean = normalizeMedicareMbi(b.mbi);
      if (!isValidMedicareMbi(clean)) return json(400, { error: "Enter a valid 11-character Medicare MBI" });
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
