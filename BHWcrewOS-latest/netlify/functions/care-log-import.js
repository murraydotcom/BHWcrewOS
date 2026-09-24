// Protected monthly care-log preparation. Program enrollment and patient
// identity come from the Google Cloud Patient Registry; the prepared monthly
// logs are stored in RCM Cloud. Re-running is idempotent by patient/program/month.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

const PROGRAM_PATTERNS = Object.freeze([
  ["CCM", /\bCCM\b|chronic care management/i],
  ["APCM", /\bAPCM\b|advanced primary care management/i],
  ["PCM", /\bPCM\b|principal care management/i],
  ["RPM", /\bRPM\b|remote patient monitoring/i],
  ["RTM", /\bRTM\b|remote therapeutic monitoring/i],
  ["BHI", /\bBHI\b|behavioral health integration/i],
  ["COCM", /\bCOCM\b|collaborative care/i],
  ["CHARMED MINDS", /charmed\s*minds/i],
]);

function normalizedPrograms(values) {
  const joined = (Array.isArray(values) ? values : [values]).filter(Boolean).join(" ");
  return PROGRAM_PATTERNS.filter(([, pattern]) => pattern.test(joined)).map(([program]) => program);
}

function monthDistance(currentMonth, earlierMonth) {
  if (!/^\d{4}-\d{2}$/.test(currentMonth) || !/^\d{4}-\d{2}$/.test(earlierMonth)) return Infinity;
  const [currentYear, currentValue] = currentMonth.split("-").map(Number);
  const [earlierYear, earlierValue] = earlierMonth.split("-").map(Number);
  return (currentYear * 12 + currentValue) - (earlierYear * 12 + earlierValue);
}

function recentPrograms(logs, month) {
  const byPatient = new Map();
  for (const log of Array.isArray(logs) ? logs : []) {
    if (String(log.type || "Monthly").toLowerCase() !== "monthly") continue;
    const logMonth = String(log.serviceMonth || "").slice(0, 7);
    const distance = monthDistance(month, logMonth);
    if (distance < 1 || distance > 2) continue;
    const programs = normalizedPrograms(log.program);
    if (!programs.length || !log.bhwPatientId) continue;
    const set = byPatient.get(log.bhwPatientId) || new Set();
    programs.forEach((program) => set.add(program));
    byPatient.set(log.bhwPatientId, set);
  }
  return byPatient;
}

function enrolledPrograms(patient, profile, recent) {
  return [...new Set([
    ...normalizedPrograms(patient.programs),
    ...normalizedPrograms(profile?.program),
    ...[...(recent || [])],
  ])];
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
    const [roster, existingResult, panelResult] = await Promise.all([
      listCloudPatients(actor),
      cloudRequest("/v1/care-management/logs", { actor }),
      cloudRequest("/v1/panel", { actor }).catch(() => ({ profiles: [] })),
    ]);
    const allLogs = Array.isArray(existingResult.logs) ? existingResult.logs : [];
    const existing = new Map(allLogs.filter((log) => String(log.serviceMonth || "").startsWith(month))
      .map((log) => [`${log.bhwPatientId}|${log.program}`, log]));
    const profiles = new Map((panelResult.profiles || []).map((profile) => [profile.bhwPatientId, profile]));
    const history = recentPrograms(allLogs, month);
    const summary = { month, created: 0, updated: 0, skipped: 0, recoveredPrograms: 0, patientRegistryCount: roster.length };

    for (const patient of roster) {
      if (!patient.selectable) continue;
      const registryPrograms = new Set(normalizedPrograms(patient.programs));
      const profilePrograms = new Set(normalizedPrograms(profiles.get(patient.bhwPatientId)?.program));
      for (const program of enrolledPrograms(patient, profiles.get(patient.bhwPatientId), history.get(patient.bhwPatientId))) {
        if (!registryPrograms.has(program) && !profilePrograms.has(program)) summary.recoveredPrograms += 1;
        const key = `${patient.bhwPatientId}|${program}`;
        const source = {
          entry: `${patient.name} — ${program} · ${month}`,
          program,
          type: "Monthly",
          serviceMonth,
          memberId: patient.memberId || "",
          icd: (patient.icds || []).join(", "),
          notes: [
            `Payer: ${patient.payer || "not recorded"}`,
            registryPrograms.has(program) ? "source: BHW Cloud Patient Registry" : profilePrograms.has(program)
              ? "source: Population Health enrollment" : "source: recent BHW Cloud care-log enrollment",
          ].join(" · "),
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

exports._test = { enrolledPrograms, monthDistance, normalizedPrograms, recentPrograms };
