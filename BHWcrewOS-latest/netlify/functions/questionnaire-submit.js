// netlify/functions/questionnaire-submit.js — public intake endpoint for the
// BHW-hosted, brand-styled questionnaires (bhw-questionnaire.html).
//
//   POST { slug, patientLabel, bhwId, who, transcript, answers, flags, hp }
//        → { ok, id }
//
// Writes one row to "Questionnaires — Data". The front-end builds the readable
// Q/A transcript (it has the question text); this endpoint validates the slug,
// derives the program server-side, bounds every field, and stores the machine
// copy + any surfaced follow-up flags. Public, so it's hardened like the
// screener endpoint: known-slug only, honeypot, and length caps.

const { DB, createPage, W, json } = require("./_lib");

// slug → { Notion "Questionnaire" option, owning program }. Program is set here,
// never trusted from the client.
const REG = {
  "awv-hra": { qn: "AWV Health Risk Assessment", program: "Primary Care" },
  "charmed-intake": { qn: "CharmEd Minds Intake", program: "CharmEd Minds" },
  "charmed-adult": { qn: "CharmEd Minds Intake", program: "CharmEd Minds" },
  "porter-lifeskills": { qn: "Porter House Lifeskills", program: "The Porter House" },
};
const WHO = new Set(["Self", "Parent/Caregiver", "Staff"]);
const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "This form isn't connected yet — please contact the office." });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if (b.hp) return json(200, { ok: true }); // honeypot

  const spec = REG[String(b.slug || "").toLowerCase()];
  if (!spec) return json(400, { error: "Unknown questionnaire." });

  const transcript = String(b.transcript || "").trim();
  if (!transcript) return json(400, { error: "Please answer at least one question before submitting." });

  const who = WHO.has(b.who) ? b.who : "Self";
  const patientLabel = String(b.patientLabel || "").trim().slice(0, 120);
  const title = `${spec.qn} — ${patientLabel || "submitted"}`;
  let answersJson = "";
  try { answersJson = JSON.stringify(b.answers || {}).slice(0, 1900); } catch { answersJson = ""; }

  const props = {
    "Name": W.title(title),
    "Questionnaire": W.sel(spec.qn),
    "Program": W.sel(spec.program),
    "Patient Name": W.text(patientLabel),
    "BHW ID": W.text(String(b.bhwId || "").slice(0, 60)),
    "Who Completed": W.sel(who),
    "Submitted": W.date(today()),
    "Answers": W.text(transcript.slice(0, 1900)),
    "Answers JSON": W.text(answersJson),
    "Flags": W.text(String(b.flags || "").slice(0, 1900)),
    "Status": W.sel("New"),
  };

  try {
    const page = await createPage(DB.questionnaires, props);
    return json(200, { ok: true, id: page.id });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
