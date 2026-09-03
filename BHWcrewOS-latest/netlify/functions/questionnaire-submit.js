// Public transport for patient-portal-assigned questionnaires. The Cloud
// invitation capability, not a typed name/BHW ID, binds the response to the
// correct patient.

const { json } = require("./_lib");

const REG = new Set(["charmed-intake", "charmed-adult", "awv-hra", "porter-lifeskills"]);
const WHO = new Set(["Self", "Parent/Caregiver", "Staff"]);

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
  if (!REG.has(slug)) return json(400, { error: "Unknown questionnaire." });
  if (!String(body.transcript || "").trim()) return json(400, { error: "Please answer at least one question before submitting." });
  if (!body.case || !body.responseToken) {
    return json(403, { error: "Open this assigned questionnaire from the protected patient portal." });
  }
  const base = rcmApiBase();
  if (!base) return json(503, { error: "This form is not connected to BHW Cloud yet. Please contact the office." });

  const response = await fetch(`${base}/v1/public/charmed/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: String(body.case).slice(0, 100),
      screeningId: String(body.screeningId || slug).slice(0, 100),
      responseToken: String(body.responseToken).slice(0, 200),
      responseKind: "questionnaire",
      respondent: WHO.has(body.who) ? body.who : "Self",
      answers: body.answers && typeof body.answers === "object" ? body.answers : {},
      transcript: String(body.transcript).slice(0, 16000),
      flags: String(body.flags || "").slice(0, 4000),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json(response.status, { error: result.error || "Your answers could not be saved." });
  return json(200, { ok: true, savedAt: result.savedAt, storage: "BHW Cloud" });
};
