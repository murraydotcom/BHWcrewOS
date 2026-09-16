const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const labelCode = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const list = (value) => Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
const present = (value) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
const safeId = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-");

const MEAL_COMPLETION_PCT = Object.freeze({
  none_to_quarter: 12.5,
  quarter_to_half: 38,
  half_to_three_quarters: 63,
  most_or_all: 88,
});

function questionsById(questionnaire = {}) {
  return new Map(list(questionnaire.questions).map((question) => [question.id, question]));
}

function choicesFor(question, questionnaire) {
  const answer = question?.answer || {};
  if (answer.choices?.length) return answer.choices;
  if (answer.option_set) return questionnaire?.option_sets?.[answer.option_set] || [];
  if (answer.choice_source) {
    const source = list(questionnaire?.questions).find((candidate) => candidate.mapping?.response_paths?.includes(answer.choice_source));
    return source?.answer?.choices || (source?.answer?.option_set ? questionnaire?.option_sets?.[source.answer.option_set] || [] : []);
  }
  return [];
}

function selectOptions(choices, { blank = true } = {}) {
  return `${blank ? '<option value="">Not answered</option>' : ""}${list(choices).map((choice) => `<option value="${esc(choice.value)}">${esc(choice.label || labelCode(choice.value))}</option>`).join("")}`;
}

function multiChoiceControl(question, questionnaire, extraClass = "") {
  const choices = choicesFor(question, questionnaire);
  return `<div class="question-choice-grid ${extraClass}">${choices.map((choice) => `<label><input type="checkbox" data-q-role="choice" value="${esc(choice.value)}"> <span>${esc(choice.label || labelCode(choice.value))}</span></label>`).join("")}</div>`;
}

function repeatableItem(question, questionnaire, index = 0) {
  const fields = question.answer?.labels?.item_fields || list(question.item_fields).map((id) => ({ id, label: labelCode(id) }));
  return `<div class="repeatable-item" data-repeatable-index="${index}">${fields.map((field) => {
    const choices = field.choices || (field.option_set ? questionnaire?.option_sets?.[field.option_set] || [] : []);
    const control = choices.length
      ? `<select data-repeatable-field="${esc(field.id)}">${selectOptions(choices)}</select>`
      : `<input type="text" data-repeatable-field="${esc(field.id)}" maxlength="500">`;
    return `<label><span>${esc(field.label || labelCode(field.id))}</span>${control}</label>`;
  }).join("")}<button type="button" class="button secondary compact" data-question-action="remove">Remove</button></div>`;
}

function renderBeverageGrid(question, questionnaire) {
  const frequency = questionnaire?.option_sets?.frequency || [];
  const rows = question.answer?.labels?.rows || [];
  return `<div class="question-table-wrap"><table class="question-grid-table"><thead><tr><th>Beverage</th><th>Amount</th><th>Unit</th><th>How often</th><th>Sweetened?</th></tr></thead><tbody>${rows.map((row) => `<tr data-beverage-type="${esc(row.value)}"><th>${esc(row.label)}</th><td><input type="number" min="0" step="0.1" data-beverage-field="amount" aria-label="${esc(row.label)} amount"></td><td><select data-beverage-field="unit" aria-label="${esc(row.label)} unit"><option value="mL">mL</option><option value="fl_oz_us">fluid ounces</option><option value="cup_us">cups</option><option value="bottle">bottles</option><option value="can">cans</option></select></td><td><select data-beverage-field="frequency" aria-label="${esc(row.label)} frequency">${selectOptions(frequency)}</select></td><td><select data-beverage-field="sweetened" aria-label="${esc(row.label)} sweetness"><option value="">Not answered</option><option value="yes">Sweetened</option><option value="no">Unsweetened</option><option value="unknown">Unsure</option></select></td></tr>`).join("")}</tbody></table></div>`;
}

function renderFrequencyGrid(question, questionnaire) {
  const choices = questionnaire?.option_sets?.[question.answer?.option_set] || [];
  return `<div class="question-table-wrap"><table class="question-grid-table"><thead><tr><th>Food</th><th>How often</th></tr></thead><tbody>${list(question.answer?.labels?.rows).map((row) => `<tr><th>${esc(row.label)}</th><td><select data-grid-key="${esc(row.value)}">${selectOptions(choices)}</select></td></tr>`).join("")}</tbody></table></div>`;
}

function renderQuestionControl(question, questionnaire) {
  const answer = question.answer || {};
  const type = answer.type;
  const choices = choicesFor(question, questionnaire);
  if (["multi_select", "multi_select_with_other"].includes(type)) return multiChoiceControl(question, questionnaire);
  if (type === "single_select") return `<select data-q-role="value">${selectOptions(choices)}</select>`;
  if (type === "ranked_select") return `<div class="paired-control"><label><span>First priority</span><select data-q-role="rank" data-rank="0">${selectOptions(choices)}</select></label><label><span>Second priority</span><select data-q-role="rank" data-rank="1">${selectOptions(choices)}</select></label></div>`;
  if (["integer", "integer_scale"].includes(type)) return `<input type="number" data-q-role="value" step="1" ${type === "integer_scale" ? 'min="0" max="10"' : 'min="0"'}>`;
  if (type === "long_text") return `<textarea data-q-role="value" rows="3" maxlength="4000"></textarea>`;
  if (type === "string_list") return `<input type="text" data-q-role="value" data-list placeholder="Separate items with commas">`;
  if (type === "time_or_relative") return `<input type="text" data-q-role="value" placeholder="e.g., 8:00 AM or about 2 hours after waking">`;
  if (type === "quantity_with_unit") return `<div class="paired-control"><label><span>Amount</span><input type="number" min="0" step="0.1" data-q-role="amount"></label><label><span>Unit</span><select data-q-role="unit">${selectOptions(answer.labels?.units || [], { blank: false })}</select></label></div>`;
  if (type === "frequency_grid") return renderFrequencyGrid(question, questionnaire);
  if (type === "repeatable_beverage_grid") return renderBeverageGrid(question, questionnaire);
  if (["meal_choice_with_text", "multi_select_with_text"].includes(type)) return `${multiChoiceControl(question, questionnaire)}<label class="question-detail"><span>Details or another answer</span><input type="text" data-q-role="detail" maxlength="1000"></label>`;
  if (type === "compound_boolean_unknown") return `<div class="paired-control">${list(answer.labels?.subquestions).map((item, index) => `<label><span>${esc(item.label)}</span><select data-q-role="boolean" data-path-index="${index}"><option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option><option value="unsure">Unsure</option><option value="declined">Prefer not to answer</option></select></label>`).join("")}</div>`;
  if (type === "structured_bowel_pattern") {
    const paths = question.mapping?.response_paths || [];
    return `<div class="paired-control">${paths.map((path, index) => {
      const name = path.split("/").pop();
      if (name === "bristol_types") return `<label><span>Bristol stool types</span><input type="text" data-q-role="path" data-path-index="${index}" data-list placeholder="e.g., 3, 4"></label>`;
      if (["bowel_movements_per_day", "bowel_movements_per_week"].includes(name)) return `<label><span>${esc(labelCode(name))}</span><input type="number" min="0" step="1" data-q-role="path" data-path-index="${index}"></label>`;
      return `<label><span>${esc(labelCode(name))}</span><select data-q-role="path" data-path-index="${index}" data-boolean><option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option><option value="unsure">Unsure</option></select></label>`;
    }).join("")}</div>`;
  }
  if (type === "pattern_history") {
    const labels = ["Patterns tried", "What worked", "What was hard", "Why you stopped"];
    return `<div class="paired-control">${list(question.mapping?.response_paths).map((path, index) => `<label><span>${labels[index] || labelCode(path.split("/").pop())}</span>${index === 0 ? '<input type="text" data-q-role="path" data-path-index="0" data-list>' : `<textarea data-q-role="path" data-path-index="${index}" rows="2" maxlength="2000"></textarea>`}</label>`).join("")}</div>`;
  }
  if (type.startsWith("repeatable_")) return `<div class="repeatable-list">${repeatableItem(question, questionnaire, 0)}</div><button type="button" class="button secondary compact" data-question-action="add" data-question-id="${esc(question.id)}">Add another</button>`;
  return `<textarea data-q-role="value" rows="3" maxlength="4000" placeholder="Enter any details that apply"></textarea>`;
}

function renderQuestion(question, questionnaire) {
  return `<fieldset class="question-card" data-question-id="${esc(question.id)}"><legend>${esc(question.prompt)}${question.required_at_submission ? '<span class="required-marker">Review required</span>' : ""}</legend>${question.help_text ? `<p class="question-help">${esc(question.help_text)}</p>` : ""}${renderQuestionControl(question, questionnaire)}</fieldset>`;
}

export function renderNutritionQuestionnaire(questionnaire = {}) {
  const map = questionsById(questionnaire);
  return `<div class="questionnaire-runtime-note"><b>Adaptive questionnaire v${esc(questionnaire.version || "1.4")}</b><span>Only relevant follow-up questions open. Patient report remains separate from chart physiology.</span></div>${list(questionnaire.sections).map((section, index) => {
    const questions = list(section.question_ids).map((id) => map.get(id)).filter(Boolean);
    return `<details class="questionnaire-section" data-section-id="${esc(section.id)}" ${index < 2 ? "open" : ""}><summary><span class="section-number">${index + 1}</span><span><b>${esc(section.title)}</b><small>${esc(section.intro || "")}</small></span><span class="section-count">${questions.length}</span></summary><div class="questionnaire-question-list">${questions.map((question) => renderQuestion(question, questionnaire)).join("")}</div></details>`;
  }).join("")}`;
}

function pointerParts(path) {
  return String(path || "").split("/").filter(Boolean).filter((part) => part !== "intake_profile").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function setQuestionnairePath(target, path, value) {
  const parts = pointerParts(path);
  if (!parts.length) return target;
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] ||= {};
  });
  return target;
}

export function getQuestionnairePath(source, path) {
  return pointerParts(path).reduce((value, part) => value?.[part], source);
}

function cardFor(container, questionId) {
  return [...container.querySelectorAll("[data-question-id]")].find((node) => node.dataset.questionId === questionId && node.classList.contains("question-card"));
}

function fieldValue(element) {
  if (!element) return undefined;
  if (element.dataset.list !== undefined) return element.value.split(",").map((item) => item.trim()).filter(Boolean);
  if (element.type === "number") return element.value === "" ? undefined : Number(element.value);
  return element.value === "" ? undefined : element.value;
}

function dailyMilliliters(amount, unit, frequency) {
  if (!Number.isFinite(amount)) return null;
  const unitMl = ({ mL: 1, fl_oz_us: 29.5735, cup_us: 236.588, bottle: 500, can: 355 })[unit] || 1;
  const perDay = ({ never_rarely: 0, one_two_week: 1.5 / 7, three_four_week: 3.5 / 7, most_days: 5 / 7, daily: 1, multiple_daily: 2 })[frequency];
  return perDay === undefined || perDay === null ? null : Math.round(amount * unitMl * perDay);
}

function readQuestion(card, question, questionnaire) {
  const type = question.answer?.type;
  const paths = question.mapping?.response_paths || [];
  const direct = (value) => ({ raw: value, mapped: present(value) ? [{ path: paths[0], value }] : [] });
  if (["single_select", "integer", "integer_scale", "long_text", "string_list", "time_or_relative"].includes(type)) {
    let value = fieldValue(card.querySelector('[data-q-role="value"]'));
    if (question.id === "appetite.meal_completion") return { raw: value, mapped: MEAL_COMPLETION_PCT[value] == null ? [] : [{ path: paths[0], value: MEAL_COMPLETION_PCT[value] }] };
    if (["sdoh.food_48h", "sdoh.navigation_consent"].includes(question.id) && present(value)) {
      const raw = value;
      value = value === "yes" ? true : value === "no" ? false : null;
      return { raw, mapped: [{ path: paths[0], value }] };
    }
    return direct(value);
  }
  if (["multi_select", "multi_select_with_other"].includes(type)) {
    const values = [...card.querySelectorAll('[data-q-role="choice"]:checked')].map((item) => item.value);
    if (question.id === "gi.alarm_screen") {
      const alarmCodes = ["bloody_or_coffee_ground_vomit", "severe_or_progressive_pain", "chest_pain", "fever", "persistent_vomiting", "unable_to_retain_fluids", "jaundice", "syncope_or_shock_symptoms", "dehydration_symptoms", "unintentional_weight_loss"];
      const mapped = Object.fromEntries(alarmCodes.map((code) => [code, values.includes("unsure") ? null : values.includes(code)]));
      return { raw: values, mapped: [{ path: paths[0], value: mapped }] };
    }
    return direct(values);
  }
  if (type === "ranked_select") return direct([...card.querySelectorAll('[data-q-role="rank"]')].map((item) => item.value).filter(Boolean));
  if (type === "quantity_with_unit") {
    const amount = fieldValue(card.querySelector('[data-q-role="amount"]'));
    const unit = fieldValue(card.querySelector('[data-q-role="unit"]'));
    if (!present(amount)) return { raw: undefined, mapped: [] };
    const raw = { amount, unit };
    if (question.id === "drinks.water") {
      const converted = ({ mL: amount, L: amount * 1000, cup_us: amount * 236.588, fl_oz_us: amount * 29.5735 })[unit];
      return { raw, mapped: Number.isFinite(converted) ? [{ path: paths[0], value: Math.round(converted) }] : [{ path: paths[0], value: raw }] };
    }
    return { raw, mapped: [{ path: paths[0], value: amount }, { path: paths[1], value: unit }] };
  }
  if (type === "frequency_grid") {
    const value = Object.fromEntries([...card.querySelectorAll("[data-grid-key]")].filter((item) => item.value).map((item) => [item.dataset.gridKey, item.value]));
    return direct(Object.keys(value).length ? value : undefined);
  }
  if (type === "repeatable_beverage_grid") {
    const value = [...card.querySelectorAll("[data-beverage-type]")].map((row) => {
      const amount = fieldValue(row.querySelector('[data-beverage-field="amount"]'));
      const unit = fieldValue(row.querySelector('[data-beverage-field="unit"]'));
      const frequency = fieldValue(row.querySelector('[data-beverage-field="frequency"]'));
      const sweetness = fieldValue(row.querySelector('[data-beverage-field="sweetened"]'));
      if (![amount, frequency, sweetness].some(present)) return null;
      return { type: row.dataset.beverageType, amount_ml_day: dailyMilliliters(amount, unit, frequency), entered_amount: amount ?? null, entered_unit: unit || null, frequency: frequency || null, sweetened: sweetness === "yes" ? true : sweetness === "no" ? false : null };
    }).filter(Boolean);
    return direct(value);
  }
  if (["meal_choice_with_text", "multi_select_with_text"].includes(type)) {
    const choices = [...card.querySelectorAll('[data-q-role="choice"]:checked')].map((item) => item.value);
    const detail = fieldValue(card.querySelector('[data-q-role="detail"]'));
    const raw = { choices, detail: detail || null };
    const mapped = type === "meal_choice_with_text" ? [...choices, detail].filter(Boolean).join("; ") : raw;
    return { raw, mapped: present(mapped) && (typeof mapped !== "object" || choices.length || detail) ? [{ path: paths[0], value: mapped }] : [] };
  }
  if (type === "compound_boolean_unknown") {
    const values = [...card.querySelectorAll('[data-q-role="boolean"]')].map((item) => item.value);
    return { raw: values, mapped: values.flatMap((value, index) => value ? [{ path: paths[index], value: value === "yes" ? true : value === "no" ? false : null }] : []) };
  }
  if (type === "structured_bowel_pattern" || type === "pattern_history") {
    const controls = [...card.querySelectorAll('[data-q-role="path"]')];
    const mapped = controls.flatMap((control) => {
      let value = fieldValue(control);
      if (control.dataset.boolean !== undefined && present(value)) value = value === "yes" ? true : value === "no" ? false : null;
      return present(value) ? [{ path: paths[Number(control.dataset.pathIndex)], value }] : [];
    });
    return { raw: Object.fromEntries(mapped.map((item) => [item.path, item.value])), mapped };
  }
  if (type?.startsWith("repeatable_")) {
    const value = [...card.querySelectorAll(".repeatable-item")].map((item) => Object.fromEntries([...item.querySelectorAll("[data-repeatable-field]")].map((field) => [field.dataset.repeatableField, fieldValue(field)]).filter(([, field]) => present(field)))).filter((item) => Object.keys(item).length);
    return direct(value);
  }
  return direct(fieldValue(card.querySelector('[data-q-role="value"]')));
}

function flattenQuestionnaireFacts(intakeProfile) {
  const facts = {};
  const visit = (value, key = "") => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (key && !(key in facts)) facts[key] = value;
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    } else if (key && !(key in facts)) facts[key] = value;
  };
  visit(intakeProfile);
  facts.primary_goals = intakeProfile.primary_goals;
  facts.barriers = intakeProfile.appetite_capacity?.barriers;
  facts.sensory_barriers = intakeProfile.sensory_executive?.sensory_barriers;
  facts.access_barriers = intakeProfile.sdoh?.access_barriers;
  facts.pattern_interest = intakeProfile.pattern_history?.interested_patterns;
  facts.gi_symptoms = intakeProfile.gi_allergy?.gi_symptoms;
  facts.unintentional_loss_reported = intakeProfile.weight_history?.trajectory_direction === "lost" && intakeProfile.weight_history?.intentionality === "unintentional";
  const beverages = list(intakeProfile.beverages?.items);
  facts.sweetened_beverage_ml_day = beverages.filter((item) => item.sweetened === true).reduce((sum, item) => sum + (Number(item.amount_ml_day) || 0), 0);
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}

export function collectNutritionQuestionnaire(container, questionnaire = {}, { includeHidden = false } = {}) {
  const intakeProfile = {};
  const questionnaireResponses = {};
  for (const question of list(questionnaire.questions)) {
    const card = cardFor(container, question.id);
    if (!card || (!includeHidden && card.hidden)) continue;
    const answer = readQuestion(card, question, questionnaire);
    if (present(answer.raw) || (answer.raw && typeof answer.raw === "object")) questionnaireResponses[question.id] = answer.raw;
    for (const item of answer.mapped) if (item.path && present(item.value)) setQuestionnairePath(intakeProfile, item.path, item.value);
  }
  return { intakeProfile, questionnaireResponses, flatFacts: flattenQuestionnaireFacts(intakeProfile) };
}

function conditionMet(condition, intakeProfile) {
  if (!condition) return true;
  if (condition.any) return condition.any.some((item) => conditionMet(item, intakeProfile));
  if (condition.all) return condition.all.every((item) => conditionMet(item, intakeProfile));
  const actual = getQuestionnairePath(intakeProfile, condition.fact);
  const expected = condition.value;
  if (condition.op === "not_null") return present(actual);
  if (condition.op === "is_null") return !present(actual);
  if (condition.op === "eq") return actual === expected;
  if (condition.op === "ne") return actual !== expected;
  if (condition.op === "in") return list(expected).includes(actual);
  if (condition.op === "not_in") return present(actual) && !list(expected).includes(actual);
  if (condition.op === "contains_any") return list(actual).some((item) => list(expected).includes(item));
  if (condition.op === "contains_all") return list(expected).every((item) => list(actual).includes(item));
  return false;
}

export function updateNutritionQuestionnaireVisibility(container, questionnaire = {}) {
  const { intakeProfile } = collectNutritionQuestionnaire(container, questionnaire, { includeHidden: true });
  for (const question of list(questionnaire.questions)) {
    const card = cardFor(container, question.id);
    if (!card) continue;
    const visible = conditionMet(question.branching?.display_when, intakeProfile);
    card.hidden = !visible;
    card.setAttribute("aria-hidden", String(!visible));
    for (const control of card.querySelectorAll("input,select,textarea,button")) control.disabled = !visible;
  }
}

function writeSimple(card, question, raw) {
  const type = question.answer?.type;
  if (["multi_select", "multi_select_with_other"].includes(type)) {
    for (const control of card.querySelectorAll('[data-q-role="choice"]')) control.checked = list(raw).includes(control.value);
  } else if (type === "ranked_select") {
    [...card.querySelectorAll('[data-q-role="rank"]')].forEach((control, index) => { control.value = list(raw)[index] || ""; });
  } else {
    const control = card.querySelector('[data-q-role="value"]');
    if (control && raw !== undefined && raw !== null) control.value = question.id === "appetite.meal_completion" && typeof raw === "number" ? (raw <= 25 ? "none_to_quarter" : raw <= 50 ? "quarter_to_half" : raw <= 75 ? "half_to_three_quarters" : "most_or_all") : Array.isArray(raw) ? raw.join(", ") : raw;
  }
}

export function populateNutritionQuestionnaire(container, questionnaire = {}, content = {}) {
  const responses = content.questionnaireResponses || content.questionnaire_responses || {};
  const intakeProfile = content.intakeProfile || content.intake_profile || {};
  const flat = content.inputFacts || content.input_facts || {};
  for (const question of list(questionnaire.questions)) {
    const card = cardFor(container, question.id);
    if (!card) continue;
    const paths = question.mapping?.response_paths || [];
    let raw = responses[question.id];
    if (raw === undefined && paths.length === 1) raw = getQuestionnairePath(intakeProfile, paths[0]);
    if (raw === undefined && paths.length === 1) raw = flat[paths[0].split("/").pop()];
    const type = question.answer?.type;
    if (raw === undefined && paths.length > 1 && ["structured_bowel_pattern", "pattern_history"].includes(type)) {
      const values = paths.map((path) => [path, getQuestionnairePath(intakeProfile, path)]).filter(([, value]) => present(value));
      if (values.length) raw = Object.fromEntries(values);
    }
    if (raw === undefined && paths.length > 1 && type === "compound_boolean_unknown") {
      const values = paths.map((path) => getQuestionnairePath(intakeProfile, path));
      if (values.some(present)) raw = values;
    }
    if (type === "quantity_with_unit" && present(raw)) {
      const amount = card.querySelector('[data-q-role="amount"]');
      const unit = card.querySelector('[data-q-role="unit"]');
      if (amount) amount.value = typeof raw === "object" ? raw.amount ?? "" : raw;
      if (unit) unit.value = typeof raw === "object" ? raw.unit || unit.value : "mL";
    } else if (type === "frequency_grid" && raw && typeof raw === "object") {
      for (const control of card.querySelectorAll("[data-grid-key]")) control.value = raw[control.dataset.gridKey] || "";
    } else if (["meal_choice_with_text", "multi_select_with_text"].includes(type) && raw && typeof raw === "object") {
      for (const control of card.querySelectorAll('[data-q-role="choice"]')) control.checked = list(raw.choices).includes(control.value);
      const detail = card.querySelector('[data-q-role="detail"]');
      if (detail) detail.value = raw.detail || "";
    } else if (type === "repeatable_beverage_grid" && Array.isArray(raw)) {
      for (const row of card.querySelectorAll("[data-beverage-type]")) {
        const item = raw.find((candidate) => candidate.type === row.dataset.beverageType);
        if (!item) continue;
        const values = {
          amount: item.entered_amount ?? item.amount_ml_day,
          unit: item.entered_unit || "mL",
          frequency: item.frequency,
          sweetened: item.sweetened === true ? "yes" : item.sweetened === false ? "no" : "",
        };
        for (const control of row.querySelectorAll("[data-beverage-field]")) control.value = values[control.dataset.beverageField] ?? "";
      }
    } else if (type === "compound_boolean_unknown" && Array.isArray(raw)) {
      [...card.querySelectorAll('[data-q-role="boolean"]')].forEach((control, index) => {
        const value = raw[index];
        control.value = value === true ? "yes" : value === false ? "no" : ["yes", "no", "unsure", "declined"].includes(value) ? value : value === null ? "unsure" : "";
      });
    } else if (["structured_bowel_pattern", "pattern_history"].includes(type) && raw && typeof raw === "object") {
      for (const control of card.querySelectorAll('[data-q-role="path"]')) {
        const path = paths[Number(control.dataset.pathIndex)];
        const value = raw[path] ?? raw[path?.split("/").pop()] ?? getQuestionnairePath(intakeProfile, path);
        if (!present(value)) continue;
        control.value = control.dataset.boolean !== undefined
          ? value === true ? "yes" : value === false ? "no" : ["yes", "no", "unsure"].includes(value) ? value : "unsure"
          : Array.isArray(value) ? value.join(", ") : value;
      }
    } else if (type?.startsWith("repeatable_") && Array.isArray(raw)) {
      const holder = card.querySelector(".repeatable-list");
      holder.innerHTML = raw.map((item, index) => repeatableItem(question, questionnaire, index)).join("") || repeatableItem(question, questionnaire, 0);
      [...holder.querySelectorAll(".repeatable-item")].forEach((itemNode, index) => {
        for (const control of itemNode.querySelectorAll("[data-repeatable-field]")) control.value = raw[index]?.[control.dataset.repeatableField] ?? "";
      });
    } else writeSimple(card, question, raw);
  }
  updateNutritionQuestionnaireVisibility(container, questionnaire);
}

export function handleNutritionQuestionnaireAction(event, container, questionnaire = {}) {
  const button = event.target.closest("[data-question-action]");
  if (!button || !container.contains(button)) return false;
  const card = button.closest(".question-card");
  if (button.dataset.questionAction === "remove") {
    const items = card.querySelectorAll(".repeatable-item");
    if (items.length > 1) button.closest(".repeatable-item")?.remove();
    else for (const control of button.closest(".repeatable-item")?.querySelectorAll("input,select,textarea") || []) control.value = "";
    return true;
  }
  if (button.dataset.questionAction === "add") {
    const question = questionsById(questionnaire).get(button.dataset.questionId);
    const holder = card.querySelector(".repeatable-list");
    holder.insertAdjacentHTML("beforeend", repeatableItem(question, questionnaire, holder.children.length));
    return true;
  }
  return false;
}
