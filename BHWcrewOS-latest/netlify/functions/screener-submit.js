// Public form transport for an assigned CharmEd questionnaire. Patient identity
// is never accepted from the browser: the opaque portal invitation capability
// is verified by RCM Cloud, which owns the patient relationship and response.

const { json } = require("./_lib");

const REG = {
  "phq-9": { items: 9, min: 0, max: 3 },
  "phq-a": { items: 9, min: 0, max: 3 },
  "phq-2": { items: 2, min: 0, max: 3 },
  "gad-7": { items: 7, min: 0, max: 3 },
  "gad-2": { items: 2, min: 0, max: 3 },
  "audit-c": { items: 3, min: 0, max: 4 },
  "audit": { items: 10, min: 0, max: 4 },
  "pcl-5": { items: 20, min: 0, max: 4 },
};
const WHO = new Set(["Parent", "Teacher", "Self", "Provider"]);
const AGES = new Set(["Early Childhood", "Elementary", "Middle School", "High School", "Young Adult", "Adult"]);

function rcmApiBase() {
  try {
    const url = new URL(String(process.env.RCM_CLOUD_API_URL || ""));
    return url.protocol === "https:" ? `${url.origin}${url.pathname.replace(/\/$/, "")}` : "";
  } catch { return ""; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if (body.hp) return json(200, { ok: true });
  const slug = String(body.slug || "").toLowerCase();
  const spec = REG[slug];
  if (!spec) return json(400, { error: "Unknown screener." });
  if (!body.case || !body.responseToken) {
    return json(403, { error: "Open this assigned questionnaire from the protected patient portal." });
  }
  const answers = {};
  for (let index = 1; index <= spec.items; index += 1) {
    const raw = body.answers?.[index] ?? body.answers?.[String(index)];
    if (raw === "" || raw === null || raw === undefined) continue;
    const number = Number(raw);
    if (Number.isFinite(number)) answers[index] = Math.min(spec.max, Math.max(spec.min, Math.round(number)));
  }
  if (!Object.keys(answers).length) return json(400, { error: "Please answer at least one question before submitting." });
  const base = rcmApiBase();
  if (!base) return json(503, { error: "This form is not connected to BHW Cloud yet. Please contact the office." });

  const response = await fetch(`${base}/v1/public/charmed/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: String(body.case).slice(0, 100),
      screeningId: String(body.screeningId || slug).slice(0, 100),
      responseToken: String(body.responseToken).slice(0, 200),
      responseKind: "screener",
      respondent: WHO.has(body.who) ? body.who : "Self",
      answers,
      extra: body.extra && typeof body.extra === "object" ? body.extra : {},
      ageGroups: Array.isArray(body.ageGroups) ? body.ageGroups.filter((item) => AGES.has(item)) : [],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json(response.status, { error: result.error || "Your answers could not be saved." });
  return json(200, { ok: true, savedAt: result.savedAt, storage: "BHW Cloud" });
};
