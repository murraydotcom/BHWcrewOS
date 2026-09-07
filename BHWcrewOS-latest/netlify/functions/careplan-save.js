// Save a patient care-plan draft into the existing protected Google Cloud
// Health Blueprint. This endpoint never creates a second patient record and
// never writes patient content to the legacy Notion data layer.

const { DIVISIONS, getSession, json } = require("./_lib");
const { cloudRequest } = require("./lib/cloud-patients");

const PROGRAM_IDS = {
  "Primary Care": "primary-care",
  "CharmEd Minds": "charmed-minds",
  "Mind & Mood Recovery": "m&m",
  "Care Management": "population-health",
  "Flow": "flow",
  "The Porter House": "other",
};

function lines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function mergeList(existing, incoming) {
  return uniq([...(Array.isArray(existing) ? existing : []), ...lines(incoming)]);
}

function carePlanDraft(existing, input) {
  const current = existing && typeof existing === "object" ? existing : {};
  const treatment = current.treatmentBlueprint || {};
  const followUp = current.followUp || {};
  const takeaway = current.onePageTakeaway || {};
  const documentSupport = current.documentSupport || {};
  const goals = lines(input.goals);
  const patientActions = uniq([...lines(input.patientRole), ...lines(input.actions)]);
  const careTeamActions = lines(input.interventions);
  const homeMonitoring = lines(input.track);
  const phases = uniq([
    ...lines(input.weeks1to4).map((item) => `Weeks 1–4: ${item}`),
    ...lines(input.weeks5to8).map((item) => `Weeks 5–8: ${item}`),
    ...lines(input.weeks9to12).map((item) => `Weeks 9–12: ${item}`),
  ]);
  const firstPriorities = lines(input.actions);

  return {
    ...current,
    bhwPatientId: String(input.bhwId || "").trim().toUpperCase(),
    status: "draft",
    title: current.title || "My Health Blueprint",
    planDate: input.planDate || current.planDate || "",
    reviewDate: input.reviewDate || current.reviewDate || "",
    patientSummary: {
      ...(current.patientSummary || {}),
      mainStory: String(input.focus || "").trim() || current.patientSummary?.mainStory || "",
      healthGoals: goals.length ? goals : (current.patientSummary?.healthGoals || []),
    },
    treatmentBlueprint: {
      ...treatment,
      priorities: {
        ...(treatment.priorities || {}),
        first: firstPriorities.length ? firstPriorities : mergeList(treatment.priorities?.first, input.goals),
      },
      systemSpecificCare: uniq([...(treatment.systemSpecificCare || []), ...careTeamActions, ...phases]),
    },
    followUp: {
      ...followUp,
      monitoring: uniq([...(followUp.monitoring || []), ...homeMonitoring]),
      nextSteps: uniq([...(followUp.nextSteps || []), ...patientActions, ...phases]),
      followUpDate: input.reviewDate || followUp.followUpDate || "",
      careTeam: String(input.careTeam || "").trim() || followUp.careTeam || "",
    },
    onePageTakeaway: {
      ...takeaway,
      mainStory: String(input.focus || "").trim() || takeaway.mainStory || "",
      doNow: patientActions.length ? patientActions : (takeaway.doNow || []),
      followUpDate: input.reviewDate || takeaway.followUpDate || "",
      careTeam: String(input.careTeam || "").trim() || takeaway.careTeam || "",
    },
    documentSupport: {
      ...documentSupport,
      programCarePlan: {
        ...(documentSupport.programCarePlan || {}),
        programId: PROGRAM_IDS[input.program] || "other",
        patientActions,
        homeMonitoring,
        careTeamActions: uniq([...careTeamActions, ...phases]),
        reviewCadence: input.reviewDate ? `Review by ${input.reviewDate}` : "Review at least annually and when the plan changes",
      },
    },
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Signed out — sign in to CrewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Bad JSON" }); }

  if (!body.program || !DIVISIONS.includes(body.program)) return json(400, { ok: false, error: "Pick a program" });
  const bhwPatientId = String(body.bhwId || "").trim().toUpperCase();
  if (!/^BHW\d{4,}$/.test(bhwPatientId) || bhwPatientId === "BHW0000") {
    return json(400, { ok: false, error: "Choose a verified patient from the BHW Cloud Patient Registry" });
  }

  try {
    const current = await cloudRequest(`/v1/patients/${encodeURIComponent(bhwPatientId)}/blueprint`, { actor: session });
    const draft = carePlanDraft(current.blueprint, { ...body, bhwId: bhwPatientId });
    const saved = await cloudRequest(`/v1/patients/${encodeURIComponent(bhwPatientId)}/blueprint`, {
      actor: session,
      method: "PUT",
      body: draft,
    });
    const savedAt = saved.blueprint?.updatedAt || new Date().toISOString();
    return json(200, {
      ok: true,
      saved: true,
      destination: "BHW Cloud",
      bhwPatientId,
      savedAt,
      status: saved.blueprint?.status || "draft",
      readiness: saved.readiness || null,
    });
  } catch (error) {
    const message = String(error.message || error);
    const status = /not found/i.test(message) ? 404 : 502;
    return json(status, { ok: false, saved: false, destination: "BHW Cloud", error: message });
  }
};

exports._test = { carePlanDraft, lines, PROGRAM_IDS };
