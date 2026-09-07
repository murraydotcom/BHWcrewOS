export const CLINICAL_TIMELINE_CATEGORIES = [
  { id: "diagnosis", label: "Diagnoses" },
  { id: "flare", label: "Symptoms & flare-ups" },
  { id: "life-function", label: "Life & function" },
  { id: "imaging-result", label: "Imaging & key results" },
  { id: "treatment", label: "Treatment changes" },
  { id: "acute-care", label: "Hospital, ER & procedures" },
  { id: "other-clinical", label: "Other clinical milestones" },
];

const OPERATIONAL_TYPES = new Set(["task", "servicerequest", "careplan", "referral", "coordination"]);
const OPERATIONAL_TEXT = /\b(referral|coordination|scheduling|work queue|task assigned|prior auth(?:orization)?|insurance approval)\b/i;
const FLARE_TEXT = /\b(flare(?:-?up)?|exacerbation|relapse|recurrence|worsen(?:ed|ing)?|symptom onset|symptom change)\b/i;
const LIFE_FUNCTION_TEXT = /\b(life event|bereavement|grief|caregiver|housing|job change|employment change|started (?:a )?new job|lost (?:a )?job|moved|relocation|relationship change|pregnan(?:cy|t)|postpartum|functional change|mobility change|activity limitation|school change)\b/i;
const IMAGING_TEXT = /\b(imaging|mri|ct scan|computed tomography|x-?ray|radiograph|ultrasound|sonogram|mammogram|dexa|bone density|pet scan|echocardiogram)\b/i;
const ACUTE_CARE_TEXT = /\b(hospital|hospitalization|emergency|emergency department|\ber\b|admission|discharge|surgery|procedure|urgent care)\b/i;
const TREATMENT_TEXT = /\b(medication|medicine|treatment|therapy|dose|medication (?:started|stopped|discontinued)|(?:started|stopped|discontinued) medication|adverse effect|response to treatment)\b/i;

function searchableEventText(event = {}) {
  return [
    event.type,
    event.label,
    event.title,
    event.detail,
    event.summary,
    event.status,
    ...(Array.isArray(event.physiologicDomains) ? event.physiologicDomains : []),
  ].filter(Boolean).join(" ");
}

export function clinicalTimelineCategory(event = {}) {
  const type = String(event.type || "").toLowerCase().replace(/[^a-z]/g, "");
  const text = searchableEventText(event);
  if (OPERATIONAL_TYPES.has(type) || OPERATIONAL_TEXT.test(text)) return null;
  if (FLARE_TEXT.test(text) || (type === "condition" && /\b(relapse|recurrence)\b/i.test(text))) return "flare";
  if (LIFE_FUNCTION_TEXT.test(text) || type === "lifeevent") return "life-function";
  if (IMAGING_TEXT.test(text) || type === "imagingstudy") return "imaging-result";
  if (type === "condition" || /\b(diagnosis|diagnosed|condition identified)\b/i.test(text)) return "diagnosis";
  if (ACUTE_CARE_TEXT.test(text) || type === "procedure") return "acute-care";
  if (type === "medicationrequest" || TREATMENT_TEXT.test(text)) return "treatment";
  if (["observation", "diagnosticreport"].includes(type)) return "imaging-result";
  if (type === "encounter") return "other-clinical";
  return "other-clinical";
}

export function clinicalTimelineEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({ ...event, clinicalCategory: clinicalTimelineCategory(event) }))
    .filter((event) => event.clinicalCategory)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

export function clinicalTimelineCounts(events = []) {
  const counts = Object.fromEntries(CLINICAL_TIMELINE_CATEGORIES.map(({ id }) => [id, 0]));
  for (const event of clinicalTimelineEvents(events)) counts[event.clinicalCategory] += 1;
  return counts;
}
