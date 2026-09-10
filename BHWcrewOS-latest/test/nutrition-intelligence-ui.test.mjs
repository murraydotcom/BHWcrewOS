import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
});

test("Nutrition Intelligence uses the protected cloud client and exact review lifecycle", async () => {
  const [html, app, cloud] = await Promise.all([
    provider("nutrition-intelligence.html"),
    provider("nutrition-intelligence.mjs"),
    provider("cloud-queue.mjs"),
  ]);

  assert.match(html, /crew-provider-gate\.js/);
  assert.match(html, /Synthetic-only implementation pilot/);
  assert.match(html, /Not saved/);
  assert.match(html, /Approval readiness not evaluated/);
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
  assert.match(app, /Clinical \+ renal-RDN approval pending/);
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

  assert.match(html, /previews create no diagnosis, order, medication change, supplement order, message, CrewOS task, or patient-facing Blueprint/);
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
  const app = await provider("patient-360-app.mjs");
  assert.match(app, /\["nutrition", "Nutrition", "nutrition-intelligence\.html"\]/);
  assert.match(app, /const patientQuery = `\?patient=\$\{encodeURIComponent\(PATIENT_ID\)\}`/);
  assert.match(app, /href="\$\{href\}\$\{patientQuery\}"/);
  assert.match(app, /nutritionIntelligence\?\.status === "published-provider-reviewed"/);
  assert.match(app, /Nutrition phenotypes are decision-support labels, not diagnoses/);
  assert.match(app, /review-required source material/);
});
