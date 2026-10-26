import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../bhw-positive-ana.html", import.meta.url), "utf8");
const patient360App = await readFile(new URL("../provider/patient-360-app.mjs", import.meta.url), "utf8");
const positiveAnaRecord = await readFile(new URL("../netlify/functions/positive-ana-record.js", import.meta.url), "utf8");

function readLiteral(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return Function(`"use strict"; return (${page.slice(start + startMarker.length, end)});`)();
}

const anaPatterns = readLiteral("const ANA_PATTERNS=", ";\nconst ANA_TITERS");
const anaTiters = readLiteral("const ANA_TITERS=", ";\n\nfunction anaPatternOptions");
const panelCandidates = readLiteral("const PANELS_CANDIDATES=", ";\nconst SOURCE_MARKER_KEYS");
const markerSources = readLiteral("const SOURCE_MARKER_KEYS=", ";\nconst SOURCE_LABELS");
const panels = panelCandidates
  .map((panel) => ({ ...panel, abs: panel.abs.filter((antibody) => markerSources[antibody.k]).map((antibody) => ({ ...antibody, source: markerSources[antibody.k] })) }))
  .filter((panel) => panel.abs.length);
const symptomCandidates = readLiteral("const SYMPTOM_CANDIDATES=", ";\nconst SOURCE_SYMPTOM_LABELS");
const sourceSymptomLabels = readLiteral("const SOURCE_SYMPTOM_LABELS=", ";\nconst SOURCE_SYMPTOM_SET");
const sourceSymptoms = new Set(sourceSymptomLabels);
const symptoms = Object.fromEntries(
  Object.entries(symptomCandidates)
    .map(([group, items]) => [group, items.filter((item) => sourceSymptoms.has(item))])
    .filter(([, items]) => items.length),
);
const labGroupCandidates = readLiteral("const LAB_GROUP_CANDIDATES=", ";\nconst SOURCE_LAB_KEYS");
const labSources = readLiteral("const SOURCE_LAB_KEYS=", ";\nconst LAB_GROUPS");
const labGroups = labGroupCandidates
  .map((group) => ({ ...group, labs: group.labs.filter((lab) => labSources[lab.k]).map((lab) => ({ ...lab, source: labSources[lab.k] })) }))
  .filter((group) => group.labs.length);
const recordedMeasurements = readLiteral("const RECORDED_MEASUREMENTS=", ";\n\nlet foodIgGMeasurementCount");
const immuneSupportGuide = readLiteral("const IMMUNE_SUPPORT_GUIDE=", ";\nconst INFLAMMATION_V2");
const inflammationV2 = readLiteral("const INFLAMMATION_V2=", ";\nconst INFLAMMATION_PATTERN_LANES");
const inflammationPatternLanes = readLiteral("const INFLAMMATION_PATTERN_LANES=", ";\nconst ATLAS");
const managementMatrix = readLiteral("const MGMT=", ";\nconst esc=");
const analysisWorkflow = page.slice(page.indexOf("function buildAnalysisRecord"), page.indexOf("/* ================= VERIFIED PATIENT SAVE"));

test("Positive ANA page script compiles", () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((script, index) => assert.doesNotThrow(() => Function(script), `inline script ${index + 1}`));
});

test("analysis intake uses the full width and renders patient-labeled results below it", () => {
  assert.match(page, /\.grid\{display:block\}/);
  assert.doesNotMatch(page, /grid-template-columns:360px 1fr/);
  const inputsAt = page.indexOf('id="analysis-inputs"');
  const outputAt = page.indexOf('id="analysis-output"');
  assert.ok(inputsAt >= 0, "missing full-width analysis input workspace");
  assert.ok(outputAt > inputsAt, "analysis results must render below the input workspace");
  assert.match(page, /id="result-owner"/);
  assert.match(page, /positiveAnaPatientName\(patient\).*patient\.bhwPatientId/);
  assert.match(page, /\$\('analysis-output'\)\.scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
  assert.match(page, /Return to inputs/);
});

test("ANA intake includes the complete ICAP pattern set and pattern-specific titers", () => {
  const keys = new Set(anaPatterns.map((pattern) => pattern.k));
  for (let code = 0; code <= 29; code += 1) {
    assert.ok(keys.has(`AC-${code}`), `missing ICAP pattern AC-${code}`);
  }
  assert.equal(new Set(anaPatterns.map((pattern) => pattern.k)).size, anaPatterns.length, "ANA pattern keys must be unique");
  for (const group of ["Nuclear", "Cytoplasmic", "Mitotic"]) {
    assert.ok(anaPatterns.some((pattern) => pattern.group === group), `missing ${group} pattern group`);
  }
  for (const titer of [0, 40, 80, 160, 320, 640, 1280, 2560]) {
    assert.ok(anaTiters.some((option) => Number(option.v) === titer), `missing ANA titer ${titer}`);
  }
  assert.match(page, /id="ana-pattern-rows"/);
  assert.match(page, /function addAnaPatternRow\(initial=\{\}\)/);
  assert.match(page, /function removeAnaPatternRow\(button\)/);
  assert.match(page, /function collectAnaPatterns\(\)/);
  assert.match(page, /Each pattern keeps its own titer when a specimen has more than one pattern/);
  assert.match(page, /Every reported pattern keeps its own titer/);
  assert.match(page, /ANA patterns and titers:/);
});

test("antibody selector is source-aligned, grouped, searchable, and key-safe", () => {
  const antibodies = panels.flatMap((panel) => panel.abs);
  const keys = antibodies.map((antibody) => antibody.k);
  const panelIds = new Set(panels.map((panel) => panel.id));

  assert.ok(antibodies.length >= 70, `expected at least 70 source-aligned antibody/marker choices, got ${antibodies.length}`);
  assert.equal(new Set(keys).size, keys.length, "antibody keys must be unique");
  assert.ok(antibodies.every((antibody) => ["matrix", "guide", "both", "v2"].includes(antibody.source)), "every antibody must identify an approved source");
  for (const panelId of ["ana", "scleroderma", "myositis", "aps", "anca", "bowel", "gastric", "liver", "endocrine", "neuro", "skin", "heme", "other", "allergy", "rheum"]) {
    assert.ok(panelIds.has(panelId), `missing ${panelId} panel`);
  }
  for (const key of ["dsDNA", "SSA", "SSB", "RNAP3", "PL7", "PL12", "MDA5", "TIF1G", "HMGCR", "LA", "aCLG", "B2GP1G", "PR3", "MPO", "GBM", "PLA2R", "ASMA", "LKM1", "SLA", "AMA", "TPO", "TRAb", "GAD65", "OH21", "AQP4", "MOG", "AChRBind", "MuSK", "NMDAR", "Dsg3", "BP180", "DAT", "specificIgE"]) {
    assert.ok(keys.includes(key), `missing antibody/marker ${key}`);
  }
  for (const key of ["DFS70", "PCNA", "Fibrillarin", "NXP2", "ADAMTS13", "IgAtot", "IgG4"]) {
    assert.ok(!keys.includes(key), `unsupported or misclassified marker is still selectable: ${key}`);
  }
  assert.match(page, /id="absearch"/);
  assert.match(page, /function filterAntibodies\(\)/);
});

test("symptom intake covers organ systems and high-risk presentations", () => {
  const items = Object.values(symptoms).flat();
  assert.ok(items.length >= 120, `expected at least 120 source-aligned symptoms/history features, got ${items.length}`);
  assert.equal(new Set(items).size, items.length, "symptom labels must be unique to prevent double scoring");
  for (const group of ["Skin / Mucosa", "Eyes / ENT / Glands", "Joints / Muscle", "Cardiopulmonary", "Renal / Vascular", "Neuro / Autonomic", "GI / Hepatic", "Endocrine / Heme", "Pregnancy / Reproductive", "Immune Function / Infection", "Allergy / Mast-cell / Mediator", "Supportive Context / Exposures"]) {
    assert.ok(symptoms[group]?.length, `missing ${group} symptoms`);
  }
  for (const item of ["Hemoptysis (coughing blood)", "Reduced urine output", "New severe hypertension", "Rapidly ascending weakness", "Sensory level or new bowel/bladder dysfunction", "New psychosis, catatonia, or marked behavior change", "Jaw claudication / scalp tenderness", "Petechiae or very low platelets", "Recurrent bacterial sinusitis / otitis / pneumonia", "Persistent thrush", "Invasive Neisseria infection", "Poor vaccine response", "Anaphylaxis or near-anaphylaxis", "Angioedema (lip, tongue, face, or throat swelling)"]) {
    assert.ok(items.includes(item), `missing high-risk symptom ${item}`);
  }
  assert.match(page, /id="symptomsearch"/);
  assert.match(page, /function filterSymptoms\(\)/);
});

test("non-antibody findings are discrete, source-aligned, grouped, and searchable", () => {
  const labs = labGroups.flatMap((group) => group.labs);
  const keys = labs.map((lab) => lab.k);
  const labels = labs.map((lab) => lab.label);
  const groupIds = new Set(labGroups.map((group) => group.id));

  assert.ok(labs.length >= 110, `expected at least 110 source-aligned non-antibody findings, got ${labs.length}`);
  assert.equal(new Set(keys).size, keys.length, "non-antibody finding keys must be unique");
  assert.equal(new Set(labels).size, labels.length, "non-antibody finding labels must be unique");
  assert.ok(labs.every((lab) => ["matrix", "guide", "both", "v2", "weatherby"].includes(lab.source)), "every non-antibody finding must identify an approved source");
  for (const groupId of ["cbc", "complement", "inflammation", "mast", "functional", "renal", "muscle", "liver", "endocrine", "electrolytes", "nutrition", "gi", "neuro", "infection"]) {
    assert.ok(groupIds.has(groupId), `missing ${groupId} lab group`);
  }
  for (const label of ["Vitamin B12 low", "MCV high", "C3 low", "C4 low", "CH50 low", "AH50 low", "ESR high", "CRP normal", "Acute serum tryptase rise", "Baseline serum tryptase high", "Urinary N-methylhistamine elevated", "Urinary leukotriene E4 elevated", "Urinary prostaglandin metabolite elevated", "FeNO elevated", "Total IgM low", "IgG1 subclass low", "Pneumococcal serotype response inadequate", "Absolute CD3 T-cell count low", "Absolute CD19/CD20 B-cell count low", "DHR oxidative burst abnormal", "C1 esterase inhibitor function low", "CK high", "Aldolase high", "Creatinine rising from baseline", "RBC casts present", "AST high", "ALT high", "TSH high", "TSH low", "Hepatitis C test positive", "Hepatitis B test positive", "HIV test positive"]) {
    assert.ok(labels.includes(label), `missing discrete finding ${label}`);
  }
  for (const key of ["procalHigh", "sil2rHigh", "cystatinHigh", "vitDLow", "dDimerHigh", "adamts13Low", "parvoPositive", "ebvActive", "cmvActive"]) {
    assert.ok(!keys.includes(key), `out-of-source finding is still selectable: ${key}`);
  }
  for (const legacyLabel of ["B12 low / MCV high", "Low C3 / C4", "ESR high with normal CRP", "CK / aldolase elevated", "Creatinine rising / active sediment", "TSH abnormal", "Hepatitis C / B / HIV positive", "LFTs abnormal", "Cytopenias (low WBC/plt/Hgb)"]) {
    assert.ok(!labels.includes(legacyLabel), `combined legacy finding still present: ${legacyLabel}`);
  }
  assert.match(page, /id="labsearch"/);
  assert.match(page, /function filterLabs\(\)/);
});

test("source provenance stays consolidated instead of labeling individual labs", () => {
  assert.doesNotMatch(page, /<b>Central rule:<\/b>/);
  assert.doesNotMatch(page, /<b>Source boundary:<\/b>/);
  assert.doesNotMatch(page, /Edition 1\.0, 12 August 2026/);
  assert.doesNotMatch(page, /class="srcmini"/);
  assert.doesNotMatch(page, /Source: \$\{SOURCE_LABELS\[(?:l|a|m)\.source\]\}/);
  assert.match(page, /Assessment &amp; sources/);
  assert.match(page, /BHW Autoimmune Master Matrix/);
  assert.match(page, /Functional Immunology Marker Interpretation/);
});

test("the supplemental immune-support guide is attributed, bounded, and placed in matching workflows", () => {
  assert.equal(immuneSupportGuide.title, "Insider’s Guide to Supporting Optimal Immune Function");
  assert.equal(immuneSupportGuide.author, "Dicken Weatherby, N.D.");
  assert.equal(immuneSupportGuide.year, "2022");
  assert.equal(immuneSupportGuide.pages, "p. 1; pp. 5–25");
  assert.deepEqual(immuneSupportGuide.sections.map((section) => section.id), ["modifiable-context", "deficiency-context", "glycemic-context", "allergy-context"]);
  assert.deepEqual(immuneSupportGuide.referenceSections.map((section) => section.id), ["nutrient-options", "botanical-accessory-hormone-options", "condition-protocol-discussions", "allergy-digestive-options", "source-specific-testing"]);
  assert.match(immuneSupportGuide.role, /Supplemental practitioner guide/i);
  assert.match(JSON.stringify(immuneSupportGuide.sections), /not an allergy diagnosis/i);
  assert.match(JSON.stringify(immuneSupportGuide.sections), /convert the guide’s treatment doses into an automatic prescription/i);
  const referenceText = JSON.stringify(immuneSupportGuide.referenceSections);
  for (const retainedTopic of ["probiotics", "lactoferrin", "beta-glucan", "mushroom extracts", "DHEA", "melatonin", "acute infection", "asthma", "eczema", "hydrochloric acid", "pancreatic-enzyme", "Coca pulse testing", "Adrenal Stress Index"]) {
    assert.ok(referenceText.includes(retainedTopic), `missing guide reference topic ${retainedTopic}`);
  }
  assert.match(referenceText, /not a prescription/i);
  assert.match(referenceText, /not established universal recommendations/i);
  assert.match(referenceText, /does not establish analytic or clinical validity/i);

  const contextItems = symptoms[immuneSupportGuide.historyGroup] || [];
  assert.deepEqual(contextItems, immuneSupportGuide.historyLabels);
  const selectableLabs = new Map(labGroups.flatMap((group) => group.labs).map((lab) => [lab.k, lab]));
  for (const key of immuneSupportGuide.labKeys) {
    assert.equal(selectableLabs.get(key)?.source, "weatherby", `missing attributed guide finding ${key}`);
  }

  assert.match(page, /Supplemental immune-support context/);
  assert.match(page, /sourceReferences:supplementalGuideUsed/);
  assert.match(page, /No treatment dose, supplement stack, order set, or “immune-boosting” protocol is generated/);
  assert.match(page, /Clinician source navigation · retained claims, not recommendations/);
  assert.match(page, /Consult the original uploaded PDF for its exact language, tables, product details, and doses/);
  assert.match(page, /function renderLevers\(\)/);
  assert.match(page, /function renderAssess\(\)/);
  assert.match(positiveAnaRecord, /SUPPLEMENTAL_GUIDE_TITLE/);
  assert.match(positiveAnaRecord, /sourceReferences/);
  assert.match(patient360App, /Source references/);
  for (const excludedDose of [/100,000-300,000/, /50-200 mg\/day/, /6-8gms/, /13-23 mg/, /15\s*[–-]\s*75 mg\/day/]) {
    assert.doesNotMatch(page, excludedDose, `source dose table should not become an executable worksheet protocol: ${excludedDose}`);
  }
});

test("requested immune values are retained numerically without unsupported scoring", () => {
  const byKey = new Map(recordedMeasurements.map((measurement) => [measurement.k, measurement]));
  for (const key of ["c3Value", "c4Value", "nkValue", "cd4cd8Value", "foodIgGValue", "tryptaseAcuteValue", "tryptaseBaselineValue"]) {
    assert.ok(byKey.has(key), `missing numeric measurement ${key}`);
  }
  assert.match(page, /id="measure-\$\{m\.k\}" type="number"/);
  assert.match(page, /measure-date-\$\{m\.k\}/);
  assert.match(page, /measure-unit-\$\{m\.k\}/);
  assert.match(page, /measure-method-\$\{m\.k\}/);
  assert.match(page, /measure-range-\$\{m\.k\}/);
  assert.match(page, /Food \/ analyte tested/);
  assert.match(page, /function addFoodIgGMeasurement\(\)/);
  assert.match(page, /data-food-igg-row/);
  assert.match(page, /Add another food IgG result/);
  assert.equal(byKey.get("foodIgGValue").contextual, true);
  assert.match(byKey.get("foodIgGValue").use, /hypothesis-generating exposure\/recognition signal/i);
  assert.match(byKey.get("foodIgGValue").use, /does not diagnose food allergy or intolerance/i);
  assert.match(byKey.get("nkValue").use, /not as a general autoimmune-activity or immune-strength measure/i);
  assert.match(byKey.get("cd4cd8Value").use, /ratio alone is nonspecific/i);
  assert.match(page, /so prior values are not treated as comparable when they are not/);
  assert.doesNotMatch(analysisWorkflow, /recordOnly|excluded from ranking/);
});

test("prior records are compared factually with provenance and comparability limits", () => {
  assert.match(page, /function buildLongitudinalReview\(record\)/);
  assert.match(analysisWorkflow, /record\.longitudinalComparison=buildLongitudinalReview\(record\)/);
  assert.match(page, /priorReviewCount:prior\.length/);
  assert.match(page, /responseId:item\.responseId,reviewedAt:comparisonDate\(item\.submittedAt\)/);
  assert.match(page, /Units are not comparable/);
  assert.match(page, /Assay\/method differs/);
  assert.match(page, /Reference intervals differ/);
  assert.match(page, /descriptive only because assay\/method or specimen date was not recorded/);
  assert.match(page, /nonselection does not establish/i);
  assert.match(page, /Exact-patient longitudinal comparison/);
  assert.match(patient360App, /Exact-patient longitudinal comparison/);
});

test("clinical review has no condition ranking, scores, or hidden ranked ordering", () => {
  for (const forbidden of [/const scored=/, /\.sort\(\(a,b\)=>b\.s-a\.s\)/, /Matrix-ranked differential/, /conditions ranked/, /top-ranked/, /sharedWorkup/, /differential:/, /boost:/, /categories:/]) {
    assert.doesNotMatch(analysisWorkflow, forbidden);
  }
  assert.match(analysisWorkflow, /analysisMode:'non-ranking-clinician-review'/);
  assert.match(analysisWorkflow, /No condition ranking, score, hidden ordering, or automated diagnosis was generated/);
  assert.doesNotMatch(positiveAnaRecord, /differential:|sharedWorkup:/);
  assert.doesNotMatch(patient360App, /Ranked differential/);
});

test("Inflammation Framework Version 2 supplies bounded mast-cell, allergy, and food context", () => {
  assert.equal(inflammationV2.version, "2.0");
  assert.equal(inflammationV2.date, "25 October 2026");
  assert.match(inflammationV2.guardrail, /Inflammation is a process, not a diagnosis/);
  assert.deepEqual(inflammationV2.evidence.map((lane) => lane.code), ["A", "B", "C", "D", "S"]);
  assert.ok(inflammationV2.acuteDanger.length >= 13);
  for (const danger of ["Anaphylaxis", "Papilledema or vision loss", "Hemoptysis", "Suspected macrophage activation syndrome (MAS)"]) {
    assert.ok(inflammationV2.acuteDanger.includes(danger), `missing acute danger ${danger}`);
  }

  const sections = new Map(inflammationV2.sections.map((section) => [section.id, section]));
  for (const id of ["workflow", "biology", "root-causes", "perpetuators", "gut", "immunoglobulins", "food-antibodies", "mast-cell", "joint", "neuro", "edema", "complications", "laboratory", "imaging", "management", "n-of-1", "rapid-paths", "documentation"]) {
    assert.ok(sections.has(id), `missing Version 2 section ${id}`);
  }
  assert.equal(sections.get("workflow").items.length, 7, "workflow must retain all seven clinical steps");

  const allFrameworkText = JSON.stringify(inflammationV2);
  for (const expected of [
    "baseline tryptase", "acute paired tryptase", "urinary N-methylhistamine", "leukotriene E4", "prostaglandin metabolites",
    "C4", "C1 inhibitor level/function", "CD3/CD4/CD8/B/NK", "food IgG/IgA", "fecal alpha-1-antitrypsin clearance",
    "Synovial fluid", "Papilledema", "MR lymphangiography", "dechallenge–rechallenge", "Food IgG / IgA",
  ]) {
    assert.ok(allFrameworkText.includes(expected), `missing Version 2 content: ${expected}`);
  }
  assert.match(allFrameworkText, /does not by itself prove MCAS/i);
  assert.match(allFrameworkText, /Never use food IgG to estimate anaphylaxis risk/i);
  assert.match(allFrameworkText, /epinephrine and emergency escalation are first-line/i);

  assert.equal(Object.keys(inflammationPatternLanes).length, 17);
  assert.equal(inflammationPatternLanes.P15, "A criteria · D overlap");
  assert.match(page, /data-t="inflammation"/);
  assert.match(page, /id="tp-inflammation"/);
  assert.match(page, /function renderInflammation\(\)/);
  assert.match(page, /V2 lane \$\{esc\(INFLAMMATION_PATTERN_LANES\[p\.code\]\|\|p\.conf\)\}/);

  const selectableLabKeys = labGroups.flatMap((group) => group.labs).map((lab) => lab.k);
  for (const key of ["tryptaseAcuteRise", "tryptaseBaselineHigh", "urineNmhHigh", "urineLte4High", "urinePgMetaboliteHigh", "fenoHigh"]) {
    assert.ok(selectableLabKeys.includes(key), `missing Version 2 mast-cell/allergy finding ${key}`);
  }
  assert.match(page, /Targeted allergen-specific IgE positive/);
  assert.match(page, /does not diagnose food allergy or intolerance and must not be used to estimate anaphylaxis risk/i);
  assert.match(page, /exposure\/recognition, relative immune-response, barrier-context, or candidate-trigger hypotheses/);
  assert.match(page, /time-limited, nutritionally adequate elimination with planned rechallenge and prespecified endpoints/);
  assert.match(page, /AC-specific ICAP pattern-to-disease associations are not provided/);
});

test("management library retains all 100 Autoimmune Master Matrix rows", () => {
  assert.equal(managementMatrix.length, 100);
  assert.equal(new Set(managementMatrix.map((row) => row.id)).size, 100);
  assert.equal(new Set(managementMatrix.map((row) => row.condition)).size, 100);
});

test("priority results are not treated as diagnoses by themselves", () => {
  assert.match(page, /These findings do not establish a diagnosis by themselves/);
  assert.match(page, /Symptoms drive urgency; antibodies alone do not diagnose disease/);
});

test("verified Patient Registry workflow saves analysis and creates a private Step 5 assignment", () => {
  assert.match(page, /src="\/crew-provider-gate\.js"/);
  assert.match(page, /id="patient-search"/);
  assert.match(page, /id="patient-id"/);
  assert.match(page, /\/\.netlify\/functions\/patient-registry/);
  assert.match(page, /\/\.netlify\/functions\/positive-ana-record/);
  assert.match(page, /Saved and verified under/);
  assert.match(page, /contentPath:'\/bhw-positive-ana-step5\.html'/);
  assert.match(page, /questions:step5Questions\(\)/);
  assert.match(page, /Object\.entries\(SYMPTOMS\)/);
  assert.match(page, /staffAttestation:true/);
  assert.match(page, /\/sent`/);
  assert.match(page, /patient\.bhwPatientId!=='BHW0000'/);
  assert.match(page, /'deceased','transferred'/);
  assert.match(page, /includes\(patient\.bhwPatientId\).*exposed a patient identifier/s);
});

test("saved analyses and returned Step 5 responses form a clinician-reviewed downstream loop", () => {
  assert.match(page, /id="linked-records-list"/);
  assert.match(page, /action:'list',bhwPatientId:patient\.bhwPatientId/);
  assert.match(page, /\/v1\/staff\/content-submissions\?limit=100/);
  assert.match(page, /workflowType:'positive_ana_step5'/);
  assert.match(page, /function importStep5Submission\(submissionId\)/);
  assert.match(page, /patient-reported Step 5 symptom\(s\) imported for review/);
  assert.match(page, /Verify them, then create the clinical review and save it/);
  assert.match(page, /patientResponseIds=\[\.\.\.\(window\._importedStep5SubmissionIds\|\|\[\]\)\]/);
  assert.match(page, /priorAnalysisIds=\(linkedPositiveAnaAnalyses\|\|\[\]\)/);
  assert.match(patient360App, /function positiveAnaAnalysisPanel\(context/);
  assert.match(patient360App, /action: "list", bhwPatientId: PATIENT_ID/);
  assert.match(patient360App, /body\.bhwPatientId !== PATIENT_ID/);
  assert.match(patient360App, /Returned patient answers must be verified and included in a newly saved clinician review/);
  assert.match(patient360App, /positiveAnaAnalysisPanel\(context, \{ full: true \}\)/);
  assert.match(patient360App, /do not automatically create a diagnosis, order, ranking, score, or care-plan change/);
});
