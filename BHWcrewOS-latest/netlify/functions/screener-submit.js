// netlify/functions/screener-submit.js — public intake endpoint for the
// BHW-hosted, brand-styled condition screeners (screener.html).
//
//   POST { slug, answers:{ "1":2, ... }, who, ageGroups:[], patientLabel,
//          case, formUrl, extra:{}, hp }
//        → { ok, id }
//
// Writes each item score into the "Condition Screeners — Data" Notion DB as
// Item 1..N. Notion's own formulas compute Total Score / Severity Category /
// Interpretation from those items — so this endpoint deliberately only posts
// raw item numbers plus context, never a score it made up.
//
// This is intentionally PUBLIC (patients, parents, and teachers fill it out
// with no crewOS login). It is hardened instead of gated: the slug must be a
// known instrument, item indexes and values are clamped to that instrument's
// bounds, a hidden honeypot field rejects bots, and Raw Responses is length
// bounded. It only ever creates one row in the screeners DB.

const { DB, createPage, W, json } = require("./_lib");

// Server-side instrument bounds. Keep the item COUNT and value range in sync
// with the front-end registry in screener.html. The server does not need the
// question text — only enough to reject a malformed or oversized payload.
const REG = {
  "phq-9": { name: "PHQ-9", items: 9, min: 0, max: 3, who: ["Self"] },
  "phq-a": { name: "PHQ-9 (Teen)", items: 9, min: 0, max: 3, who: ["Self"] },
  "phq-2": { name: "PHQ-2", items: 2, min: 0, max: 3, who: ["Self"] },
  "gad-7": { name: "GAD-7", items: 7, min: 0, max: 3, who: ["Self"] },
  "gad-2": { name: "GAD-2", items: 2, min: 0, max: 3, who: ["Self"] },
  "audit-c": { name: "AUDIT-C", items: 3, min: 0, max: 4, who: ["Self"] },
};

const WHO = new Set(["Parent", "Teacher", "Self", "Provider"]);
const AGES = new Set(["Early Childhood", "Elementary", "Middle School", "High School", "Young Adult", "Adult"]);
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "This form isn't connected yet — please contact the office." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  // Honeypot: real users never fill this hidden field.
  if (body.hp) return json(200, { ok: true });

  const spec = REG[String(body.slug || "").toLowerCase()];
  if (!spec) return json(400, { error: "Unknown screener." });

  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const props = {};
  let answered = 0;
  for (let i = 1; i <= spec.items; i++) {
    const raw = answers[i] ?? answers[String(i)];
    if (raw === "" || raw === null || raw === undefined) continue;
    let n = Number(raw);
    if (!Number.isFinite(n)) continue;
    n = Math.min(spec.max, Math.max(spec.min, Math.round(n))); // clamp to instrument bounds
    props[`Item ${i}`] = W.num(n);
    answered++;
  }
  if (!answered) return json(400, { error: "Please answer at least one question before submitting." });

  const who = WHO.has(body.who) ? body.who : (spec.who && spec.who[0]) || "Self";
  const ageGroups = Array.isArray(body.ageGroups) ? body.ageGroups.filter((a) => AGES.has(a)) : [];
  const patientLabel = String(body.patientLabel || "").trim().slice(0, 120);
  const title = patientLabel ? `${spec.name} — ${patientLabel}` : `${spec.name} — submitted`;

  // Everything the formulas don't consume is preserved verbatim for audit.
  const rawBlob = JSON.stringify({
    slug: body.slug, who, ageGroups, patientLabel,
    answers: Object.fromEntries(Object.entries(answers).slice(0, 60)),
    extra: body.extra && typeof body.extra === "object" ? body.extra : undefined,
  }).slice(0, 1900);

  props["Screener Name"] = W.title(title);
  props["Who Completes"] = W.sel(who);
  props["Completed?"] = W.check(true);
  props["Raw Responses"] = W.text(rawBlob);
  if (ageGroups.length) props["Age Group"] = { multi_select: ageGroups.map((name) => ({ name })) };
  if (body.formUrl && /^https?:\/\//i.test(body.formUrl)) props["Link to Form"] = { url: String(body.formUrl).slice(0, 400) };

  // Best-effort link to the assessment/patient case when the link carried one.
  const caseId = String(body.case || "").trim();
  const withRel = caseId && UUID.test(caseId)
    ? { ...props, Patient: W.rel([caseId]) }
    : props;

  try {
    const page = await createPage(DB.screeners, withRel);
    return json(200, { ok: true, id: page.id });
  } catch (err) {
    // A stale/foreign case id makes Notion reject the relation — save the
    // responses anyway rather than losing them.
    if (withRel !== props) {
      try {
        const page = await createPage(DB.screeners, props);
        return json(200, { ok: true, id: page.id, note: "linked case not found — saved unlinked" });
      } catch (e2) { return json(500, { error: String(e2.message || e2) }); }
    }
    return json(500, { error: String(err.message || err) });
  }
};
