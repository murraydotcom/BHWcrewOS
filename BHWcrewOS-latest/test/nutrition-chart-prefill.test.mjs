import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNutritionChartPrefill,
  matchingNutritionChartProvenance,
  renderNutritionChartPrefill,
} from "../provider/nutrition-chart-prefill.mjs";

const prefill = {
  status: "review-required",
  facts: { age_years: 40, height_cm: 165.1 },
  provenance: {
    age_years: { label: "Age", sourceId: "patient-demographics", sourceType: "Health Core patient demographics", sourceObservedAt: "1986-01-01" },
    height_cm: { label: "Height", sourceId: "height-observation", sourceType: "Health Core observation", sourceObservedAt: "2026-09-10" },
  },
  warnings: [{ fact: "current_weight_kg", code: "stale-chart-fact" }],
};

function control(fact, value = "") {
  return { dataset: { fact }, value, type: "number", tagName: "INPUT" };
}

test("chart helper renders source dates, review language, and a blank-field-only action", () => {
  const html = renderNutritionChartPrefill(prefill);
  assert.match(html, /Health Core chart suggestions/);
  assert.match(html, /Nothing is inserted automatically/);
  assert.match(html, /Fill blank chart fields/);
  assert.match(html, /review required/);
  assert.match(html, /Saved or manually entered values will not be overwritten/);
  assert.match(html, /stale, future-dated, or conflicting chart value/);
});

test("chart helper fills only blank fields and preserves existing clinician values", () => {
  const age = control("age_years");
  const height = control("height_cm", "170");
  const root = { querySelectorAll() { return [age, height]; } };
  const result = applyNutritionChartPrefill(root, prefill);
  assert.equal(age.value, "40");
  assert.equal(height.value, "170");
  assert.deepEqual(result.applied, ["age_years"]);
  assert.deepEqual(result.preserved, ["height_cm"]);
  assert.equal(age.dataset.chartPrefillSource, "patient-demographics");
});

test("saved provenance includes only applied values that still match the chart suggestion", () => {
  const factSources = matchingNutritionChartProvenance({ age_years: 40, height_cm: 170 }, prefill, ["age_years", "height_cm"]);
  assert.deepEqual(Object.keys(factSources), ["age_years"]);
  assert.equal(factSources.age_years.sourceId, "patient-demographics");
});
