// Protected monthly care-log preparation. Program enrollment and patient
// identity come from the Google Cloud Patient Registry; the prepared monthly
// logs are stored in RCM Cloud. Re-running is idempotent by patient/program/month.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

function enrolledPrograms(patient) {
  const values = Array.isArray(patient.programs) ? patient.programs : [];
  const joined = values.join(" ");
  const programs = [];
  if (/\bCCM\b|chronic care management/i.test(joined)) programs.push("CCM");
  if (/\bAPCM\b|advanced primary care management/i.test(joined)) programs.push("APCM");
  return programs;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const session = getSession(event);
  const suppliedSecret = event.headers?.["x-setup-secret"] || event.headers?.["X-Setup-Secret"];
  const scheduled = Boolean(process.env.SETUP_SECRET && suppliedSecret === process.env.SETUP_SECRET);
  if (!scheduled && !session) return json(401, { error: "Sign in to CrewOS again." });
  if (!scheduled && !body.confirm) return json(400, { error: "Confirm the monthly BHW Cloud preparation first." });

  const actor = session || { sub: "scheduled-care-log", staffId: "scheduled-care-log", name: "Scheduled care-log preparation", role: "system" };
  const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : new Date().toISOString().slice(0, 7);
  const serviceMonth = `${month}-01`;

  try {
    const [roster, existingResult] = await Promise.all([
      listCloudPatients(actor),
      cloudRequest(`/v1/care-management/logs?month=${encodeURIComponent(month)}`, { actor }),
    ]);
    const existing = new Map((existingResult.logs || []).map((log) => [`${log.bhwPatientId}|${log.program}`, log]));
    const summary = { month, created: 0, updated: 0, skipped: 0, patientRegistryCount: roster.length };

    for (const patient of roster) {
      if (!patient.selectable) continue;
      for (const program of enrolledPrograms(patient)) {
        const key = `${patient.bhwPatientId}|${program}`;
        const source = {
          entry: `${patient.name} — ${program} · ${month}`,
          program,
          type: "Monthly",
          serviceMonth,
          memberId: patient.memberId || "",
          icd: (patient.icds || []).join(", "),
          notes: [`Payer: ${patient.payer || "not recorded"}`, "source: BHW Cloud Patient Registry"].join(" · "),
        };
        const current = existing.get(key);
        if (current) {
          await cloudRequest(`/v1/care-management/logs/${encodeURIComponent(current.id)}`, {
            actor,
            method: "PUT",
            body: source,
          });
          summary.updated += 1;
        } else {
          await cloudRequest("/v1/care-management/logs", {
            actor,
            method: "POST",
            body: { ...source, bhwPatientId: patient.bhwPatientId, status: "Open" },
          });
          summary.created += 1;
        }
      }
    }

    return json(200, { ok: true, month, summary, savedAt: new Date().toISOString(), storage: "BHW Cloud" });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};
