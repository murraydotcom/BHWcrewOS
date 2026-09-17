import assert from "node:assert/strict";
import test from "node:test";
import { renderNutritionDigestionMap } from "../provider/nutrition-digestion-map.mjs";

test("BHW digestion map is original, accessible, and driven by the clinical contract", () => {
  const html = renderNutritionDigestionMap({
    title: "Where digestion and absorption happen",
    subtitle: "Functions overlap and this is not diagnostic.",
    regions: [
      { code: "stomach", label: "Stomach", primary_functions: ["Mixes food"], clinical_lens: "Symptoms need review." },
      { code: "ileum", label: "Ileum", primary_functions: ["Absorbs vitamin B12"], clinical_lens: "History changes interpretation." },
    ],
  });
  assert.match(html, /role="img"/);
  assert.match(html, /<title id="digestion-svg-title">/);
  assert.match(html, /<desc id="digestion-svg-desc">/);
  assert.match(html, /Where digestion and absorption happen/);
  assert.match(html, /Absorbs vitamin B12/);
  assert.match(html, /Symptoms help localize a presentation/);
  assert.doesNotMatch(html, /Figure 2\.4/);
});
