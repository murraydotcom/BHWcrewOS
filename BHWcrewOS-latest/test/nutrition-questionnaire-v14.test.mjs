import assert from "node:assert/strict";
import test from "node:test";
import {
  getQuestionnairePath,
  mergeNutritionQuestionnaireModules,
  renderNutritionQuestionnaire,
  setQuestionnairePath,
} from "../provider/nutrition-questionnaire-v14.mjs";

const questionnaire = {
  version: "1.4.0",
  option_sets: {
    yes_no_unsure_decline: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  sections: [{ id: "real_life", title: "Real-life intake", intro: "What actually happens.", question_ids: ["meal.breakfast", "sensory.safe"] }],
  questions: [
    {
      id: "meal.breakfast",
      section_id: "real_life",
      prompt: "What do you usually eat for breakfast?",
      answer: { type: "meal_choice_with_text", choices: [{ value: "oatmeal", label: "Oatmeal" }] },
      mapping: { response_paths: ["/intake_profile/meal_pattern/typical_meals/breakfast"] },
      required_at_submission: true,
    },
    {
      id: "sensory.safe",
      section_id: "real_life",
      prompt: "What foods are safe & reliable?",
      answer: { type: "string_list" },
      mapping: { response_paths: ["/intake_profile/sensory_executive/safe_foods"] },
    },
  ],
};

test("v1.4 renderer creates labeled adaptive sections and escapes patient-facing copy", () => {
  const html = renderNutritionQuestionnaire(questionnaire);
  assert.match(html, /Adaptive questionnaire v1\.4\.0/);
  assert.match(html, /Real-life intake/);
  assert.match(html, /What do you usually eat for breakfast/);
  assert.match(html, /Oatmeal/);
  assert.match(html, /Review required/);
  assert.match(html, /safe &amp; reliable/);
  assert.doesNotMatch(html, /safe & reliable/);
});

test("GI pattern module merges after the core GI section and renders an accessible frequency matrix", () => {
  const core = {
    ...questionnaire,
    sections: [{ id: "gi_allergy", title: "GI", question_ids: [] }, ...questionnaire.sections],
  };
  const module = {
    module_id: "bhw-nutrition-gi-pattern-screen",
    version: "1.0.0",
    sections: [{ id: "gi_pattern_detail", title: "Digestive symptom pattern detail", question_ids: ["gi.pattern_matrix"] }],
    questions: [{
      id: "gi.pattern_matrix",
      prompt: "During the past 4 weeks, how often have these digestive symptoms happened?",
      answer: {
        type: "gi_pattern_matrix",
        labels: {
          scale: [{ value: 0, label: "Never or rarely" }, { value: 3, label: "Most days" }],
          groups: [{ code: "reflux", label: "Reflux pattern", rows: [{ code: "reflux_burning", label: "Burning behind the breastbone" }] }],
        },
      },
      mapping: { response_paths: ["/intake_profile/gi_profile/pattern_screen/symptom_frequency"] },
    }],
  };
  const merged = mergeNutritionQuestionnaireModules(core, module);
  assert.equal(merged.sections[1].id, "gi_pattern_detail");
  assert.equal(merged.questions.length, core.questions.length + 1);
  assert.equal(merged.module_versions["bhw-nutrition-gi-pattern-screen"], "1.0.0");
  const html = renderNutritionQuestionnaire(merged);
  assert.match(html, /data-q-role="gi-pattern-matrix"/);
  assert.match(html, /data-gi-code="reflux_burning"/);
  assert.match(html, /Never or rarely/);
  assert.match(html, /Most days/);
});

test("questionnaire response paths preserve nested real-life intake domains", () => {
  const intakeProfile = {};
  setQuestionnairePath(intakeProfile, "/intake_profile/sensory_executive/safe_foods", ["rice", "eggs"]);
  setQuestionnairePath(intakeProfile, "/intake_profile/meal_pattern/typical_meals/breakfast", "oatmeal; berries");
  assert.deepEqual(getQuestionnairePath(intakeProfile, "/intake_profile/sensory_executive/safe_foods"), ["rice", "eggs"]);
  assert.equal(getQuestionnairePath(intakeProfile, "/intake_profile/meal_pattern/typical_meals/breakfast"), "oatmeal; berries");
});
