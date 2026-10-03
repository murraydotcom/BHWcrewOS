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
  {
    measureId: "tobacco-cessation-counseling",
    healthCoreMeasureId: "tobacco-cessation-counseling",
    label: "Tobacco-use cessation counseling",
    codes: ["STC:67"],
    aliases: ["smoking cessation", "tobacco cessation", "tobacco counseling"],
    codeGuidance: "HETS reports remaining counseling sessions and recent use. It does not establish tobacco use or create a counseling plan.",
  },
  {
    measureId: "medicare-diabetes-prevention-program",
    healthCoreMeasureId: "medicare-diabetes-prevention-program",
    label: "Medicare Diabetes Prevention Program",
    codes: ["STC:CQ"],
    aliases: ["mdpp", "medicare diabetes prevention program"],
    codeGuidance: "HETS may return MDPP entitlement and session information. Confirm qualifying clinical data and supplier requirements separately.",
  },
  {
    measureId: "covid-19-vaccination",
    healthCoreMeasureId: "covid-19-vaccination",
    label: "COVID-19 vaccination",
    codes: ["STC:80"],
    aliases: ["covid vaccination", "covid-19 vaccine"],
    codeGuidance: "HETS may return plan-level eligibility and prior vaccination history. Reconcile the actual product and dose history before acting.",
  },
  {
    measureId: "influenza-vaccination",
    healthCoreMeasureId: "influenza-vaccination",
    label: "Influenza vaccination",
    codes: ["STC:CO"],
    aliases: ["flu vaccination", "influenza vaccine", "flu shot"],
    codeGuidance: "HETS may return plan-level eligibility and prior influenza vaccination history. Reconcile the current season and documented dose.",
  },
  {
    measureId: "cognitive-assessment-care-plan",
    healthCoreMeasureId: "cognitive-assessment-care-plan",
    label: "Cognitive assessment and care plan service",
    codes: ["STC:BD"],
    aliases: ["cognitive assessment", "cognitive care plan", "99483"],
    benefitOnly: true,
    codeGuidance: "HETS may return prior 99483 history. This is not a universal screening gap and requires a clinically indicated cognitive assessment pathway.",
  },
  {
    measureId: "diabetes-self-management-training",
    healthCoreMeasureId: "diabetes-self-management-training",
    label: "Diabetes self-management training",
    codes: [],
    aliases: ["dsmt", "diabetes self-management training"],
    codeGuidance: "Reconcile qualifying diagnosis, referral/order, prior utilization, and accredited-program documentation outside the HETS preventive-code response.",
  },
  {
    measureId: "glaucoma-screening",
    healthCoreMeasureId: "glaucoma-screening",
    label: "Glaucoma screening",
    codes: [],
    aliases: ["glaucoma screening"],
    codeGuidance: "Use clinical and claims history to confirm risk eligibility and the screening performed; absence from HETS is not proof the service is due.",
  },
  {
    measureId: "hepatitis-b-vaccination",
    healthCoreMeasureId: "hepatitis-b-vaccination",
    label: "Hepatitis B vaccination",
    codes: [],
    aliases: ["hepatitis b vaccination", "hepatitis b shot"],
    codeGuidance: "Reconcile risk, serology when relevant, vaccine product, and dose series from clinical and immunization history.",
  },
  {
    measureId: "prolonged-preventive-services",
    healthCoreMeasureId: "prolonged-preventive-services",
    label: "Prolonged preventive services",
    codes: [],
    aliases: ["prolonged preventive services"],
    benefitOnly: true,
    codeGuidance: "This is an add-on service, not a standalone care gap. Confirm the associated preventive service, time, and documentation.",
  },
  {
    measureId: "medical-nutrition-therapy",
    healthCoreMeasureId: "medical-nutrition-therapy",
    label: "Medical nutrition therapy",
    codes: [],
    aliases: ["mnt", "medical nutrition therapy"],
    codeGuidance: "Confirm a covered condition, referral/order, qualified practitioner, and prior utilization. Do not substitute general coaching for Medicare MNT.",
  },
  {
    measureId: "in-home-vaccine-administration",
    healthCoreMeasureId: "in-home-vaccine-administration",
    label: "In-home vaccine administration",
    codes: [],
    aliases: ["in-home vaccine administration", "home vaccine administration"],
    benefitOnly: true,
    codeGuidance: "This is an administration setting benefit, not a separate vaccination need. Link it only to the vaccine actually indicated and administered.",
  },
  {
    measureId: "part-d-vaccination-review",
    healthCoreMeasureId: "part-d-vaccination-review",
    label: "Medicare Part D vaccination review",
    codes: [],
    aliases: ["part d vaccines", "part d vaccination"],
    benefitOnly: true,
    codeGuidance: "Reconcile the patient-specific vaccine need and Part D coverage; HETS Part D enrollment is not vaccine history or a clinical due determination.",
  },
];

const CMS_SERVICE_NAMES_BY_MEASURE = Object.freeze({
  "annual-wellness-visit": ["Annual wellness visits"],
  "initial-preventive-physical-examination": ["Initial preventive physical exam"],
  "cervical-cancer-screening": ["Cervical cancer screening with HPV tests", "Screening Pap tests", "Screening pelvic exams including clinical breast exam"],
  "colorectal-cancer-screening": ["Colorectal cancer screening tests"],
  "bone-density-screening": ["Bone mass measurements"],
  "cardiovascular-risk-screening": ["Cardiovascular disease screening tests", "Intensive behavioral therapy for cardiovascular disease"],
  "prediabetes-type2-screening": ["Diabetes screening"],
  "lung-cancer-screening": ["Lung cancer screening"],
  "breast-cancer-screening": ["Mammography screening"],
  "abdominal-aortic-aneurysm-screening": ["Ultrasound abdominal aortic aneurysm screening"],
  "depression-screening": ["Depression screening"],
  "alcohol-misuse-screening-counseling": ["Alcohol misuse screenings and counseling"],
  "obesity-behavioral-counseling": ["Intensive behavioral therapy for obesity"],
  "sti-screening-counseling": ["Sexually transmitted infection screening", "High-intensity behavioral counseling to prevent STIs"],
  "prostate-cancer-screening": ["Prostate cancer screening"],
  "hepatitis-b-screening": ["Hepatitis B screening"],
  "hepatitis-c-screening": ["Hepatitis C screening"],
  "hiv-prep-screening": ["HIV screening"],
  "pneumococcal-vaccination": ["Pneumococcal shots"],
  "tobacco-cessation-counseling": ["Counseling to prevent tobacco use"],
  "medicare-diabetes-prevention-program": ["Medicare Diabetes Prevention Program"],
  "covid-19-vaccination": ["COVID-19 shots"],
  "influenza-vaccination": ["Flu shots"],
  "diabetes-self-management-training": ["Diabetes self-management training"],
  "glaucoma-screening": ["Glaucoma screening"],
  "hepatitis-b-vaccination": ["Hepatitis B shots"],
  "prolonged-preventive-services": ["Prolonged preventive services"],
  "medical-nutrition-therapy": ["Medical nutrition therapy"],
  "in-home-vaccine-administration": ["In-home vaccine administration"],
  "part-d-vaccination-review": ["Medicare Part D vaccines"],
});

const CATEGORY_BY_MEASURE = Object.freeze({
  "annual-wellness-visit": "Wellness visits",
  "initial-preventive-physical-examination": "Wellness visits",
  "prediabetes-type2-screening": "Diabetes-related services",
  "diabetes-self-management-training": "Diabetes-related services",
  "medicare-diabetes-prevention-program": "Diabetes-related services",
  "covid-19-vaccination": "Shots and vaccines",
  "influenza-vaccination": "Shots and vaccines",
  "hepatitis-b-vaccination": "Shots and vaccines",
  "pneumococcal-vaccination": "Shots and vaccines",
  "in-home-vaccine-administration": "Shots and vaccines",
  "part-d-vaccination-review": "Shots and vaccines",
  "alcohol-misuse-screening-counseling": "Counseling and therapies",
  "tobacco-cessation-counseling": "Counseling and therapies",
  "obesity-behavioral-counseling": "Counseling and therapies",
  "sti-screening-counseling": "Counseling and therapies",
  "medical-nutrition-therapy": "Counseling and therapies",
  "depression-screening": "Mental health",
  "hearing-audiology-assessment": "HETS clinical benefits",
  "cognitive-assessment-care-plan": "HETS clinical benefits",
});

const HETS_MEASURE_CATALOG = Object.freeze(catalog.map((item) => Object.freeze({
  ...item,
  category: CATEGORY_BY_MEASURE[item.measureId] || "Tests and screenings",
  cmsServices: Object.freeze(CMS_SERVICE_NAMES_BY_MEASURE[item.measureId] || []),
  cmsPreventiveCatalog: Boolean(CMS_SERVICE_NAMES_BY_MEASURE[item.measureId]?.length),
  hetsQueryable: item.codes.length > 0,
  evidenceRoute: item.codes.length > 0 ? "CMS HETS via Stedi" : "Health Core, CRISP, claims, or documented clinical history",
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
  Object.freeze({ system: "STC", value: "67" }),
  Object.freeze({ system: "STC", value: "CQ" }),
  Object.freeze({ system: "STC", value: "80" }),
  Object.freeze({ system: "STC", value: "CO" }),
  Object.freeze({ system: "STC", value: "BD" }),
  ...Object.freeze([...new Set(HETS_MEASURE_CATALOG
    .filter((measure) => !["annual-wellness-visit", "hearing-audiology-assessment", "cervical-cancer-screening"].includes(measure.measureId))
    .flatMap((measure) => measure.codes)
    .filter((value) => !value.startsWith("STC:")))]
    .map((value) => Object.freeze({ system: "HCPCS", value }))),
]);

function preventiveCatalogForUi() {
  return HETS_MEASURE_CATALOG.filter((measure) => measure.cmsPreventiveCatalog || measure.hetsQueryable).map((measure) => ({
    measureId: measure.measureId,
    label: measure.label,
    category: measure.category,
    cmsServices: [...measure.cmsServices],
    hetsQueryable: measure.hetsQueryable,
    evidenceRoute: measure.evidenceRoute,
    codeGuidance: measure.codeGuidance || "Confirm the clinical service and documentation before selecting a billing code.",
  }));
}

module.exports = {
  AUDIOLOGY_CODES,
  HETS_MEASURE_CATALOG,
  HETS_MEDICARE_SERVICE_BUNDLE,
  normalizeHetsMeasures,
  preventiveCatalogForUi,
};
