import {
  COVERAGE_ORDERS,
  coverageSlotsForPatient,
  insuranceEditorLimitMessage,
  insuranceStorageForPatient,
  isValidMedicareMbi,
  medicareMbiForPatient,
  normalizeCoverageRecord,
  normalizeMedicareMbi,
  payerDirectoryEntry,
  payerNameNeedsReview,
} from "../shared/patient-coverage.mjs";

const clean = (value) => String(value ?? "").trim();

export function parseCsv(text = "") {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function rowObject(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [clean(header), clean(values[index])]));
}

function sourcePatientId(patientName) {
  return clean(patientName).match(/\[((?:BHW[A]?|PAT)\d+)\]/i)?.[1]?.toUpperCase() || "";
}

function eligibilityStatus(value) {
  const status = clean(value).toLowerCase();
  // The report records coverage, not a current payer eligibility transaction.
  // Any report-side result remains review-only until eligibility is checked separately.
  return status ? "needs-review" : "unknown";
}

export function coverageOrderFromFilename(name = "") {
  const normalized = clean(name).toLowerCase();
  return COVERAGE_ORDERS.find((order) => new RegExp(`(?:^|[^a-z])${order}(?:[^a-z]|$)`).test(normalized)) || "";
}

export function parseInsuranceReport(text, coverageOrder) {
  if (!COVERAGE_ORDERS.includes(coverageOrder)) throw new Error("Choose a primary, secondary, or other insurance report.");
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((candidate) => candidate.includes("Patient Name") && candidate.includes("Payer Name"));
  if (headerIndex < 0) throw new Error("The insurance report header was not found. Use the CharmHealth Patient Insurance Report CSV.");
  const headers = rows[headerIndex];
  return rows.slice(headerIndex + 1).filter((candidate) => candidate.some(clean)).map((values, offset) => {
    const source = rowObject(headers, values);
    const rawPayer = source["Payer Name"];
    const rawPlan = source["Plan Name/Program Name"];
    const record = normalizeCoverageRecord({
      coverageOrder,
      payerName: rawPayer,
      payerId: source["Payer ID"],
      effectiveFrom: source["Valid From"],
      effectiveTo: source["Valid Until"],
      memberId: source["Insurance ID"],
      planName: rawPlan,
      groupNumber: source["Policy group / FECA #"],
      coverageStatus: eligibilityStatus(source["Insurance Eligibility Status"]),
    }, coverageOrder);
    const id = sourcePatientId(source["Patient Name"]);
    const reasons = [];
    if (!id) reasons.push("Patient ID is missing from the report row");
    else if (!/^BHW\d{4}$/.test(id) || id === "BHW0000") reasons.push("Legacy, reserved, or non-canonical patient ID requires review");
    if (!record.payerName) reasons.push("Insurance payer name is missing");
    else if (!payerDirectoryEntry(record.payerName)) reasons.push("Insurance payer name is not a recognized carrier");
    if (payerNameNeedsReview(record.payerName)) reasons.push("Generic Medicaid label requires the named MCO");
    const mbi = record.insuranceType === "original-medicare" && isValidMedicareMbi(record.memberId)
      ? normalizeMedicareMbi(record.memberId)
      : "";
    return {
      sourceRow: headerIndex + offset + 2,
      sourcePatientId: id,
      coverageOrder,
      coverageRecord: record,
      medicareMbi: mbi,
      classificationNeedsRegistry: !record.insuranceType,
      reasons,
    };
  });
}

function mergeCoverage(existing, incoming) {
  const merged = { ...existing, coverageOrder: incoming.coverageOrder };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "coverageStatus") continue;
    if (clean(value)) merged[key] = value;
  }
  const sourceStatus = incoming.coverageStatus;
  merged.coverageStatus = ["unknown", "needs-review"].includes(sourceStatus) && existing.coverageStatus === "verified"
    ? "verified"
    : sourceStatus || existing.coverageStatus || "unknown";
  return normalizeCoverageRecord(merged, incoming.coverageOrder);
}

function recordSignature(record) {
  return JSON.stringify([
    record.coverageOrder, record.insuranceType, record.payerName, record.planName, record.memberId,
    record.groupNumber, record.payerId, record.effectiveFrom, record.effectiveTo, record.coverageStatus,
  ]);
}

function insuranceSignature(patient) {
  const stored = insuranceStorageForPatient(patient);
  return JSON.stringify([stored.medicareMbi, stored.coverageRecords]);
}

export function prepareInsuranceUpdates(reportRows = [], patients = []) {
  const patientIndex = new Map(patients.map((patient) => [clean(patient.bhwPatientId).toUpperCase(), patient]));
  const grouped = new Map();
  const review = [];

  for (const row of reportRows) {
    const id = row.sourcePatientId;
    if (row.reasons.length) { review.push({ ...row, reason: row.reasons.join("; ") }); continue; }
    if (!patientIndex.has(id)) { review.push({ ...row, reason: "Canonical BHW ID is not in the current Registry" }); continue; }
    const currentPatient = patientIndex.get(id);
    if (!clean(currentPatient.updatedAt)) {
      review.push({ ...row, reason: "Current Registry version is missing; refresh the Registry before preparing updates" });
      continue;
    }
    const editorLimit = insuranceEditorLimitMessage(currentPatient);
    if (editorLimit) {
      review.push({ ...row, reason: `${editorLimit} Preserve the current coverage records and review this patient manually.` });
      continue;
    }
    let resolvedRow = row;
    if (row.classificationNeedsRegistry) {
      const carrier = payerDirectoryEntry(row.coverageRecord.payerName);
      if (!carrier) {
        review.push({ ...row, reason: "Unrecognized payer text cannot inherit a Registry classification" });
        continue;
      }
      const currentType = coverageSlotsForPatient(currentPatient)[row.coverageOrder].insuranceType;
      if (!currentType) {
        review.push({ ...row, reason: "Insurance classification is unresolved in both the report and current Registry" });
        continue;
      }
      const coverageRecord = normalizeCoverageRecord({ ...row.coverageRecord, insuranceType: currentType }, row.coverageOrder);
      resolvedRow = {
        ...row,
        coverageRecord,
        medicareMbi: coverageRecord.insuranceType === "original-medicare" && isValidMedicareMbi(coverageRecord.memberId)
          ? normalizeMedicareMbi(coverageRecord.memberId)
          : "",
        classificationNeedsRegistry: false,
      };
    }
    const group = grouped.get(id) || { patient: currentPatient, rows: [], mbi: new Set() };
    group.rows.push(resolvedRow);
    if (resolvedRow.medicareMbi) group.mbi.add(resolvedRow.medicareMbi);
    grouped.set(id, group);
  }

  const updates = [];
  const unchanged = [];
  for (const [bhwPatientId, group] of grouped) {
    const byOrder = new Map();
    let conflict = "";
    for (const row of group.rows) {
      const existing = byOrder.get(row.coverageOrder);
      if (existing && recordSignature(existing.coverageRecord) !== recordSignature(row.coverageRecord)) {
        conflict = `Conflicting ${row.coverageOrder} insurance rows require review`;
        break;
      }
      byOrder.set(row.coverageOrder, row);
    }
    if (group.mbi.size > 1) conflict = "Conflicting Medicare Beneficiary Identifiers require review";
    const currentMbi = medicareMbiForPatient(group.patient);
    const importedMbi = [...group.mbi][0] || "";
    if (importedMbi && currentMbi && normalizeMedicareMbi(currentMbi) !== importedMbi) {
      conflict = "Imported Medicare Beneficiary Identifier conflicts with the current Registry and requires review";
    } else if (!group.mbi.size && currentMbi && !isValidMedicareMbi(currentMbi)) {
      conflict = "Existing Medicare Beneficiary Identifier is invalid and requires review";
    }
    if (conflict) {
      review.push({ sourcePatientId: bhwPatientId, coverageOrder: "multiple", reason: conflict });
      continue;
    }
    const slots = coverageSlotsForPatient(group.patient);
    for (const [order, row] of byOrder) slots[order] = mergeCoverage(slots[order], row.coverageRecord);
    const mbi = importedMbi || medicareMbiForPatient(group.patient);
    const insurance = insuranceStorageForPatient(group.patient, slots, mbi);
    const patient = { ...group.patient, ...insurance };
    const update = {
      bhwPatientId,
      patient,
      coverageOrders: [...byOrder.keys()],
      payerNames: [...byOrder.values()].map((row) => row.coverageRecord.payerName),
      importsMbi: Boolean(importedMbi),
      expectedUpdatedAt: clean(group.patient.updatedAt),
    };
    if (insuranceSignature(group.patient) === insuranceSignature(patient)) unchanged.push(update);
    else updates.push(update);
  }

  return {
    updates,
    unchanged,
    review,
    summary: {
      sourceRows: reportRows.length,
      updatePatients: updates.length,
      updateCoverageRows: updates.reduce((total, update) => total + update.coverageOrders.length, 0),
      unchangedPatients: unchanged.length,
      reviewRows: review.length,
      importedMbiPatients: updates.filter((update) => update.importsMbi).length,
    },
  };
}

export function insuranceUpdateMatches(savedPatient, intendedPatient) {
  return insuranceSignature(savedPatient) === insuranceSignature(intendedPatient);
}
