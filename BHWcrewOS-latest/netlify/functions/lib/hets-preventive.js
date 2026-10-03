// CMS HETS preventive/audiology normalization.
//
// A 271 can return many HCPCS rows for one clinical question. Those rows are
// payer benefit evidence, not independent clinical gaps. Keep the code-level
// evidence, but project it as one measure for CrewOS and Health Core review.

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const upper = (value) => clean(value, 80).toUpperCase();
const key = (value) => clean(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const AUDIOLOGY_CODES = Object.freeze([
  "92550", "92552", "92553", "92555", "92556", "92557", "92562", "92563", "92565",
  "92567", "92568", "92570", "92571", "92572", "92575", "92576", "92577", "92579",
  "92582", "92583", "92584", "92587", "92588", "92601", "92602", "92603", "92604",
  "92620", "92621", "92622", "92623", "92625", "92626", "92627", "92640", "92651",
  "92652", "92653",
]);

const catalog = [
  {
    measureId: "annual-wellness-visit",
    healthCoreMeasureId: "annual-wellness-visit",
    label: "Annual Wellness Visit",
    codes: ["G0438", "G0439"],
    aliases: ["awv", "annual wellness visit"],
    codeGuidance: "G0438 is the initial AWV; G0439 is a subsequent AWV. Confirm history before selecting the service.",
  },
  {
    measureId: "initial-preventive-physical-examination",
    healthCoreMeasureId: "initial-preventive-physical-examination",
    label: "Welcome to Medicare preventive visit",
    codes: ["G0402", "G0403", "G0404", "G0405"],
    aliases: ["ippe", "initial preventive physical examination"],
    codeGuidance: "G0402 is the IPPE visit. The ECG codes are optional components, not four separate overdue visits.",
  },
  {
    measureId: "hearing-audiology-assessment",
    healthCoreMeasureId: "hearing-audiology-assessment",
    label: "Hearing / audiology diagnostic benefit",
    codes: AUDIOLOGY_CODES,
    aliases: ["audiology", "auditory", "hearing screening", "audiology exam"],
    benefitOnly: true,
    codeGuidance: "These are alternate hearing and balance diagnostic tests. HETS eligibility does not choose a test or establish that screening is overdue; select a code only from the clinical indication and test actually ordered or performed.",
  },
  {
    measureId: "cervical-cancer-screening",
    healthCoreMeasureId: "cervical-cancer-screening",
    label: "Cervical cancer screening",
    codes: ["Q0091", "P3000", "G0123", "G0143", "G0144", "G0145", "G0147", "G0148", "G0476", "G0101"],
    aliases: ["pap", "pap test", "cervical cancer screening", "pelvic exam", "hpv"],
    codeGuidance: "The returned codes represent collection, laboratory methods, HPV testing, and pelvic/breast examination components. Choose only the service documented and performed.",
  },
  {
    measureId: "colorectal-cancer-screening",
    healthCoreMeasureId: "colorectal-cancer-screening",
    label: "Colorectal cancer screening",
    codes: ["0464U", "74263", "81528", "G0104", "G0105", "G0121", "G0327", "G0328", "82270"],
    aliases: ["colo", "colorectal cancer screening", "colorectal screening", "fobt"],
    codeGuidance: "These are different screening strategies and intervals, not duplicate gaps. Select the strategy with the patient; Health Core does not infer a modality from eligibility alone.",
  },
  {
    measureId: "bone-density-screening",
    healthCoreMeasureId: "bone-density-screening",
    label: "Bone density screening",
    codes: ["77078", "77080", "77081", "G0130", "76977"],
    aliases: ["bone density", "dxa", "osteoporosis screening"],
    codeGuidance: "The codes use different modalities and anatomic sites. The ordered/performed study controls code selection.",
  },
  {
    measureId: "cardiovascular-risk-screening",
    healthCoreMeasureId: "cardiovascular-risk-screening",
    label: "Cardiovascular risk screening",
    codes: ["80061", "82465", "83718", "84478", "G0446"],
    aliases: ["card", "cardiovascular disease screening", "cardiovascular screening"],
    codeGuidance: "Laboratory components and intensive behavioral therapy are distinct services. Use only the documented service.",
  },
  {
    measureId: "prediabetes-type2-screening",
    healthCoreMeasureId: "prediabetes-type2-screening",
    label: "Diabetes screening",
    codes: ["82947", "82950", "82951", "83036"],
    aliases: ["diab", "diabetes screening", "prediabetes screening"],
    codeGuidance: "The codes represent different glucose or A1c test methods; the ordered/performed test controls code selection.",
  },
  {
    measureId: "lung-cancer-screening",
    healthCoreMeasureId: "lung-cancer-screening",
    label: "Lung cancer screening",
    codes: ["71271"],
    aliases: ["lung cancer screening", "ldct"],
    codeGuidance: "Confirm age, tobacco exposure, symptoms, and shared decision-making before treating eligibility as a clinical gap.",
  },
  {
    measureId: "breast-cancer-screening",
    healthCoreMeasureId: "breast-cancer-screening",
    label: "Breast cancer screening",
    codes: ["77067"],
    aliases: ["mamm", "mammography", "breast cancer screening", "breast screening"],
  },
  {
    measureId: "abdominal-aortic-aneurysm-screening",
    healthCoreMeasureId: "abdominal-aortic-aneurysm-screening",
    label: "Abdominal aortic aneurysm screening",
    codes: ["76706"],
    aliases: ["aaa", "abdominal aortic aneurysm screening"],
  },
  {
    measureId: "depression-screening",
    healthCoreMeasureId: "depression-screening",
    label: "Depression screening",
    codes: ["G0444"],
    aliases: ["depression screening", "annual depression screening"],
  },
  {
    measureId: "alcohol-misuse-screening-counseling",
    healthCoreMeasureId: "alcohol-misuse-screening-counseling",
    label: "Alcohol misuse screening / counseling",
    codes: ["G0442", "G0443"],
    aliases: ["alcohol misuse", "alcohol screening"],
    codeGuidance: "Screening and counseling are separate services; do not present them as duplicate gaps.",
  },
  {
    measureId: "obesity-behavioral-counseling",
    healthCoreMeasureId: "obesity-behavioral-counseling",
    label: "Obesity behavioral counseling",
    codes: ["G0447", "G0473"],
    aliases: ["obesity counseling", "intensive behavioral counseling for obesity"],
  },
  {
    measureId: "sti-screening-counseling",
    healthCoreMeasureId: "sti-screening-counseling",
    label: "STI screening / counseling",
    codes: ["G0445"],
    aliases: ["sti", "sexually transmitted infection"],
  },
  {
    measureId: "prostate-cancer-screening",
    healthCoreMeasureId: "prostate-cancer-screening",
    label: "Prostate cancer screening",
    codes: ["G0102", "G0103"],
    aliases: ["pros", "prostate cancer screening"],
    codeGuidance: "Examination and PSA testing are different services. Shared decision-making and the service performed control selection.",
  },
  {
    measureId: "hepatitis-b-screening",
    healthCoreMeasureId: "hepatitis-b-screening",
    label: "Hepatitis B screening",
    codes: ["86704", "86706", "87340", "87341", "G0499"],
    aliases: ["hepatitis b", "hbv screening"],
  },
  {
    measureId: "hepatitis-c-screening",
    healthCoreMeasureId: "hepatitis-c-screening",
    label: "Hepatitis C screening",
    codes: ["G0472", "G0567"],
    aliases: ["hepatitis c", "hcv screening"],
  },
  {
    measureId: "hiv-prep-screening",
    healthCoreMeasureId: "hiv-prep-screening",
    label: "HIV / PrEP screening",
    codes: ["80081", "G0011", "G0013", "G0432", "G0433", "G0435", "G0475"],
    aliases: ["hiv", "prep", "hiv screening"],
  },
  {
    measureId: "pneumococcal-vaccination",
    healthCoreMeasureId: "pneumococcal-vaccination",
    label: "Pneumococcal vaccination",
    codes: ["90670", "90671", "90677", "90684", "90732"],
    aliases: ["ppv", "pneumococcal vaccine", "pneumococcal vaccination"],
  },
];

const HETS_MEASURE_CATALOG = Object.freeze(catalog.map((item) => Object.freeze({
  ...item,
  codes: Object.freeze(item.codes),
  aliases: Object.freeze(item.aliases || []),
})));

const byCode = new Map(HETS_MEASURE_CATALOG.flatMap((measure) => measure.codes.map((code) => [code, measure])));

function measureFor(item = {}) {
  const code = upper(item.hcpcs || item.code);
  if (byCode.has(code)) return byCode.get(code);
  const text = key([item.label, item.info, item.state].filter(Boolean).join(" "));
  return HETS_MEASURE_CATALOG.find((measure) => measure.aliases.some((alias) => text.includes(key(alias)))) || null;
}

function detailFor(item = {}, sourceKind) {
  const code = upper(item.hcpcs || item.code);
  const dates = Array.isArray(item.dates) ? item.dates.slice(0, 40).map((date) => ({
    kind: clean(date?.kind, 80),
    date: clean(date?.date, 10),
  })).filter((date) => date.date) : [];
  const eligibilityDates = [
    ...dates.map((date) => date.date),
    clean(item.eligibleProf, 10),
    clean(item.eligibleTech, 10),
  ].filter(Boolean);
  return {
    code,
    info: clean(item.info || item.label, 300),
    state: clean(item.state, 80),
    sourceKind,
    open: item.open === true,
    dates,
    eligibleProf: clean(item.eligibleProf, 10),
    eligibleTech: clean(item.eligibleTech, 10),
    eligibilityDates: [...new Set(eligibilityDates)].sort(),
  };
}

function stateFor(measure, details, hasReviewedGap) {
  if (measure.benefitOnly) return "Benefit available — clinical review needed";
  if (hasReviewedGap) {
    return details.find((detail) => detail.sourceKind === "reviewed-gap" && detail.state)?.state || "Open";
  }
  return "HETS benefit evidence — not a clinical gap";
}

function normalizeHetsMeasures({ preventiveGaps = [], preventiveServices = [] } = {}) {
  const groups = new Map();
  const add = (item, sourceKind, index) => {
    const measure = measureFor(item);
    const unknownCode = upper(item.hcpcs || item.code) || `ROW-${index + 1}`;
    const groupId = measure?.measureId || `unmapped-${key(item.label || unknownCode).replace(/ /g, "-") || unknownCode}`;
    if (!groups.has(groupId)) groups.set(groupId, { measure, details: [] });
    groups.get(groupId).details.push(detailFor(item, sourceKind));
  };
  (Array.isArray(preventiveGaps) ? preventiveGaps : []).forEach((item, index) => add(item, "reviewed-gap", index));
  (Array.isArray(preventiveServices) ? preventiveServices : []).forEach((item, index) => add(item, "hets-benefit", index));

  return [...groups.entries()].map(([groupId, group]) => {
    const measure = group.measure;
    const deduped = [...new Map(group.details.map((detail) => [
      [detail.code, detail.sourceKind, detail.eligibleProf, detail.eligibleTech, JSON.stringify(detail.dates)].join("|"),
      detail,
    ])).values()];
    const hasReviewedGap = !measure?.benefitOnly && deduped.some((detail) => detail.sourceKind === "reviewed-gap" && detail.open);
    const sourceCodes = [...new Set(deduped.map((detail) => detail.code).filter(Boolean))].sort();
    const hetsSourceCodes = [...new Set(deduped.filter((detail) => detail.sourceKind === "hets-benefit")
      .map((detail) => detail.code).filter(Boolean))].sort();
    const payerGapCodes = [...new Set(deduped.filter((detail) => detail.sourceKind === "reviewed-gap")
      .map((detail) => detail.code).filter(Boolean))].sort();
    const eligibilityDates = [...new Set(deduped.flatMap((detail) => detail.eligibilityDates))].sort();
    const label = measure?.label || clean(deduped.find((detail) => detail.info)?.info || groupId, 160);
    return {
      code: measure?.measureId || sourceCodes[0] || groupId,
      measureId: measure?.measureId || groupId,
      healthCoreMeasureId: hetsSourceCodes.length ? measure?.healthCoreMeasureId || "" : "",
      label,
      hcpcs: sourceCodes.length === 1 ? sourceCodes[0] : "",
      sourceCodes,
      hetsSourceCodes,
      payerGapCodes,
      codeCount: sourceCodes.length,
      codeDetails: deduped,
      codeGuidance: measure?.codeGuidance || "Confirm the clinical service and documentation before selecting a billing code.",
      state: stateFor(measure || {}, deduped, hasReviewedGap),
      open: hasReviewedGap,
      clinicalStatus: hasReviewedGap ? "open" : "needs-review",
      benefitEvidenceOnly: !hasReviewedGap,
      payerEligibilityDates: eligibilityDates,
      source: deduped.some((detail) => detail.sourceKind === "hets-benefit") ? "CMS HETS via Stedi" : "Reviewed payer gap",
      providerReviewRequired: true,
      automaticChartUpdateAllowed: false,
    };
  }).sort((a, b) => Number(b.open) - Number(a.open) || a.label.localeCompare(b.label));
}

const HETS_MEDICARE_SERVICE_BUNDLE = Object.freeze([
  Object.freeze({ system: "STC", value: "30" }),
  Object.freeze({ system: "STC", value: "BZ" }),
  Object.freeze({ system: "STC", value: "71" }),
  Object.freeze({ system: "STC", value: "BT" }),
  ...Object.freeze([...new Set(HETS_MEASURE_CATALOG
    .filter((measure) => !["annual-wellness-visit", "hearing-audiology-assessment", "cervical-cancer-screening"].includes(measure.measureId))
    .flatMap((measure) => measure.codes))]
    .map((value) => Object.freeze({ system: "HCPCS", value }))),
]);

module.exports = {
  AUDIOLOGY_CODES,
  HETS_MEASURE_CATALOG,
  HETS_MEDICARE_SERVICE_BUNDLE,
  normalizeHetsMeasures,
};
