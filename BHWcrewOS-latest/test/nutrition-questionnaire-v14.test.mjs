import assert from "node:assert/strict";
import test from "node:test";
import {
  getQuestionnairePath,
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

test("questionnaire response paths preserve nested real-life intake domains", () => {
  const intakeProfile = {};
  setQuestionnairePath(intakeProfile, "/intake_profile/sensory_executive/safe_foods", ["rice", "eggs"]);
  setQuestionnairePath(intakeProfile, "/intake_profile/meal_pattern/typical_meals/breakfast", "oatmeal; berries");
  assert.deepEqual(getQuestionnairePath(intakeProfile, "/intake_profile/sensory_executive/safe_foods"), ["rice", "eggs"]);
  assert.equal(getQuestionnairePath(intakeProfile, "/intake_profile/meal_pattern/typical_meals/breakfast"), "oatmeal; berries");
});
