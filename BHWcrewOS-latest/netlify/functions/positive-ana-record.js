// Protected BHW Cloud persistence for the CrewOS Positive ANA decision-support
// worksheet. The browser may select only a Patient Registry record; this
// endpoint independently validates the BHW ID, bounds every field, and verifies
// the exact saved record through a Cloud read-back before reporting success.

const crypto = require("crypto");
const { getSession, json } = require("./_lib");
const { cloudRequest, findCloudPatient } = require("./lib/cloud-patients");

const SCREENING_ID = "positive-ana-clinician-analysis";
const SCHEMA_VERSION = "positive-ana-v3";
const SUPPLEMENTAL_GUIDE_TITLE = "Insider’s Guide to Supporting Optimal Immune Function";
const SUPPLEMENTAL_GUIDE_LAB_KEYS = new Set(["zincLow", "copperLow", "seleniumLow", "vitALow", "vitB6Low", "vitCLow", "vitELow"]);
const SUPPLEMENTAL_GUIDE_HISTORY_GROUP = "Supportive Context / Exposures";

function text(value, limit = 200) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function patientId(value) {
  const id = text(value, 16).toUpperCase();
  if (!/^BHW\d{4}$/.test(id) || id === "BHW0000") {
    throw Object.assign(new Error("Choose a verified patient from the BHW Patient Registry"), { status: 400 });
  }
  return id;
}

function recordId(value) {
  const id = text(value, 100);
  if (!/^positive-ana-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw Object.assign(new Error("A valid retry-safe analysis record ID is required"), { status: 400 });
  }
  return id;
}

function list(value, limit, mapper) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map(mapper).filter(Boolean);
}

function keyedFinding(value) {
  const key = text(value?.key, 80);
  const label = text(value?.label, 240);
  return key && label ? { key, label } : null;
}

function isoDate(value) {
  const raw = text(value, 80);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizedToken(value) {
  return text(value, 240).toLowerCase().replace(/\s+/g, " ").trim();
}

function findingKey(item) {
  return normalizedToken(item?.key || item?.label);
}

function measurementKey(item) {
  return `${findingKey(item)}::${normalizedToken(item?.subject)}`;
}

function uniqueLabels(items) {
  const seen = new Set();
  return (items || []).map((item) => text(item?.label || item, 240)).filter((label) => {
    const key = normalizedToken(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareSnapshot(currentItems, priorItems, priorRecord, kind) {
  const currentLabels = uniqueLabels(currentItems);
  const priorLabels = uniqueLabels(priorItems);
  const currentKeys = new Map(currentLabels.map((label) => [normalizedToken(label), label]));
  const priorKeys = new Map(priorLabels.map((label) => [normalizedToken(label), label]));
  return {
    baselineResponseId: text(priorRecord?.responseId, 100),
    baselineReviewedAt: isoDate(priorRecord?.submittedAt),
    continuing: currentLabels.filter((label) => priorKeys.has(normalizedToken(label))),
    currentOnly: currentLabels.filter((label) => !priorKeys.has(normalizedToken(label))),
    previousOnly: priorLabels.filter((label) => !currentKeys.has(normalizedToken(label))),
    note: kind === "symptoms"
      ? "Selection differences describe what was recorded in each review; they do not establish symptom onset or resolution."
      : "Selection differences describe recorded findings; an item not selected in the current review is not interpreted as a negative or resolved result.",
  };
}

function compareMeasurement(current, previous, previousRecord) {
  if (!previous) {
    return { comparability: "no-prior-match", comparison: "No matching measurement was recorded in the available prior reviews." };
  }
  const currentUnit = normalizedToken(current.unit);
  const previousUnit = normalizedToken(previous.unit);
  const currentMethod = normalizedToken(current.method);
  const previousMethod = normalizedToken(previous.method);
  const currentRange = normalizedToken(current.referenceRange);
  const previousRange = normalizedToken(previous.referenceRange);
  const currentDate = isoDate(current.collectedOn);
  const previousDate = isoDate(previous.collectedOn);
  const previousWhen = previousDate || isoDate(previousRecord?.submittedAt);
  if (!currentUnit || !previousUnit || currentUnit !== previousUnit) {
    return { comparability: "not-comparable", comparison: `Units are not comparable (${previous.unit || "not recorded"} versus ${current.unit || "not recorded"}); no numeric change was calculated.` };
  }
  if (currentMethod && previousMethod && currentMethod !== previousMethod) {
    return { comparability: "not-comparable", comparison: `Assay/method differs (${previous.method} versus ${current.method}); no numeric change was calculated.` };
  }
  if (currentRange && previousRange && currentRange !== previousRange) {
    return { comparability: "not-comparable", comparison: `Reference intervals differ (${previous.referenceRange} versus ${current.referenceRange}); no numeric change was calculated.` };
  }
  const delta = Number((current.value - previous.value).toPrecision(12));
  const direction = delta === 0 ? "unchanged" : delta > 0 ? "higher" : "lower";
  const fullyComparable = Boolean(currentMethod && previousMethod && currentDate && previousDate);
  const qualifier = fullyComparable
    ? "The recorded unit, assay/method, and specimen dates match the available comparison fields."
    : "This numeric difference is descriptive only because assay/method or specimen date was not recorded for both results.";
  return {
    comparability: fullyComparable ? "comparable" : "limited",
    delta,
    comparison: `Current value is ${direction} by ${Math.abs(delta)} ${current.unit} versus the prior value recorded ${previousWhen || "at the prior review"}. ${qualifier}`,
  };
}

function buildLongitudinalComparison(analysis, priorRecords, generatedAt = new Date().toISOString()) {
  const prior = (Array.isArray(priorRecords) ? priorRecords : [])
    .filter((record) => record?.responseId && record?.analysis)
    .sort((left, right) => String(right.submittedAt || "").localeCompare(String(left.submittedAt || "")))
    .slice(0, 25);
  const patternHistory = new Map();
  const measurementHistory = new Map();
  for (const record of prior) {
    for (const pattern of record.analysis.anaPatterns || []) {
      const key = normalizedToken(pattern.code || pattern.label);
      if (!patternHistory.has(key)) patternHistory.set(key, []);
      patternHistory.get(key).push({ responseId: record.responseId, reviewedAt: isoDate(record.submittedAt), code: pattern.code, label: pattern.label, titer: pattern.titer });
    }
    for (const measurement of record.analysis.measurements || []) {
      const key = measurementKey(measurement);
      if (!measurementHistory.has(key)) measurementHistory.set(key, []);
      measurementHistory.get(key).push({
        responseId: record.responseId,
        reviewedAt: isoDate(record.submittedAt),
        key: measurement.key,
        label: measurement.label,
        subject: measurement.subject || "",
        value: measurement.value,
        unit: measurement.unit || "",
        method: measurement.method || "",
        referenceRange: measurement.referenceRange || "",
        collectedOn: measurement.collectedOn || "",
      });
    }
  }

  const patternKeys = new Set((analysis.anaPatterns || []).map((item) => normalizedToken(item.code || item.label)));
  const patterns = (analysis.anaPatterns || []).map((current) => {
    const history = patternHistory.get(normalizedToken(current.code || current.label)) || [];
    const previous = history[0];
    let comparison = "No matching pattern was recorded in the available prior reviews.";
    if (previous && Number.isFinite(current.titer) && Number.isFinite(previous.titer)) {
      const direction = current.titer === previous.titer ? "the same" : current.titer > previous.titer ? "a higher" : "a lower";
      comparison = `The current reported dilution endpoint is ${direction} value than the prior recorded endpoint. Serial ANA titer is generally not a disease-activity monitor, and assay comparability is not established here.`;
    } else if (previous) {
      comparison = "The same pattern was recorded previously, but one or both titers were not reported; no titer change was calculated.";
    }
    return { code: current.code, label: current.label, currentTiter: current.titer, currentPresent: true, history, comparability: previous ? "limited" : "no-prior-match", comparison };
  });
  for (const [key, history] of patternHistory) {
    if (!patternKeys.has(key)) patterns.push({ code: history[0].code, label: history[0].label, currentTiter: null, currentPresent: false, history, comparability: "not-entered-currently", comparison: "Previously recorded pattern was not entered in the current review; this does not establish disappearance or resolution." });
  }

  const currentMeasurementKeys = new Set((analysis.measurements || []).map(measurementKey));
  const measurements = (analysis.measurements || []).map((current) => {
    const history = measurementHistory.get(measurementKey(current)) || [];
    const previous = history[0];
    const result = compareMeasurement(current, previous, previous ? { submittedAt: previous.reviewedAt } : null);
    return { key: current.key, label: current.label, subject: current.subject || "", currentPresent: true, current: { value: current.value, unit: current.unit || "", method: current.method || "", referenceRange: current.referenceRange || "", collectedOn: current.collectedOn || "" }, history, ...result };
  });
  for (const [key, history] of measurementHistory) {
    if (!currentMeasurementKeys.has(key)) measurements.push({ key: history[0].key, label: history[0].label, subject: history[0].subject || "", currentPresent: false, current: null, history, comparability: "not-entered-currently", comparison: "A prior value exists but no matching current value was entered; no change was inferred." });
  }

  const latest = prior[0] || null;
  const foodMeasurements = (analysis.measurements || []).filter((item) => item.key === "foodIgGValue");
  const foodSymptoms = (analysis.symptoms || []).filter((item) => /GI|Skin|Allergy|Mast-cell|Neuro/i.test(item.group || "")).map((item) => item.label);
  return {
    generatedAt: isoDate(generatedAt),
    priorReviewCount: prior.length,
    provenance: prior.map((record) => ({ responseId: text(record.responseId, 100), reviewedAt: isoDate(record.submittedAt) })),
    patterns,
    measurements,
    antibodies: compareSnapshot(analysis.antibodies, latest?.analysis?.antibodies, latest, "findings"),
    labs: compareSnapshot(analysis.labs, latest?.analysis?.labs, latest, "findings"),
    symptoms: compareSnapshot(analysis.symptoms, latest?.analysis?.symptoms, latest, "symptoms"),
    foodContext: foodMeasurements.map((item) => ({
      subject: item.subject || "",
      value: item.value,
      unit: item.unit || "",
      coRecordedSymptoms: foodSymptoms,
      relationship: "The food IgG result and these symptoms were recorded in the same review; timing and causality are not established.",
      sourceSupportedUse: "This may be retained as one hypothesis-generating exposure signal. If clinically appropriate and safe, a clinician may define a time-limited, nutritionally adequate elimination with planned rechallenge and prespecified endpoints.",
      missingContext: [
        item.subject ? "" : "Food/analyte was not recorded.",
        item.method ? "" : "Assay/method was not recorded.",
        item.referenceRange ? "" : "Reference interval was not recorded.",
      ].filter(Boolean),
    })),
    interpretationBoundaries: [
      "ANA is a gateway test, not a diagnosis; titer and pattern require a compatible phenotype and targeted tissue/organ assessment.",
      "The supplied Field Guide and Version 2 framework do not provide AC-specific ICAP pattern-to-disease associations, so none were inferred.",
      "Food IgG does not diagnose food allergy or intolerance and must not be used to estimate anaphylaxis risk.",
      "Longitudinal differences are factual comparisons of recorded reviews, not diagnoses or disease-activity scores.",
    ],
  };
}

function stringList(value, limit = 100) {
  return list(value, limit, (item) => text(item, 500)).filter(Boolean);
}

function normalizeSnapshot(value = {}, kind = "findings") {
  return {
    baselineResponseId: text(value.baselineResponseId, 100),
    baselineReviewedAt: isoDate(value.baselineReviewedAt),
    continuing: stringList(value.continuing, 240),
    currentOnly: stringList(value.currentOnly, 240),
    previousOnly: stringList(value.previousOnly, 240),
    note: text(value.note, 500) || (kind === "symptoms"
      ? "Selection differences do not establish symptom onset or resolution."
      : "Selection differences do not establish a negative or resolved result."),
  };
}

function normalizeLongitudinalComparison(value = {}) {
  const historyItem = (item) => {
    const responseId = text(item?.responseId, 100);
    if (!responseId) return null;
    const rawTiter = item?.titer;
    const titer = rawTiter === null || rawTiter === undefined || rawTiter === "" ? null : Number(rawTiter);
    const rawValue = item?.value;
    const number = rawValue === null || rawValue === undefined || rawValue === "" ? null : Number(rawValue);
    return {
      responseId,
      reviewedAt: isoDate(item?.reviewedAt),
      code: text(item?.code, 32),
      label: text(item?.label, 180),
      titer: Number.isFinite(titer) ? titer : null,
      key: text(item?.key, 80),
      subject: text(item?.subject, 160),
      value: Number.isFinite(number) ? number : null,
      unit: text(item?.unit, 80),
      method: text(item?.method, 160),
      referenceRange: text(item?.referenceRange, 160),
      collectedOn: isoDate(item?.collectedOn),
    };
  };
  const currentMeasurement = (item) => {
    if (!item || typeof item !== "object") return null;
    const number = Number(item.value);
    if (!Number.isFinite(number)) return null;
    return { value: number, unit: text(item.unit, 80), method: text(item.method, 160), referenceRange: text(item.referenceRange, 160), collectedOn: isoDate(item.collectedOn) };
  };
  return {
    generatedAt: isoDate(value.generatedAt),
    priorReviewCount: Math.max(0, Math.min(25, Number(value.priorReviewCount) || 0)),
    provenance: list(value.provenance, 25, (item) => {
      const responseId = text(item?.responseId, 100);
      return responseId ? { responseId, reviewedAt: isoDate(item?.reviewedAt) } : null;
    }),
    patterns: list(value.patterns, 40, (item) => {
      const label = text(item?.label, 180);
      if (!label) return null;
      const rawTiter = item?.currentTiter;
      const currentTiter = rawTiter === null || rawTiter === undefined || rawTiter === "" ? null : Number(rawTiter);
      return { code: text(item?.code, 32), label, currentTiter: Number.isFinite(currentTiter) ? currentTiter : null, currentPresent: item?.currentPresent === true, history: list(item?.history, 25, historyItem), comparability: text(item?.comparability, 40), comparison: text(item?.comparison, 700) };
    }),
    measurements: list(value.measurements, 60, (item) => {
      const key = text(item?.key, 80);
      const label = text(item?.label, 180);
      if (!key || !label) return null;
      const deltaValue = item?.delta;
      const delta = deltaValue === null || deltaValue === undefined || deltaValue === "" ? null : Number(deltaValue);
      return { key, label, subject: text(item?.subject, 160), currentPresent: item?.currentPresent === true, current: currentMeasurement(item?.current), history: list(item?.history, 25, historyItem), comparability: text(item?.comparability, 40), delta: Number.isFinite(delta) ? delta : null, comparison: text(item?.comparison, 700) };
    }),
    antibodies: normalizeSnapshot(value.antibodies, "findings"),
    labs: normalizeSnapshot(value.labs, "findings"),
    symptoms: normalizeSnapshot(value.symptoms, "symptoms"),
    foodContext: list(value.foodContext, 20, (item) => {
      const number = Number(item?.value);
      if (!Number.isFinite(number)) return null;
      return { subject: text(item?.subject, 160), value: number, unit: text(item?.unit, 80), coRecordedSymptoms: stringList(item?.coRecordedSymptoms, 100), relationship: text(item?.relationship, 500), sourceSupportedUse: text(item?.sourceSupportedUse, 700), missingContext: stringList(item?.missingContext, 20) };
    }),
    interpretationBoundaries: stringList(value.interpretationBoundaries, 20),
  };
}

function normalizeAnalysis(value = {}) {
  const anaPatterns = list(value.anaPatterns, 12, (item) => {
    const code = text(item?.code, 32);
    const label = text(item?.label, 180);
    const rawTiter = item?.titer;
    const titer = rawTiter === null || rawTiter === "" || rawTiter === undefined ? null : Number(rawTiter);
    if (!label || (titer !== null && (!Number.isFinite(titer) || titer < 0 || titer > 100000))) return null;
    return { code, label, titer };
  });
  const measurements = list(value.measurements, 20, (item) => {
    const key = text(item?.key, 80);
    const label = text(item?.label, 180);
    const unit = text(item?.unit, 80);
    const number = Number(item?.value);
    if (!key || !label || !Number.isFinite(number) || number < 0 || number > 1e9) return null;
    return {
      key,
      label,
      subject: text(item?.subject, 160),
      value: number,
      unit,
      method: text(item?.method, 160),
      referenceRange: text(item?.referenceRange, 160),
      collectedOn: isoDate(item?.collectedOn),
      contextual: item?.contextual === true,
    };
  });
  const symptoms = list(value.symptoms, 240, (item) => {
    const label = text(item?.label, 240);
    const group = text(item?.group, 120);
    return label && group ? { label, group } : null;
  });
  const sex = ["", "Female", "Male"].includes(value.sex) ? value.sex : "";
  const cascade = ["", "pos", "neg"].includes(value.cascade) ? value.cascade : "";
  const reviewValue = value.review && typeof value.review === "object" ? value.review : {};
  const sourceSupportedContext = list(reviewValue.sourceSupportedContext, 20, (item) => text(item, 500)).filter(Boolean);
  const supplementalGuideUsed = list(value.labs, 220, keyedFinding).some((item) => SUPPLEMENTAL_GUIDE_LAB_KEYS.has(item.key))
    || symptoms.some((item) => item.group === SUPPLEMENTAL_GUIDE_HISTORY_GROUP);
  if (measurements.some((item) => item.key === "foodIgGValue") && !sourceSupportedContext.some((item) => /food-specific IgG/i.test(item))) {
    sourceSupportedContext.push("Food-specific IgG may represent exposure/recognition, relative immune response, barrier context, or a candidate trigger pattern. It does not diagnose food allergy or intolerance.");
  }
  if (anaPatterns.length && !sourceSupportedContext.some((item) => /ANA is a gateway test/i.test(item))) sourceSupportedContext.push("ANA is a gateway test, not a diagnosis. Pattern and titer require a compatible phenotype and targeted tissue or organ assessment.");
  if (supplementalGuideUsed && !sourceSupportedContext.some((item) => item.includes(SUPPLEMENTAL_GUIDE_TITLE))) {
    sourceSupportedContext.push(`${SUPPLEMENTAL_GUIDE_TITLE} (2022, p. 1; pp. 5–25) supplies attributed lifestyle, exposure, nutrition, and deficiency context plus clinician source navigation. These observations are not diagnostic criteria and do not generate an immune-enhancement protocol or automatic treatment.`);
  }
  const sourceReferences = list(reviewValue.sourceReferences, 10, (item) => {
    const title = text(item?.title, 240);
    if (!title) return null;
    return { title, author: text(item?.author, 160), year: text(item?.year, 20), pages: text(item?.pages, 120), role: text(item?.role, 500) };
  });
  if (supplementalGuideUsed && !sourceReferences.some((item) => item.title === SUPPLEMENTAL_GUIDE_TITLE)) {
    sourceReferences.push({ title: SUPPLEMENTAL_GUIDE_TITLE, author: "Dicken Weatherby, N.D.", year: "2022", pages: "p. 1; pp. 5–25", role: "Supplemental practitioner guide; attributed context and clinician source navigation only, not validated diagnostic criteria or an automatic treatment protocol." });
  }
  const uncertainty = list(reviewValue.uncertainty, 20, (item) => text(item, 500)).filter(Boolean);
  if (!uncertainty.length) {
    uncertainty.push(
      "No condition ranking, score, hidden ordering, or automated diagnosis was generated.",
      "Interpret results with assay details, timing, medications, objective organ findings, and validated clinical criteria.",
    );
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    analysisMode: "non-ranking-clinician-review",
    anaPatterns,
    sex,
    cascade,
    antibodies: list(value.antibodies, 160, keyedFinding),
    medications: list(value.medications, 60, keyedFinding),
    labs: list(value.labs, 220, keyedFinding),
    measurements,
    symptoms,
    patientResponseIds: list(value.patientResponseIds, 20, (item) => text(item, 120)).filter(Boolean),
    priorAnalysisIds: list(value.priorAnalysisIds, 25, (item) => text(item, 120)).filter(Boolean),
    redFlags: list(value.redFlags, 80, (item) => text(item, 240)).filter(Boolean),
    review: {
      clinicianReviewRequired: true,
      sourceSupportedContext,
      uncertainty,
      sourceReferences,
      sourceGaps: stringList(reviewValue.sourceGaps, 20),
    },
    longitudinalComparison: normalizeLongitudinalComparison(value.longitudinalComparison),
    legacyRankingOmitted: (Array.isArray(value.differential) && value.differential.length > 0)
      || (Array.isArray(value.sharedWorkup) && value.sharedWorkup.length > 0),
  };
}

function transcript(analysis) {
  const patterns = analysis.anaPatterns.map((item) => {
    const titer = item.titer === null ? "titer not reported" : item.titer === 0 ? "below cutoff" : `1:${item.titer}`;
    return `${item.label} (${titer})`;
  });
  return [
    "Positive ANA clinician decision-support worksheet",
    `ANA patterns: ${patterns.join("; ") || "not entered"}`,
    `Antibodies: ${analysis.antibodies.map((item) => item.label).join(", ") || "none selected"}`,
    `Non-antibody findings: ${analysis.labs.map((item) => item.label).join(", ") || "none selected"}`,
    `Numeric values: ${analysis.measurements.map((item) => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`).join("; ") || "none entered"}`,
    `Symptoms/history: ${analysis.symptoms.map((item) => item.label).join(", ") || "none selected"}`,
    analysis.patientResponseIds.length ? `Imported patient Step 5 response(s): ${analysis.patientResponseIds.join(", ")}` : "",
    analysis.priorAnalysisIds.length ? `Prior patient-linked Positive ANA review(s) considered: ${analysis.priorAnalysisIds.join(", ")}` : "",
    analysis.longitudinalComparison.priorReviewCount ? `Longitudinal comparison: ${analysis.longitudinalComparison.priorReviewCount} exact-patient prior review(s).` : "Longitudinal comparison: no prior exact-patient Positive ANA review available.",
    ...analysis.longitudinalComparison.patterns.slice(0, 12).map((item) => `ANA comparison — ${item.label}: ${item.comparison}`),
    ...analysis.longitudinalComparison.measurements.slice(0, 20).map((item) => `Measurement comparison — ${item.subject ? `${item.subject} / ` : ""}${item.label}: ${item.comparison}`),
    analysis.longitudinalComparison.symptoms.baselineResponseId ? `Symptom selections versus ${analysis.longitudinalComparison.symptoms.baselineReviewedAt || "prior review"}: continuing ${analysis.longitudinalComparison.symptoms.continuing.join(", ") || "none"}; current-only ${analysis.longitudinalComparison.symptoms.currentOnly.join(", ") || "none"}; prior-only ${analysis.longitudinalComparison.symptoms.previousOnly.join(", ") || "none"}. ${analysis.longitudinalComparison.symptoms.note}` : "",
    analysis.redFlags.length ? `Priority flags: ${analysis.redFlags.join(", ")}` : "",
    "Interpretive mode: non-ranking clinician review; no score, confidence label, hidden ordering, or automated diagnosis was generated.",
    analysis.review.sourceSupportedContext.length ? `Source-supported context: ${analysis.review.sourceSupportedContext.join(" ")}` : "",
    analysis.review.sourceReferences.length ? `Source references: ${analysis.review.sourceReferences.map((item) => `${item.title}${item.author ? ` — ${item.author}` : ""}${item.year ? ` (${item.year})` : ""}${item.pages ? `, ${item.pages}` : ""}`).join("; ")}` : "",
    analysis.review.uncertainty.length ? `Uncertainty: ${analysis.review.uncertainty.join(" ")}` : "",
    "Clinician review is required; correlate with assay details, timing, examination, objective organ findings, and validated criteria.",
  ].filter(Boolean).join("\n").slice(0, 16000);
}

function savedRecord(result, id, bhwPatientId) {
  return (result.responses || []).find((item) => item.responseId === id && item.bhwPatientId === bhwPatientId && item.screeningId === SCREENING_ID);
}

function clinicianAnalysisRecord(item) {
  if (!item || item.screeningId !== SCREENING_ID) return null;
  const responseId = text(item.responseId, 100);
  if (!responseId) return null;
  return {
    responseId,
    screeningId: SCREENING_ID,
    submittedAt: text(item.submittedAt || item.createdAt, 80),
    respondent: text(item.respondent, 160),
    analysis: normalizeAnalysis(item.answers || {}),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Signed out — sign in to CrewOS again." });
  if (Buffer.byteLength(event.body || "", "utf8") > 160000) return json(413, { ok: false, error: "Analysis record is too large" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Bad JSON" }); }

  try {
    const bhwPatientId = patientId(body.bhwPatientId);
    const verifiedPatient = await findCloudPatient(bhwPatientId, session);
    if (!verifiedPatient || verifiedPatient.selectable === false || ["deceased", "transferred"].includes(String(verifiedPatient.patientStatus || "").toLowerCase())) {
      return json(404, { ok: false, saved: false, destination: "BHW Cloud", error: "Patient was not found as an active record in the BHW Patient Registry" });
    }
    const action = text(body.action || "save", 20).toLowerCase();
    if (action === "list") {
      const result = await cloudRequest("/v1/questionnaire-responses", { actor: session });
      const analyses = (result.responses || [])
        .filter((item) => item.bhwPatientId === bhwPatientId && item.screeningId === SCREENING_ID)
        .map(clinicianAnalysisRecord).filter(Boolean)
        .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
        .slice(0, 25);
      return json(200, { ok: true, bhwPatientId, screeningId: SCREENING_ID, analyses });
    }
    if (action !== "save") return json(400, { ok: false, error: "Unsupported Positive ANA record action" });
    const analysis = normalizeAnalysis(body.analysis);
    if (!analysis.anaPatterns.length && !analysis.antibodies.length && !analysis.labs.length
        && !analysis.measurements.length && !analysis.symptoms.length) {
      return json(400, { ok: false, error: "Create the clinical review and enter at least one finding before saving" });
    }
    const responseId = recordId(body.responseId || `positive-ana-${crypto.randomUUID()}`);
    const historyResult = await cloudRequest("/v1/questionnaire-responses", { actor: session });
    const priorRecords = (historyResult.responses || [])
      .filter((item) => item.responseId !== responseId && item.bhwPatientId === bhwPatientId && item.screeningId === SCREENING_ID)
      .map(clinicianAnalysisRecord).filter(Boolean)
      .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
      .slice(0, 25);
    analysis.priorAnalysisIds = priorRecords.map((item) => item.responseId);
    analysis.longitudinalComparison = buildLongitudinalComparison(analysis, priorRecords);
    analysis.review.sourceSupportedContext = analysis.review.sourceSupportedContext.filter((item) => !/prior patient-linked Positive ANA review/i.test(item));
    if (priorRecords.length) analysis.review.sourceSupportedContext.push(`${priorRecords.length} exact-patient prior Positive ANA review(s) were compared factually with the current observations.`);
    analysis.review.sourceGaps = analysis.review.sourceGaps.filter((item) => !/AC-specific ICAP/i.test(item));
    if (analysis.anaPatterns.length) analysis.review.sourceGaps.push("AC-specific ICAP pattern-to-disease associations are not provided in the supplied Field Guide or Version 2 framework; no such association was inferred.");
    const submittedAt = new Date().toISOString();
    await cloudRequest("/v1/questionnaire-responses", {
      actor: session,
      method: "POST",
      body: {
        responseId,
        sourceRecordId: responseId,
        bhwPatientId,
        assessmentId: "",
        screeningId: SCREENING_ID,
        screeningName: "Positive ANA clinician review",
        program: "Primary Care",
        responseKind: "questionnaire",
        respondent: text(session.name || session.staffId || "CrewOS clinician", 160),
        answers: analysis,
        transcript: transcript(analysis),
        flags: analysis.redFlags.join("; ").slice(0, 4000),
        submittedAt,
        sourceSystem: "CrewOS Positive ANA",
      },
    });

    const readback = await cloudRequest("/v1/questionnaire-responses", { actor: session });
    const stored = savedRecord(readback, responseId, bhwPatientId);
    if (!stored) throw Object.assign(new Error("The Cloud save could not be verified. Retry with the same analysis record."), { status: 502 });
    return json(200, {
      ok: true,
      saved: true,
      destination: "BHW Cloud",
      bhwPatientId,
      responseId,
      savedAt: stored.submittedAt || stored.createdAt || submittedAt,
      screeningId: SCREENING_ID,
    });
  } catch (error) {
    return json(Number(error.status) || 502, {
      ok: false,
      saved: false,
      destination: "BHW Cloud",
      error: String(error.message || error),
    });
  }
};

exports._test = { SCREENING_ID, SCHEMA_VERSION, normalizeAnalysis, buildLongitudinalComparison, transcript, savedRecord, clinicianAnalysisRecord, patientId, recordId };
