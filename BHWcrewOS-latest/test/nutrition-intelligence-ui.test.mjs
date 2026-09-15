import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  centimetersToInches,
  inchesToCentimeters,
  kilogramsToPounds,
  poundsToKilograms,
  waistToHipRatio,
} from "../provider/nutrition-unit-conversions.mjs";
import {
  normalizeBhwPatientId,
  verifiedNutritionPatientContext,
} from "../provider/nutrition-patient-context.mjs";

const provider = (path) => readFile(new URL(`../provider/${path}`, import.meta.url), "utf8");

test("Nutrition Intelligence preserves the real-life, physiology, and reconciliation model", async () => {
  const html = await provider("nutrition-intelligence.html");

  assert.match(html, /Questionnaire reflects real life/);
  assert.match(html, /Chart reflects physiology/);
  assert.match(html, /Nutrition Intelligence reconciles both/);
  assert.match(html, /not just weight/);
  assert.match(html, /GI symptoms and lived experience/);
  assert.match(html, /GI alarm and acute safety screen/);
  assert.match(html, /Cuisines and food traditions to preserve/);
  assert.match(html, /Safe or reliably accepted foods/);
  assert.match(html, /Consents to food-access navigation/);
  assert.match(html, /Kidney health and real-life food rules/);
  assert.match(html, /Familiar, cultural, religious, or safe foods to preserve/);
  assert.match(html, /Salt substitute\/electrolyte product/);
  assert.match(html, /Potassium interpretation/);
  assert.match(html, /Protein-energy-wasting risk/);
  assert.match(html, /Stone type/);
  assert.match(html, /24-hour urine reviewed/);
  assert.match(html, /Enteric hyperoxaluria risk/);
  assert.match(html, /Infection stone or positive culture/);
  assert.match(html, /Anemia in CKD present/);
  assert.match(html, /Height \(in\)/);
  assert.match(html, /Height \(cm\)/);
  assert.match(html, /Calculation weight \(lb\)/);
  assert.match(html, /Calculation weight \(kg\)/);
  assert.match(html, /Waist circumference \(in\)/);
  assert.match(html, /Hip circumference \(cm\)/);
  assert.match(html, /Context only—no automatic diagnosis or weight-loss recommendation/);
});

test("measurement converters preserve canonical kg and cm values", () => {
  assert.equal(poundsToKilograms(220), 99.8);
  assert.equal(kilogramsToPounds(100), 220.5);
  assert.equal(inchesToCentimeters(40), 101.6);
  assert.equal(centimetersToInches(101.6), 40);
  assert.equal(waistToHipRatio(88.9, 101.6), 0.875);

  for (const converter of [poundsToKilograms, kilogramsToPounds, inchesToCentimeters, centimetersToInches]) {
    assert.equal(converter(""), null);
    assert.equal(converter(-1), null);
  }
  assert.equal(waistToHipRatio(90, 0), null);
});

test("height accepts inches while preserving canonical centimeters", async () => {
  const [html, app] = await Promise.all([
    provider("nutrition-intelligence.html"),
    provider("nutrition-intelligence.mjs"),
  ]);

  assert.match(html, /id="height-in"[^>]*placeholder="inches"/);
  assert.match(html, /id="height-cm"[^>]*data-fact="height_cm"[^>]*data-source="chart"/);
  assert.match(html, /converted to canonical centimeters/);
  assert.match(app, /syncConvertedInput\("height-in", "height-cm", inchesToCentimeters\)/);
  assert.match(app, /syncConvertedInput\("height-cm", "height-in", centimetersToInches\)/);
  assert.equal(inchesToCentimeters(65), 165.1);
  assert.equal(centimetersToInches(165.1), 65);
});

test("Nutrition Intelligence requires a Health Core-verified patient identity", () => {
  assert.equal(normalizeBhwPatientId(" bhw0140 "), "BHW0140");
  assert.equal(normalizeBhwPatientId(""), "");
  assert.equal(normalizeBhwPatientId("patient name"), "");

  const healthRecord = {
    bhwPatientId: "BHW0140",
    fhir: {
      entry: [{
        resource: {
          resourceType: "Patient",
          id: "BHW0140",
          identifier: [{ system: "https://bhwmedical.org/patient-id", value: "BHW0140" }],
          name: [{ given: ["Ella"], family: "Ballard" }],
          birthDate: "1980-01-02",
        },
      }],
    },
  };

  assert.deepEqual(verifiedNutritionPatientContext(healthRecord, "BHW0140"), {
    bhwPatientId: "BHW0140",
    displayName: "Ella Ballard",
    birthDate: "1980-01-02",
    synthetic: false,
  });
  assert.throws(() => verifiedNutritionPatientContext(healthRecord, "BHW0141"), /different patient context/);
  assert.throws(() => verifiedNutritionPatientContext(null, ""), /Choose a patient/);
});

test("Nutrition Intelligence uses the protected cloud client and exact review lifecycle", async () => {
  const [html, app, cloud] = await Promise.all([
    provider("nutrition-intelligence.html"),
    provider("nutrition-intelligence.mjs"),
    provider("cloud-queue.mjs"),
  ]);

  assert.match(html, /crew-provider-gate\.js/);
  assert.match(html, /Health Core verification is required before evaluation or saving/);
  assert.match(html, /id="evaluate" disabled/);
  assert.match(html, /id="save-draft" disabled/);
  assert.match(html, /Not saved/);
  assert.match(html, /Approval readiness not evaluated/);
  assert.match(app, /const PATIENT_ID = normalizeBhwPatientId\(requestedPatientId\)/);
  assert.match(app, /client\.healthRecord\(PATIENT_ID\)/);
  assert.match(app, /verifiedNutritionPatientContext\(healthRecordBody\?\.healthRecord, PATIENT_ID\)/);
  assert.match(app, /if \(!PATIENT_ID\)/);
  assert.match(app, /No patient workspace was opened or queried/);
  assert.doesNotMatch(app, /requestedPatientId\) \? requestedPatientId : "BHW0000"/);
  assert.match(app, /Saving…/);
  assert.match(app, /Saved to BHW Cloud/);
  assert.match(app, /patientNutritionIntelligence\(PATIENT_ID\)/);
  assert.match(app, /action: "evaluate"/);
  assert.match(app, /action: "save-draft"/);
  assert.match(app, /action: "approve"/);
  assert.match(app, /action: "publish"/);
  assert.match(app, /Incomplete—approval blocked/);
  assert.match(app, /draft\?\.evaluation\?\.reviewReadiness\?\.approvalReady === true/);
  assert.match(app, /It remains incomplete and cannot be approved yet/);
  for (const target of ["Carbohydrate", "Fat", "Fiber", "Hydration"]) assert.match(app, new RegExp(`<b>${target}<\\/b>`));
  for (const target of ["energy", "protein", "sodium", "potassium", "phosphorus", "fluid"]) assert.match(app, new RegExp(`"${target}"`));
  assert.match(app, /kidneyPanel\(evaluation\.kidney\)/);
  assert.match(app, /Updated education review pending/);
  assert.match(app, /kidneyEducationCards\(kidney\.educationCandidates\)/);
  assert.match(app, /Natural food and preparation options to review/);
  assert.match(app, /not approved patient handouts or prescriptions/);
  assert.match(app, /BHW clinical-owner and external renal-RDN approval/);
  assert.match(app, /kidney\.patientPublicationAllowed !== true/);
  assert.match(app, /Kidney patient outputs require BHW clinical-owner and renal-RDN content approval first/);
  assert.match(cloud, /patientNutritionIntelligence\(bhwPatientId = "BHW0000"\)/);
  assert.match(cloud, /savePatientNutritionIntelligence\(bhwPatientId = "BHW0000", input = \{\}\)/);
  assert.doesNotMatch(app, /localStorage\.(?:setItem|getItem)\([^)]*(?:nutrition|patient|assessment)/i);
});

test("preview and publication copy keep prohibited autonomous actions explicit", async () => {
  const [html, app] = await Promise.all([
    provider("nutrition-intelligence.html"),
    provider("nutrition-intelligence.mjs"),
  ]);

  assert.match(html, /previews create no diagnosis, order, medication change, supplement order, message, CrewOS task, or patient-facing Blueprint/i);
  assert.match(html, /existing Personal Health Blueprint still requires its own review/);
  assert.match(app, /No diagnosis, order, task, message, or patient projection was created/);
  assert.match(app, /no Care Connect delivery, order, medication change, or message was created/);
});

test("Nutrition Intelligence uses the shared Opal and Ironstone visual system", async () => {
  const [html, css, app] = await Promise.all([
    provider("nutrition-intelligence.html"),
    provider("nutrition-intelligence.css"),
    provider("nutrition-intelligence.mjs"),
  ]);

  assert.match(css, /background:var\(--opal-stone\)/);
  assert.match(css, /--nutrition-ironstone:var\(--sidebar\)/);
  for (const token of ["--teal", "--green", "--purple", "--gold"]) {
    assert.match(css, new RegExp(`var\\(${token}\\)`));
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(html, />Black Opal<\/button>/);
  assert.match(app, /dark \? "Light Opal" : "Black Opal"/);
  assert.match(app, /aria-pressed/);
});

test("Patient 360 exposes a patient-scoped Nutrition Intelligence path", async () => {
  const [app, registryApp] = await Promise.all([
    provider("patient-360-app.mjs"),
    provider("patient-registry-app.mjs"),
  ]);
  assert.match(app, /\["nutrition", "Nutrition", "nutrition-intelligence\.html"\]/);
  assert.match(app, /const patientQuery = `\?patient=\$\{encodeURIComponent\(PATIENT_ID\)\}`/);
  assert.match(app, /href="\$\{href\}\$\{patientQuery\}"/);
  assert.match(app, /a\[href\^="patient-360"\], a\[href\^="nutrition-intelligence\.html"\]/);
  assert.match(app, /nutritionIntelligence\?\.status === "published-provider-reviewed"/);
  assert.match(app, /Nutrition phenotypes are decision-support labels, not diagnoses/);
  assert.match(app, /review-required source material/);
  assert.match(registryApp, /Open Patient 360/);
  assert.match(registryApp, /patient-360\.html\?patient=\$\{encodeURIComponent\(patient\.bhwPatientId\)\}/);
});
