const APCM_CODES = Object.freeze(new Set(["G0556", "G0557", "G0558"]));
const APCM_BHI_ADDON_CODES = Object.freeze(new Set(["G0568", "G0569", "G0570"]));
const RELEVANT_PROGRAMS = Object.freeze(new Set(["APCM", "BHI", "COCM"]));

const clean = (value, maximum = 4000) => String(value ?? "").trim().slice(0, maximum);
const unique = (values) => [...new Set(values.filter(Boolean))];

function month(value) {
  const match = clean(value, 10).match(/^(\d{4})-(\d{2})/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return "";
  return `${match[1]}-${match[2]}`;
}

function dateOnly(value) {
  const match = clean(value, 20).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : "";
}

function program(value) {
  return clean(value, 40).toUpperCase().replaceAll(" ", "");
}

function codeFrom(value) {
  return clean(value, 160).toUpperCase().match(/\b(?:G\d{4}|\d{5})\b/)?.[0] || "";
}

function patientIdOf(entry = {}) {
  return clean(entry.bhwPatientId || entry.patientId || entry.ctlNo, 20).toUpperCase();
}

function patientNameOf(entry = {}) {
  return clean(entry.patientName || clean(entry.entry, 240).split(" — ")[0], 160) || patientIdOf(entry);
}

function diagnosesOf(entry = {}) {
  return unique(clean(entry.icd || entry.primaryDx, 500)
    .split(/[;,|]/)
    .map((value) => clean(value, 20).toUpperCase()));
}

function sourceIssues(entry, label) {
  const readiness = entry?.billingReadiness || {};
  const status = clean(entry?.status || "Open", 40).toLowerCase();
  const issues = [];
  if (status === "billed") issues.push(`${label} is already marked billed.`);
  else if (status !== "complete") issues.push(`${label} must be marked Complete before batch preparation.`);
  for (const blocker of Array.isArray(readiness.blockers) ? readiness.blockers : []) {
    issues.push(`${label}: ${clean(blocker, 240)}`);
  }
  const missing = Array.isArray(readiness.missing) ? readiness.missing : (Array.isArray(entry?.gaps) ? entry.gaps : []);
  for (const gap of missing) {
    if (clean(gap, 120).toLowerCase() === "claim processing") continue;
    issues.push(`${label}: ${clean(gap, 240)}`);
  }
  return issues;
}

function chooseValue(entries, key) {
  for (const entry of entries) {
    const value = clean(entry?.[key], 500);
    if (value) return value;
  }
  return "";
}

function conflictingValues(entries, key, normalize = (value) => value) {
  return unique(entries.map((entry) => clean(entry?.[key], 500)).filter(Boolean).map(normalize)).length > 1;
}

function lineItem(entry, code) {
  const evidence = entry.billingReadinessEvidence || {};
  return Object.freeze({
    sourceLogId: clean(entry.id, 160),
    program: program(entry.program),
    code,
    units: 1,
    minutes: Number(entry.minutes) || 0,
    diagnoses: diagnosesOf(entry),
    providerReviewedAt: dateOnly(evidence.providerReviewedAt),
    coverageCheckedAt: dateOnly(evidence.coverageCheckedAt),
  });
}

function groupEntries(entries, serviceMonth) {
  const grouped = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalizedProgram = program(entry?.program);
    if (!RELEVANT_PROGRAMS.has(normalizedProgram) || month(entry?.serviceMonth || entry?.month) !== serviceMonth) continue;
    const patientId = patientIdOf(entry);
    const key = `${patientId}|${serviceMonth}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  return grouped;
}

export function buildCareBillingBatch(entries, { serviceMonth, batchDate = "" } = {}) {
  const normalizedMonth = month(serviceMonth);
  if (!normalizedMonth || normalizedMonth !== clean(serviceMonth, 10)) throw new Error("A YYYY-MM service month is required.");
  const groups = [];

  for (const patientEntries of groupEntries(entries, normalizedMonth).values()) {
    const apcmEntries = patientEntries.filter((entry) => program(entry.program) === "APCM");
    const behavioralEntries = patientEntries.filter((entry) => ["BHI", "COCM"].includes(program(entry.program)));
    const first = apcmEntries[0] || behavioralEntries[0];
    const patientId = patientIdOf(first);
    const patientName = patientNameOf(first);
    const blockers = [];
    const warnings = [];
    const lines = [];

    if (!/^BHW\d{4}$/.test(patientId)) blockers.push("A verified BHW Patient Registry ID is required.");
    if (apcmEntries.length !== 1) blockers.push(apcmEntries.length ? "More than one APCM row exists for this patient and month." : "BHI/CoCM requires an APCM base row for the same patient and month.");
    if (behavioralEntries.length > 1) blockers.push("More than one BHI/CoCM row exists; select the single behavioral-health model furnished this month.");

    if (apcmEntries.length === 1) {
      const base = apcmEntries[0];
      const code = codeFrom(base.billingReadinessEvidence?.billingPath);
      blockers.push(...sourceIssues(base, "APCM"));
      if (!APCM_CODES.has(code)) blockers.push("Select one APCM base code: G0556, G0557, or G0558.");
      else lines.push(lineItem(base, code));
    }

    if (behavioralEntries.length === 1) {
      const addOn = behavioralEntries[0];
      const addOnProgram = program(addOn.program);
      const code = codeFrom(addOn.billingReadinessEvidence?.billingPath);
      blockers.push(...sourceIssues(addOn, addOnProgram === "COCM" ? "CoCM" : "BHI"));
      if (addOnProgram === "BHI" && code !== "G0570") {
        blockers.push("General BHI billed with APCM must use the reviewed 2026 add-on path G0570.");
      } else if (addOnProgram === "COCM" && !["G0568", "G0569"].includes(code)) {
        blockers.push("CoCM billed with APCM must use G0568 (initial month) or G0569 (subsequent month).");
      } else if (!APCM_BHI_ADDON_CODES.has(code)) {
        blockers.push("Select the applicable APCM behavioral-health add-on code.");
      } else {
        lines.push(lineItem(addOn, code));
      }
    }

    const payer = chooseValue(patientEntries, "payer");
    const memberId = chooseValue(patientEntries, "memberId");
    if (!payer) blockers.push("Payer is missing from the Patient Registry.");
    else if (conflictingValues(patientEntries, "payer", (value) => value.toLowerCase())) blockers.push("APCM and behavioral-health rows have conflicting payer values.");
    if (!memberId) blockers.push("Member ID is missing from the Patient Registry.");
    else if (conflictingValues(patientEntries, "memberId", (value) => value.toUpperCase())) blockers.push("APCM and behavioral-health rows have conflicting member IDs.");
    if (patientEntries.some((entry) => clean(entry.medicareCoverageOrder, 40)) && !patientEntries.some((entry) => entry.hasMbi === true)) {
      blockers.push("Medicare coverage is recorded but no MBI is confirmed on file.");
    }
    for (const item of lines) {
      if (!item.diagnoses.length) blockers.push(`${item.code}: at least one reviewed diagnosis code is required.`);
      else if (item.diagnoses.some((diagnosis) => !/^[A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4})?$/.test(diagnosis))) {
        blockers.push(`${item.code}: verify the ICD-10 diagnosis format before batch preparation.`);
      }
    }
    if (behavioralEntries.length === 0) warnings.push("APCM-only claim worksheet; no behavioral-health add-on row is recorded for this month.");

    const normalizedBlockers = unique(blockers);
    groups.push(Object.freeze({
      worksheetReference: `CM-${normalizedMonth.replace("-", "")}-${patientId || "UNLINKED"}`,
      patientId,
      patientName,
      serviceMonth: normalizedMonth,
      payer,
      memberId,
      hasMbi: patientEntries.some((entry) => entry.hasMbi === true),
      medicareCoverageOrder: chooseValue(patientEntries, "medicareCoverageOrder"),
      sourceLogIds: unique(patientEntries.map((entry) => clean(entry.id, 160))),
      lineItems: Object.freeze(lines),
      status: normalizedBlockers.length ? "blocked" : "ready",
      blockers: Object.freeze(normalizedBlockers),
      warnings: Object.freeze(unique(warnings)),
    }));
  }

  groups.sort((left, right) => left.patientName.localeCompare(right.patientName) || left.patientId.localeCompare(right.patientId));
  const ready = groups.filter((group) => group.status === "ready");
  return Object.freeze({
    schema: "bhw.care-management.manual-claim-worklist.v1",
    serviceMonth: normalizedMonth,
    batchDate: dateOnly(batchDate),
    groups: Object.freeze(groups),
    summary: Object.freeze({
      patients: groups.length,
      ready: ready.length,
      blocked: groups.length - ready.length,
      claimLines: ready.reduce((total, group) => total + group.lineItems.length, 0),
    }),
    boundary: Object.freeze({
      invoiceCreated: false,
      claimCreated: false,
      transaction837Created: false,
      clearinghouseTransmission: false,
      payerSubmission: false,
    }),
  });
}

function luhnDigit(value) {
  let sum = 0;
  let double = true;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

export function validNpi(value) {
  const npi = clean(value, 20).replace(/\D/g, "");
  return /^\d{10}$/.test(npi) && luhnDigit(`80840${npi.slice(0, 9)}`) === npi[9];
}

export function buildClaimEntryExport(batch, config = {}) {
  if (!batch || batch.schema !== "bhw.care-management.manual-claim-worklist.v1") throw new Error("A valid care-management batch is required.");
  const billingProviderName = clean(config.billingProviderName, 160);
  const billingProviderNpi = clean(config.billingProviderNpi, 20).replace(/\D/g, "");
  const serviceDate = dateOnly(config.serviceDate);
  const batchDate = dateOnly(config.batchDate || batch.batchDate);
  const placeOfService = clean(config.placeOfService, 2);
  const charges = config.charges && typeof config.charges === "object" ? config.charges : {};
  const blockers = [];
  if (!batchDate) blockers.push("Batch date is required.");
  if (!serviceDate || month(serviceDate) !== batch.serviceMonth) blockers.push("Service date must be a valid date inside the selected service month.");
  if (!billingProviderName) blockers.push("Billing provider name is required.");
  if (!validNpi(billingProviderNpi)) blockers.push("A valid 10-digit billing provider NPI is required.");
  if (!/^(?!00)\d{2}$/.test(placeOfService)) blockers.push("A valid two-digit place of service is required.");
  if (batchDate && serviceDate && batchDate < serviceDate) blockers.push("Batch date cannot be earlier than the claim service date.");
  if (config.reviewConfirmed !== true) blockers.push("Final human review must be confirmed before export.");

  const readyGroups = batch.groups.filter((group) => group.status === "ready");
  if (!readyGroups.length) blockers.push("No patient claims are source-ready for export.");
  for (const group of readyGroups) {
    for (const line of group.lineItems) {
      const charge = Number(charges[line.code]);
      if (!Number.isFinite(charge) || !(charge > 0)) blockers.push(`Enter a positive charge for ${line.code}.`);
    }
  }
  const normalizedBlockers = unique(blockers);
  if (normalizedBlockers.length) return Object.freeze({ ok: false, blockers: Object.freeze(normalizedBlockers), rows: Object.freeze([]) });

  const rows = [];
  for (const group of readyGroups) {
    group.lineItems.forEach((line, index) => rows.push(Object.freeze({
      batch_reference: `APCM-BHI-${batch.serviceMonth}-${batchDate}`,
      batch_date: batchDate,
      service_month: batch.serviceMonth,
      service_date: serviceDate,
      worksheet_reference: group.worksheetReference,
      patient_name: group.patientName,
      bhw_patient_id: group.patientId,
      payer: group.payer,
      member_id: group.memberId,
      mbi_confirmed_on_file: group.hasMbi ? "yes" : "no",
      medicare_coverage_order: group.medicareCoverageOrder,
      billing_provider_name: billingProviderName,
      billing_provider_npi: billingProviderNpi,
      place_of_service: placeOfService,
      line_number: index + 1,
      program: line.program,
      hcpcs_code: line.code,
      diagnosis_codes: line.diagnoses.join(" "),
      units: line.units,
      charge: Number(charges[line.code]).toFixed(2),
      source_care_log_id: line.sourceLogId,
      provider_reviewed_at: line.providerReviewedAt,
      coverage_checked_at: line.coverageCheckedAt,
      entry_status: "ready-for-manual-entry",
    })));
  }
  return Object.freeze({ ok: true, blockers: Object.freeze([]), rows: Object.freeze(rows) });
}

export function claimEntryCsv(rows = []) {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return "";
  const columns = Object.keys(values[0]);
  const csvValue = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...values.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\r\n");
}

export function exceptionCsv(batch) {
  const rows = batch.groups.filter((group) => group.status === "blocked").map((group) => ({
    service_month: group.serviceMonth,
    worksheet_reference: group.worksheetReference,
    patient_name: group.patientName,
    bhw_patient_id: group.patientId,
    payer: group.payer,
    source_care_log_ids: group.sourceLogIds.join(" "),
    blockers: group.blockers.join(" | "),
  }));
  return claimEntryCsv(rows);
}

export const careBillingBatchCodes = Object.freeze({
  apcm: Object.freeze([...APCM_CODES]),
  behavioralAddOns: Object.freeze([...APCM_BHI_ADDON_CODES]),
});
