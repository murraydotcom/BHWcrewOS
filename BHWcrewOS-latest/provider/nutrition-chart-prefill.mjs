const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const label = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function entries(prefill = {}) {
  return Object.entries(prefill.facts || {}).map(([fact, value]) => ({
    fact,
    value,
    ...(prefill.provenance?.[fact] || {}),
  }));
}

function displayValue(item) {
  const suffix = item.fact === "height_cm" || item.fact.endsWith("_circumference_cm") ? " cm"
    : item.fact === "current_weight_kg" ? " kg"
      : item.fact === "egfr_ml_min_1_73m2" ? " mL/min/1.73 m²"
        : "";
  return `${item.value}${suffix}`;
}

function displayDate(value) {
  if (!value) return "date not available";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : String(value);
}

export function renderNutritionChartPrefill(prefill = {}) {
  const available = entries(prefill);
  const warnings = Array.isArray(prefill.warnings) ? prefill.warnings : [];
  const summary = available.length
    ? `${available.length} current chart value${available.length === 1 ? "" : "s"} available for review.`
    : "No supported current chart values are available for this helper.";
  return `<div class="chart-prefill-head"><div><b>Health Core chart suggestions</b><span>${esc(summary)} Nothing is inserted automatically.</span></div><button class="btn" type="button" id="apply-chart-prefill" disabled>Fill blank chart fields</button></div>
    ${available.length ? `<ul class="chart-prefill-list">${available.map((item) => `<li><b>${esc(item.label || label(item.fact))}</b><span>${esc(displayValue(item))}</span><small>${esc(item.sourceType || "Health Core chart")} · ${esc(displayDate(item.sourceObservedAt))} · review required</small></li>`).join("")}</ul>` : ""}
    ${warnings.length ? `<p class="chart-prefill-warning">${warnings.length} stale, future-dated, or conflicting chart value${warnings.length === 1 ? " was" : "s were"} not offered for prefill.</p>` : ""}
    <p class="chart-prefill-feedback" id="chart-prefill-feedback" aria-live="polite">Saved or manually entered values will not be overwritten.</p>`;
}

function blankControl(control) {
  if (control.type === "checkbox") return control.checked !== true;
  if (control.tagName === "SELECT" && control.multiple) return [...control.selectedOptions].length === 0;
  return control.value === "" || control.value === undefined || control.value === null;
}

function writeControl(control, value) {
  if (control.type === "checkbox") control.checked = value === true;
  else if (control.tagName === "SELECT" && control.multiple) {
    for (const option of control.options) option.selected = Array.isArray(value) && value.includes(option.value);
  } else control.value = String(value);
}

export function applyNutritionChartPrefill(root, prefill = {}) {
  const controls = [...root.querySelectorAll('[data-fact][data-source="chart"]')];
  const byFact = new Map(controls.map((control) => [control.dataset.fact, control]));
  const applied = [];
  const preserved = [];
  const unavailable = [];
  const factSources = {};
  for (const item of entries(prefill)) {
    const control = byFact.get(item.fact);
    if (!control) {
      unavailable.push(item.fact);
      continue;
    }
    if (!blankControl(control)) {
      preserved.push(item.fact);
      continue;
    }
    writeControl(control, item.value);
    control.dataset.chartPrefillSource = item.sourceId || item.sourceType || "health-core";
    applied.push(item.fact);
    factSources[item.fact] = prefill.provenance?.[item.fact] || null;
  }
  return { applied, preserved, unavailable, factSources };
}

function equivalent(left, right) {
  if (typeof right === "number") return Number(left) === right;
  if (Array.isArray(right)) return JSON.stringify(left || []) === JSON.stringify(right);
  return left === right;
}

export function matchingNutritionChartProvenance(chartFacts = {}, prefill = {}, appliedFacts = []) {
  return Object.fromEntries([...appliedFacts].flatMap((fact) => {
    if (!Object.hasOwn(prefill.facts || {}, fact) || !equivalent(chartFacts[fact], prefill.facts[fact])) return [];
    const source = prefill.provenance?.[fact];
    return source ? [[fact, source]] : [];
  }));
}
