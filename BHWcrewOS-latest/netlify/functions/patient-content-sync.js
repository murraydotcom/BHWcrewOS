// Metadata-only bridge from protected patient HTML submissions to the shared
// Operations request/communication timeline. Clinical answers remain in the
// medication/content service and are never copied into Operations Cloud.

const { getSession, json } = require("./_lib");
const { careCloudToken, medicationApiBase } = require("./lib/care-cloud-auth");
const { operationsRequest } = require("./lib/operations-cloud");

function safeSubmission(submission = {}) {
  const sourceRecordId = String(submission.id || submission.submissionId || "").trim();
  const bhwPatientId = String(submission.patientId || submission.bhwPatientId || "").trim().toUpperCase();
  const contentPath = String(submission.contentPath || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(sourceRecordId)) return null;
  if (!/^BHW\d{4,}$/.test(bhwPatientId)) return null;
  if (!contentPath.startsWith("/") || contentPath.length > 240) return null;
  return {
    sourceRecordId,
    bhwPatientId,
    contentPath,
    sourceStatus: String(submission.status || "new").trim().toLowerCase().slice(0, 40),
    priority: submission.priority === "same_day_review" ? "time-sensitive" : "routine",
    submittedAt: String(submission.submittedAt || submission.createdAt || "").trim().slice(0, 40),
  };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });
  const apiBase = medicationApiBase();
  if (!apiBase) return json(503, { ok: false, error: "Protected patient-content service is not configured" });

  try {
    const response = await fetch(`${apiBase}/v1/staff/content-submissions?limit=100`, {
      headers: { Authorization: `Bearer ${careCloudToken(session)}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "Protected patient-content service is unavailable"), { status: response.status });

    const blocked = [];
    const submissions = (Array.isArray(data.submissions) ? data.submissions : []).map((item) => {
      const safe = safeSubmission(item);
      if (!safe) blocked.push(String(item?.id || item?.submissionId || "unknown").slice(0, 80));
      return safe;
    }).filter(Boolean);
    const results = await mapLimit(submissions, 8, async (body) => {
      try {
        const projected = await operationsRequest("/v1/patient-content-projections", {
          actor: session,
          method: "POST",
          body,
        });
        return {
          sourceRecordId: body.sourceRecordId,
          requestId: projected.request?.id || projected.patientRequest?.id || "",
          replayed: projected.replayed === true,
          verified: Boolean(projected.request?.id || projected.patientRequest?.id),
        };
      } catch (error) {
        return { sourceRecordId: body.sourceRecordId, error: String(error.message || error), verified: false };
      }
    });
    const failed = results.filter((result) => !result.verified);
    return json(failed.length ? 207 : 200, {
      ok: failed.length === 0,
      storage: "BHW Cloud",
      sourceCount: submissions.length,
      projectedCount: results.filter((result) => result.verified && !result.replayed).length,
      replayedCount: results.filter((result) => result.verified && result.replayed).length,
      blockedCount: blocked.length,
      failedCount: failed.length,
      results,
    });
  } catch (error) {
    return json(Number(error.status) || 502, { ok: false, error: String(error.message || error) });
  }
};

exports.safeSubmission = safeSubmission;
