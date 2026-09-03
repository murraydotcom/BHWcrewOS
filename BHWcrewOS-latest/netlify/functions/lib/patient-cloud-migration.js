const crypto = require("crypto");
const zlib = require("zlib");
const { DB, queryDb, P } = require("../_lib");
const { cloudRequest } = require("./cloud-patients");

const PREVENTION_DB = "14204ec7428d4813b158966356cbec51";
const LEGACY_QUEUE_DB = process.env.QUEUE_DB_ID || "de7906906a134b65bb0fc6966ba20b13";
const clean = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const dateOnly = (value) => clean(value, 40).slice(0, 10);
const nameKey = (value) => clean(value, 300).toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "").replace(/[^a-z0-9]/g, "");
const canonicalBhw = (value) => {
  const match = clean(value, 100).toUpperCase().replace(/[\s-]/g, "").match(/^BHW0*(\d{1,4})$/);
  return match ? `BHW${String(Number(match[1])).padStart(4, "0")}` : "";
};
const jsonValue = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const storedAnswer = (value) => {
  const raw = clean(value, 100000);
  if (!raw) return {};
  try {
    if (raw.startsWith("gz:")) return JSON.parse(zlib.gunzipSync(Buffer.from(raw.slice(3), "base64")).toString("utf8"));
    return JSON.parse(raw);
  } catch { return {}; }
};
const people = (prop) => (prop?.people || []).map((person) => person.name).filter(Boolean).join(", ");
const email = (prop) => prop?.email || "";
const phone = (prop) => prop?.phone_number || "";
const urlValue = (prop) => prop?.url || "";

function uniqueMap(rows, selector) {
  const map = new Map();
  for (const row of rows) {
    const key = clean(selector(row), 300).toLowerCase();
    if (!key) continue;
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

function one(map, key) {
  const hits = map.get(clean(key, 300).toLowerCase()) || [];
  return hits.length === 1 ? hits[0] : null;
}

async function safeQuery(id) {
  if (!id) return { rows: [], error: "Source is not configured" };
  try { return { rows: await queryDb(id), error: "" }; }
  catch (error) { return { rows: [], error: clean(error.message, 400) }; }
}

function sourceLabel(page, propertyNames = []) {
  for (const name of propertyNames) {
    const prop = page.properties?.[name];
    const value = P.title(prop) || P.text(prop) || P.uid(prop);
    if (value) return value;
  }
  return page.id;
}

function createResolver(roster, indexPages) {
  const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
  const bySource = uniqueMap(roster, (patient) => patient.source?.recordId || patient.sourceRecordId);
  const byNameDob = uniqueMap(roster, (patient) => `${nameKey(patient.name)}|${dateOnly(patient.dob)}`);
  const byMember = uniqueMap(roster, (patient) => patient.memberId);
  const byMrn = uniqueMap(roster, (patient) => patient.mrn);
  const index = new Map();

  const direct = ({ bhwPatientId, name, dob, memberId, mrn, sourceId } = {}) => {
    if (name && dob) {
      const patient = one(byNameDob, `${nameKey(name)}|${dateOnly(dob)}`);
      if (patient) return { bhwPatientId: patient.bhwPatientId, patient, reason: "" };
    }
    const id = canonicalBhw(bhwPatientId);
    if (id && byId.has(id)) {
      const patient = byId.get(id);
      if (name && nameKey(name) !== nameKey(patient.name)) return { bhwPatientId: "", reason: "The recorded BHW ID belongs to a different legal name." };
      if (dob && dateOnly(dob) !== dateOnly(patient.dob)) return { bhwPatientId: "", reason: "The recorded BHW ID belongs to a different date of birth." };
      return { bhwPatientId: id, patient, reason: "" };
    }
    const sourcePatient = sourceId ? one(bySource, sourceId) : null;
    if (sourcePatient) return { bhwPatientId: sourcePatient.bhwPatientId, patient: sourcePatient, reason: "" };
    const memberPatient = memberId ? one(byMember, memberId) : null;
    if (memberPatient) return { bhwPatientId: memberPatient.bhwPatientId, patient: memberPatient, reason: "" };
    const mrnPatient = mrn ? one(byMrn, mrn) : null;
    if (mrnPatient) return { bhwPatientId: mrnPatient.bhwPatientId, patient: mrnPatient, reason: "" };
    return { bhwPatientId: "", reason: "No unique canonical Patient Registry match was found." };
  };

  for (const page of indexPages) {
    const p = page.properties || {};
    index.set(page.id, direct({
      bhwPatientId: P.text(p["Patient ID #"]) || P.text(p["Patient Ctl No"]),
      name: P.title(p["Patient Name"]),
      dob: P.date(p.DOB),
      mrn: P.text(p["CharmHealth Chart #"]),
      sourceId: page.id,
    }));
  }

  const relation = (id) => {
    if (!id) return { bhwPatientId: "", reason: "The legacy patient relationship is blank." };
    if (index.has(id)) return index.get(id);
    return direct({ bhwPatientId: id, sourceId: id });
  };
  return { byId, byNameDob, byMember, byMrn, direct, relation };
}

function targetRecord(page, bhwPatientId, target, label) {
  return { sourceId: page.id, sourceUpdatedAt: page.last_edited_time || page.created_time || "", bhwPatientId, label: clean(label, 240), target };
}

function block(page, label, reason) {
  return { sourceId: page.id, label: clean(label, 240), reason: clean(reason, 500) };
}

function collection(key, label, source) {
  return { key, label, sourceCount: source.rows.length, sourceError: source.error, ready: [], blocked: [] };
}

function addByRelation(group, page, ref, resolver, label, targetFactory) {
  const resolved = resolver.relation(ref);
  if (!resolved.bhwPatientId) group.blocked.push(block(page, label, resolved.reason));
  else group.ready.push(targetRecord(page, resolved.bhwPatientId, targetFactory(resolved.bhwPatientId), label));
}

function parseCode(raw) {
  const value = clean(raw, 1000);
  const hcpcs = (value.match(/\b([A-Z]?\d{4,5}[A-Z]?|[A-Z]\d{4})\b\s*$/) || [])[1] || "";
  const label = value.replace(/\s*[-–—]\s*[A-Z]?\d{3,5}[A-Z]?\s*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { label: label || value, hcpcs };
}

function requestStatus(type, legacy) {
  const value = clean(legacy, 100).toLowerCase();
  if (type === "referral") {
    if (/declined|redirect|closed/.test(value)) return "closed_without_scheduling";
    if (/complete|done/.test(value)) return "referral_completed";
    if (/scheduled/.test(value)) return "scheduled";
    if (/progress|received|acknowledged/.test(value)) return "referral_in_progress";
    return "referral_received";
  }
  if (/complete|done|resolved|closed/.test(value)) return "completed";
  if (/scheduled|waiting/.test(value)) return "waiting";
  if (/progress|acknowledged|received/.test(value)) return "in_progress";
  return "received";
}

async function prepareMigration(session) {
  const sourceIds = {
    patientIndex: DB.patients,
    patientRequests: LEGACY_QUEUE_DB,
    referrals: DB.referrals,
    handoffs: DB.handoffs,
    minutes: DB.minutes,
    careLogs: DB.careLog,
    wellnessVisits: DB.awv,
    charmedPeds: DB.charmed,
    charmedAdults: DB.charmedAdult,
    charmedPrograms: DB.charmedProgram,
    programPlans: DB.phplans,
    porterCensus: DB.porterhouse,
    prevention: PREVENTION_DB,
    careGaps: DB.careGaps,
    panelProfiles: process.env.PATIENTS_DB_ID,
    panelEvents: process.env.EVENTS_DB_ID,
    questionnaires: DB.questionnaires,
    screeners: DB.screeners,
    crispArchive: process.env.NOTION_DB_ADT,
  };
  const names = Object.keys(sourceIds);
  const [registryResult, ...loaded] = await Promise.all([
    cloudRequest("/v1/patients", { actor: session }),
    ...names.map((name) => safeQuery(sourceIds[name])),
  ]);
  const roster = (Array.isArray(registryResult.patients) ? registryResult.patients : []).map((patient) => ({
    ...patient,
    name: [patient.legalFirstName, patient.middleName, patient.legalLastName, patient.nameSuffix].filter(Boolean).join(" ").trim(),
    dob: patient.dateOfBirth || "",
  }));
  const sources = Object.fromEntries(names.map((name, index) => [name, loaded[index]]));
  const resolver = createResolver(roster, sources.patientIndex.rows);
  const datasets = {};
  const group = (key, label) => (datasets[key] = collection(key, label, sources[key]));

  const referrals = group("referrals", "Division referrals");
  for (const page of sources.referrals.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Referral"]); const legacy = P.sel(p.Status);
    addByRelation(referrals, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "operations", path: "/v1/patient-requests", method: "POST", body: {
      id: `notion-${page.id.replace(/-/g, "")}`, bhwPatientId, requestType: "referral", source: "legacy-migration",
      sourceReference: page.id, summary: P.text(p.Details) || label, priority: /urgent/i.test(P.sel(p.Priority)) ? "urgent" : "routine",
      status: requestStatus("referral", legacy), notificationMode: "none",
      workflowContext: { kind: "referral", fromDivision: P.sel(p["From Division"]), toDivision: P.sel(p["To Division"]), referralType: P.sel(p["Referral Type"]), device: P.sel(p.Device), details: P.text(p.Details), completionNote: P.text(p["Completion Note"]), historicalReceivedAt: P.date(p["Sent Date"]) || page.created_time, legacyStatus: legacy },
    } }));
  }

  const handoffs = group("handoffs", "Warm handoffs");
  for (const page of sources.handoffs.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Handoff"]); const legacy = P.sel(p.Status);
    addByRelation(handoffs, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "operations", path: "/v1/patient-requests", method: "POST", body: {
      id: `notion-${page.id.replace(/-/g, "")}`, bhwPatientId, requestType: "general", source: "legacy-migration",
      sourceReference: page.id, summary: P.text(p.Summary) || label, status: requestStatus("general", legacy), notificationMode: "none",
      workflowContext: { kind: "handoff", fromDivision: P.sel(p["From Division"]), toDivision: P.sel(p["To Division"]), details: P.text(p.Summary), needs: P.multi(p.Needs), scheduledDate: P.date(p["Scheduled Date"]), historicalReceivedAt: page.created_time, legacyStatus: legacy },
    } }));
  }

  const requests = group("patientRequests", "Patient Requests queue");
  for (const page of sources.patientRequests.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Request ID", "Patient Name"]);
    const ref = P.rel(p.Patient)[0]; const resolved = ref ? resolver.relation(ref) : { bhwPatientId: "" };
    const summary = P.text(p.Summary) || "Legacy Patient Request"; const source = P.sel(p.Source) || "front-desk";
    requests.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "frontdesk", body: {
      bhwPatientId: resolved.bhwPatientId, patientMatchStatus: resolved.bhwPatientId ? "matched" : "unmatched",
      requestType: "general", priority: /urgent/i.test(P.sel(p.Priority)) ? "urgent" : "routine",
      summary, message: summary, source: clean(source, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "front-desk",
      notificationMode: "none", requester: { displayName: P.text(p["Patient Name"]), callbackPhone: phone(p["Callback Number"]), preferredChannel: /fax/i.test(source) ? "fax" : "phone" },
      routing: { targetSystem: "crewos", assignedTeam: "front-desk" },
      sourceMetadata: { sourceRecordId: page.id, sourcePage: "legacy-patient-requests", legacyNotionPageId: page.id, sourceUrl: urlValue(p["Source Link"]) },
      historicalReceivedAt: P.date(p.Received) || page.created_time,
    }, submissionId: `legacy-request:${page.id}` }, label));
  }

  const careLogs = group("careLogs", "Care-management logs");
  for (const page of sources.careLogs.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Entry"]);
    const ref = P.rel(p.Patient)[0]; const resolved = ref ? resolver.relation(ref) : resolver.direct({ bhwPatientId: P.text(p["Patient Ctl No"]), name: label });
    if (!resolved.bhwPatientId) { careLogs.blocked.push(block(page, label, resolved.reason)); continue; }
    careLogs.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: "/v1/care-management/logs", method: "POST", body: {
      id: page.id, bhwPatientId: resolved.bhwPatientId, entry: label, program: P.sel(p.Program), type: P.sel(p.Type), serviceMonth: dateOnly(P.date(p["Service Month"])), episodeDate: dateOnly(P.date(p["Episode / Discharge Date"])), minutes: P.num(p["Minutes Logged"]), activities: P.text(p["Activities Done"]), referrals: P.text(p["Referrals Completed"]), nextFollowUp: dateOnly(P.date(p["Next Follow-up"])), followUpStage: P.sel(p["Follow-up Stage"]), status: P.sel(p.Status), primaryDx: P.text(p["Primary Diagnosis"]), icd: P.text(p["ICD-10 Codes"]), coordinator: people(p["Care Coordinator"]), memberId: P.text(p["Member ID"]), lastContact: dateOnly(P.date(p["Last Contact"])), notes: P.text(p.Notes), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time,
    } }, label));
  }

  const minutes = group("minutes", "Care-management minute entries");
  for (const page of sources.minutes.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Entry"]);
    addByRelation(minutes, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "rcm", path: "/v1/care-management/logs", method: "POST", body: {
      id: page.id, bhwPatientId, entry: label, program: P.sel(p.Program), type: "Minute entry", serviceMonth: dateOnly(P.date(p.Date)), minutes: P.num(p.Minutes), activities: P.sel(p.Activity), notes: P.text(p.Note), coordinator: people(p.Staff), inCharmHealth: P.check(p["In CharmHealth"]), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time,
    } }));
  }

  const wellness = group("wellnessVisits", "Annual wellness visits");
  for (const page of sources.wellnessVisits.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Encounter"]);
    addByRelation(wellness, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "rcm", path: `/v1/patients/${bhwPatientId}/wellness-visits`, method: "POST", body: {
      id: page.id, bhwPatientId, date: dateOnly(P.date(p.Date)), status: P.sel(p.Status), steps: ["S1 HRA", "S2 Office Tests", "S3 Prevention Plan", "S4 Nutrition & Activity", "S5 ACP"].map((key) => P.sel(p[key]) || "Not Started"), flags: P.multi(p.Flags), review: P.sel(p["Provider Review"]), signedBy: P.text(p["Signed By"]), signedDate: dateOnly(P.date(p["Signed Date"])), providerNote: P.text(p.Notes), miniCog: P.num(p["Mini-Cog Score"]), diet: P.num(p["Diet Score"]), exercise: P.num(p["Exercise Min/Week"]), answers: [1, 2, 3, 4, 5].map((index) => jsonValue(P.text(p[`Answers S${index}`]))), conductedBy: people(p["Conducted By"]), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time,
    } }));
  }

  const assessmentMap = new Map();
  for (const [key, kind, steps] of [
    ["charmedPeds", "peds", ["S1 Intake", "S2 School & Attention", "S3 Social & Sensory", "S4 Wellbeing & Context", "S5 Screeners"]],
    ["charmedAdults", "adult", ["S1 Concerns & Function", "S2 EF, Social & Sensory", "S3 Mental Health & Cognition", "S4 Substance, Injury & Trauma", "S5 Vascular, Sleep & Change", "S6 Screeners"]],
  ]) {
    const assessments = group(key, kind === "peds" ? "CharmEd pediatric assessments" : "CharmEd adult assessments");
    for (const page of sources[key].rows) {
      const p = page.properties || {}; const label = sourceLabel(page, ["Assessment", "Patient"]); const resolved = resolver.relation(P.rel(p.Patient)[0]);
      if (!resolved.bhwPatientId) { assessments.blocked.push(block(page, label, resolved.reason)); continue; }
      let statusSteps = steps.map((step) => P.sel(p[step]) || "Not Started"); let answers = steps.map((_, index) => jsonValue(P.text(p[`Answers S${index + 1}`])));
      if (kind === "peds") {
        const tail = storedAnswer(P.text(p["Answers S6"])); const workflow = tail?.__cmWorkflowV2 === 1;
        statusSteps = [...statusSteps, workflow ? tail.stepStatus?.inPerson || "Not Started" : "Not Started", workflow ? tail.stepStatus?.results || "Not Started" : P.sel(p["S6 Results & Recs"]) || "Not Started"];
        answers = [...answers, workflow ? tail.inPerson || {} : {}, workflow ? tail.results || {} : tail];
      }
      assessmentMap.set(page.id, { bhwPatientId: resolved.bhwPatientId, assessmentId: page.id });
      assessments.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: `/v1/patients/${resolved.bhwPatientId}/charmed/assessments`, method: "POST", body: { id: page.id, kind, bhwPatientId: resolved.bhwPatientId, date: dateOnly(P.date(p.Date)), status: P.sel(p.Status), ageGroup: P.sel(p["Age Group"]), steps: statusSteps, flags: P.multi(p.Flags), screeners: P.multi(p["Suggested Screeners"]), answers, sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time } }, label));
    }
  }

  const programs = group("charmedPrograms", "CharmEd program enrollments");
  for (const page of sources.charmedPrograms.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Enrollment", "Program"]);
    addByRelation(programs, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "rcm", path: `/v1/patients/${bhwPatientId}/charmed/program-enrollments`, method: "POST", body: { id: page.id, bhwPatientId, track: P.sel(p.Track), startDate: dateOnly(P.date(p["Start Date"])), stage: P.sel(p.Stage), battery: P.multi(p["Baseline Battery"]), baselineDate: dateOnly(P.date(p["Baseline Date"])), retestDate: dateOnly(P.date(p["Retest Date"])), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time } }));
  }

  const plans = group("programPlans", "Porter House growth plans");
  const planByPatient = new Map();
  for (const page of sources.programPlans.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Plan"]); const resolved = resolver.relation(P.rel(p.Resident)[0]);
    if (!resolved.bhwPatientId) { plans.blocked.push(block(page, label, resolved.reason)); continue; }
    const record = targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: `/v1/patients/${resolved.bhwPatientId}/program-care-plans`, method: "POST", body: { id: page.id, bhwPatientId: resolved.bhwPatientId, program: "The Porter House", moveInDate: dateOnly(P.date(p["Move-In Date"])), stage: P.sel(p.Stage), readinessBaselinePercent: P.num(p["Readiness Baseline %"]), readinessLatestPercent: P.num(p["Readiness Latest %"]), readinessBaseline: jsonValue(P.text(p["LR Baseline"])), readinessLatest: jsonValue(P.text(p["LR Latest"])), readinessLatestDate: dateOnly(P.date(p["LR Latest Date"])), symptomDrivers: P.multi(p["Symptom Drivers"]), behavioralHealthScreens: jsonValue(P.text(p["BH Screen Log"]), []), latestPhq9: P.num(p["Latest PHQ-9"]), latestGad7: P.num(p["Latest GAD-7"]), latestScreenDate: dateOnly(P.date(p["Latest Screen Date"])), growthGoals: jsonValue(P.text(p["Growth Goals"]), []), notes: P.text(p.Notes), caseLead: people(p["Case Lead"]), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time } }, label);
    plans.ready.push(record); planByPatient.set(resolved.bhwPatientId, [...(planByPatient.get(resolved.bhwPatientId) || []), record]);
  }

  const census = group("porterCensus", "Porter House census details");
  for (const page of sources.porterCensus.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Resident"]); const phId = P.uid(p["PH ID"]); let resolved = resolver.direct({ bhwPatientId: phId, name: label });
    if (!resolved.bhwPatientId) {
      const candidates = plans.ready.filter((record) => nameKey(resolver.byId.get(record.bhwPatientId)?.name) === nameKey(label));
      if (candidates.length === 1) resolved = { bhwPatientId: candidates[0].bhwPatientId };
    }
    const candidatePlans = planByPatient.get(resolved.bhwPatientId) || [];
    if (!resolved.bhwPatientId || candidatePlans.length !== 1) { census.blocked.push(block(page, label, resolved.reason || "A single linked growth plan is required before census details can be attached.")); continue; }
    const plan = candidatePlans[0];
    census.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: `/v1/patients/${resolved.bhwPatientId}/program-care-plans`, method: "POST", body: { id: plan.sourceId, bhwPatientId: resolved.bhwPatientId, program: "The Porter House", roomUnit: P.text(p["Room/Unit"]), alsoReceives: P.multi(p["Also Receives"]), residentStatus: P.sel(p.Status), programPatientId: phId, moveInDate: dateOnly(P.date(p["Admit Date"])), sourceSystem: "Legacy protected migration", sourceRecordId: plan.sourceId } }, label));
  }

  const prevention = group("prevention", "Medicare prevention summaries");
  for (const page of sources.prevention.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Check"]);
    addByRelation(prevention, page, P.rel(p.Patient)[0], resolver, label, (bhwPatientId) => ({ kind: "rcm", path: "/v1/panel/profiles", method: "POST", body: { bhwPatientId, coverage: P.sel(p.Coverage), planType: P.sel(p["Plan Type"]), medicareAdvantagePlanName: P.text(p["MA Plan Name"]), awvLastDate: dateOnly(P.date(p["AWV Last Date"])), awvNextEligibleDate: dateOnly(P.date(p["AWV Next Eligible"])), awvStatus: P.sel(p["AWV Status"]) || "Unknown", coverageCheckedAt: P.date(p["Last Checked"]) || page.last_edited_time, preventiveServices: jsonValue(P.text(p["Preventive Services"]), []), deductibleRemaining: P.text(p["Deductible Remaining"]), coverageNotes: P.text(p["Raw Notes"]), sourceSystem: "Legacy protected migration", sourceRecordId: page.id } }));
  }

  const gaps = group("careGaps", "Payer preventive gap rows");
  const gapGroups = new Map();
  for (const page of sources.careGaps.rows) {
    const p = page.properties || {}; const memberId = P.text(p["Member ID"]); const name = P.title(p["Patient Name"]); const resolved = resolver.direct({ memberId, name });
    if (!resolved.bhwPatientId) { gaps.blocked.push(block(page, name || memberId || page.id, resolved.reason)); continue; }
    const rawCode = P.text(p["Preventative Code"]); const parsed = parseCode(rawCode); const state = P.text(p["Eligibility State"]);
    const entry = { code: rawCode, label: parsed.label, hcpcs: parsed.hcpcs, state, open: /active\s*coverage/i.test(state), eligibleProf: dateOnly(P.date(p["Eligible Date Prof:"])), eligibleTech: dateOnly(P.date(p["Eligible Date Tech:"])) };
    const current = gapGroups.get(resolved.bhwPatientId) || { pages: [], records: [], payer: P.text(p.Payer) };
    current.pages.push(page); current.records.push(entry); if (!current.payer) current.payer = P.text(p.Payer); gapGroups.set(resolved.bhwPatientId, current);
  }
  for (const [bhwPatientId, value] of gapGroups) {
    const page = value.pages[0]; gaps.ready.push(targetRecord(page, bhwPatientId, { kind: "rcm", path: "/v1/panel/profiles", method: "POST", body: { bhwPatientId, payer: value.payer, preventiveGaps: value.records, sourceSystem: "Legacy protected migration", sourceRecordId: value.pages.map((item) => item.id).join(",").slice(0, 160) } }, resolver.byId.get(bhwPatientId)?.name || bhwPatientId));
  }

  const profiles = group("panelProfiles", "Panel quality profiles"); const panelMap = new Map();
  for (const page of sources.panelProfiles.rows) {
    const p = page.properties || {}; if (P.check(p.Archived)) continue; const label = sourceLabel(page, ["MRN / Initials"]); const resolved = resolver.direct({ bhwPatientId: label, mrn: label });
    if (!resolved.bhwPatientId) { profiles.blocked.push(block(page, label, "Panel rows require an exact canonical BHW ID or unique MRN; initials are not enough.")); continue; }
    panelMap.set(page.id, resolved.bhwPatientId); const hedis = {}; const keys = { bp: "BP Control", a1c: "A1c Control", bcs: "Breast Cancer Screening", col: "Colorectal Screening", dep: "Depression Screening", adh: "Med Adherence", fuh: "7-Day Follow-Up", awv: "AWV" }; const vals = { Met: "met", Gap: "open", "N/A": "na" };
    for (const [key, prop] of Object.entries(keys)) if (vals[P.sel(p[prop])]) hedis[key] = vals[P.sel(p[prop])];
    profiles.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: "/v1/panel/profiles", method: "POST", body: { bhwPatientId: resolved.bhwPatientId, payer: P.sel(p.Payer), program: (P.sel(p.Program) || "none").replace(/^None$/i, "none"), enrollDate: dateOnly(P.date(p["Enrollment Date"])), hedis, sourceSystem: "Legacy protected migration", sourceRecordId: page.id } }, label));
  }

  const events = group("panelEvents", "Panel utilization events");
  for (const page of sources.panelEvents.rows) {
    const p = page.properties || {}; if (P.check(p.Archived)) continue; const label = sourceLabel(page, ["Event"]); const bhwPatientId = panelMap.get(P.rel(p.Patient)[0]);
    if (!bhwPatientId) { events.blocked.push(block(page, label, "The linked panel row is not mapped to a canonical Patient Registry record.")); continue; }
    const types = { "ED visit": "ed", "Urgent care": "uc", Admission: "admit", Readmission: "readmit", Observation: "obs" };
    events.ready.push(targetRecord(page, bhwPatientId, { kind: "rcm", path: "/v1/panel/events", method: "POST", body: { id: page.id, bhwPatientId, type: types[P.sel(p.Type)] || "ed", date: dateOnly(P.date(p.Date) || page.created_time), dateTo: dateOnly(p.Date?.date?.end || P.date(p.Date) || page.created_time), facility: P.text(p.Facility), reason: P.text(p.Reason), discharge: P.check(p["Discharge Info in Chart"]), outreach1: dateOnly(P.date(p["Outreach 1"])), outreach2: dateOnly(P.date(p["Outreach 2"])), outreach3: dateOnly(P.date(p["Outreach 3"])), appointment: P.text(p["Follow-Up Appointment"]), historical: P.check(p["Historical Backfill"]), sourceSystem: "Legacy protected migration", sourceRecordId: page.id, createdAt: page.created_time } }, label));
  }

  for (const [key, kind] of [["questionnaires", "questionnaire"], ["screeners", "screener"]]) {
    const responses = group(key, kind === "screener" ? "Condition screener responses" : "Questionnaire responses");
    for (const page of sources[key].rows) {
      const p = page.properties || {}; const label = sourceLabel(page, kind === "screener" ? ["Screener Name"] : ["Name"]); const relationId = P.rel(p.Patient)[0]; const assessment = assessmentMap.get(relationId);
      let resolved = assessment ? { bhwPatientId: assessment.bhwPatientId } : resolver.direct({ bhwPatientId: P.text(p["BHW ID"]), name: P.text(p["Patient Name"]) });
      if (!resolved.bhwPatientId) { responses.blocked.push(block(page, label, "The response is not linked to a uniquely verified patient or assessment.")); continue; }
      const raw = kind === "screener" ? jsonValue(P.text(p["Raw Responses"])) : {};
      const answers = kind === "screener" ? raw.answers || {} : jsonValue(P.text(p["Answers JSON"]));
      const transcript = kind === "screener" ? P.text(p["Raw Responses"]) : P.text(p.Answers);
      const screeningName = kind === "screener" ? label.split(/—|-/)[0].trim() : P.sel(p.Questionnaire) || label;
      responses.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: "/v1/questionnaire-responses", method: "POST", body: { responseId: page.id, sourceRecordId: page.id, bhwPatientId: resolved.bhwPatientId, assessmentId: relationId || "", screeningId: clean(raw.slug || screeningName, 100).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), screeningName, program: P.sel(p.Program) || (kind === "screener" ? "CharmEd Minds" : "legacy"), responseKind: kind, respondent: P.sel(p["Who Completed"]) || P.sel(p["Who Completes"]), answers, extra: kind === "screener" ? raw.extra || {} : {}, transcript, flags: P.text(p.Flags), submittedAt: P.date(p.Submitted) || page.created_time, sourceSystem: "Legacy protected migration" } }, label));
    }
  }

  const crisp = group("crispArchive", "Legacy CRISP ADT archive");
  for (const page of sources.crispArchive.rows) {
    const p = page.properties || {}; const label = sourceLabel(page, ["Patient"]); const resolved = resolver.direct({ bhwPatientId: label, name: label });
    crisp.ready.push(targetRecord(page, resolved.bhwPatientId, { kind: "rcm", path: "/v1/crisp-events", method: "POST", body: { patient: label || "Unmatched historical patient", bhwPatientId: resolved.bhwPatientId, type: P.sel(p.Type) || "update", event: P.text(p.Event), facility: P.text(p.Facility), date: dateOnly(P.date(p.Date) || page.created_time), dispo: P.text(p.Disposition), complexity: P.sel(p.Complexity), source: P.text(p.Source) || "Legacy CRISP archive", receivedAt: page.created_time } }, label));
  }

  return { rosterCount: roster.length, datasets };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digestDataset(dataset) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    sourceError: dataset.sourceError,
    ready: dataset.ready,
    blocked: dataset.blocked,
  }))).digest("base64url");
}

function signPreview(prepared, session, secret, now = Date.now()) {
  if (!secret) throw new Error("SESSION_SECRET is required to seal the migration preview");
  const payload = Buffer.from(JSON.stringify({
    sub: session.staffId || session.sub,
    exp: now + 30 * 60 * 1000,
    datasets: Object.fromEntries(Object.entries(prepared.datasets).map(([key, dataset]) => [key, digestDataset(dataset)])),
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`patient-cloud-migration:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyPreview(token, prepared, session, secret, datasetKey, now = Date.now()) {
  const [payload, signature] = clean(token, 12000).split(".");
  if (!payload || !signature || !secret) throw Object.assign(new Error("Run a new protected preview first."), { status: 409 });
  const expected = crypto.createHmac("sha256", secret).update(`patient-cloud-migration:${payload}`).digest("base64url");
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw Object.assign(new Error("The protected preview seal is not valid."), { status: 409 });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (claims.exp < now || claims.sub !== (session.staffId || session.sub)) throw Object.assign(new Error("The protected preview expired. Run it again."), { status: 409 });
  if (!claims.datasets?.[datasetKey] || claims.datasets[datasetKey] !== digestDataset(prepared.datasets[datasetKey])) throw Object.assign(new Error("The source records changed after preview. Review them again."), { status: 409 });
  return true;
}

function publicPreview(prepared) {
  return {
    rosterCount: prepared.rosterCount,
    datasets: Object.values(prepared.datasets).map((dataset) => ({
      key: dataset.key,
      label: dataset.label,
      sourceCount: dataset.sourceCount,
      readyCount: dataset.ready.length,
      blockedCount: dataset.blocked.length,
      sourceError: dataset.sourceError,
      blocked: dataset.blocked.slice(0, 200),
    })),
  };
}

module.exports = { prepareMigration, publicPreview, signPreview, verifyPreview };
