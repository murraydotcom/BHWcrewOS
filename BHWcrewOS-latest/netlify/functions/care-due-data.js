// netlify/functions/care-due-data.js — the single "start your day" worklist for
// care management (bhw-care-due.html). Session-gated, read-only. Merges three
// sources into one sorted list:
//   1. CCM/APCM/TCM follow-ups from the Care Management Log that are due
//      (overdue / today / this week), from the Next Follow-up date.
//   2. CCM/APCM patients not started this month (no contact, no minutes).
//   3. Open inbound patient requests from the Front Desk triage queue.
//
//   POST {}  →  { today, endOfWeek, followups, notStarted, requests, counts }

const { DB, queryDb, P, getSession, json } = require("./_lib");
const { listCloudPatients } = require("./lib/cloud-patients");

const QUEUE_DB = process.env.QUEUE_DB_ID || "de7906906a134b65bb0fc6966ba20b13";
const people = (p) => (p?.people || []).map((u) => u.name).filter(Boolean).join(", ");
const qsel = (p) => p?.select?.name || p?.status?.name || "";
const qtext = (p) => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || "";
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to crewOS again." });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  const now = new Date();
  const today = iso(now);
  const eowDate = new Date(now); eowDate.setDate(eowDate.getDate() + ((7 - now.getDay()) % 7)); // through Sunday
  const eow = iso(eowDate);
  const month = today.slice(0, 7);
  const DONE = new Set(["Complete", "Billed"]);

  try {
    const [logs, roster] = await Promise.all([queryDb(DB.careLog), listCloudPatients(session)]);
    const byBhwId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const bySourceId = new Map(roster.filter((patient) => patient.notionPageId).map((patient) => [patient.notionPageId, patient]));
    const followups = [];
    const notStarted = [];
    for (const pg of logs) {
      const p = pg.properties;
      const it = {
        id: pg.id,
        name: (P.title(p["Entry"]) || "").split(" — ")[0] || P.title(p["Entry"]),
        program: P.sel(p["Program"]),
        ctlNo: P.text(p["Patient Ctl No"]),
        month: P.date(p["Service Month"]),
        minutes: P.num(p["Minutes Logged"]),
        nextFollowUp: P.date(p["Next Follow-up"]),
        stage: P.sel(p["Follow-up Stage"]),
        status: P.sel(p["Status"]) || "Open",
        coordinator: people(p["Care Coordinator"]),
        lastContact: P.date(p["Last Contact"]),
        patientId: P.rel(p["Patient"])[0] || "",
      };
      const registryPatient = byBhwId.get(it.ctlNo) || bySourceId.get(it.patientId);
      if (registryPatient) {
        it.bhwPatientId = registryPatient.bhwPatientId;
        it.name = registryPatient.name || it.name;
        it.payer = registryPatient.payer;
        it.rosterLinked = true;
      } else {
        it.bhwPatientId = "";
        it.rosterLinked = false;
      }
      if (it.nextFollowUp && !DONE.has(it.status) && it.nextFollowUp <= eow) {
        it.bucket = it.nextFollowUp < today ? "overdue" : it.nextFollowUp === today ? "today" : "week";
        followups.push(it);
      } else if ((it.program === "CCM" || it.program === "APCM") &&
        (it.month || "").slice(0, 7) === month && !DONE.has(it.status) &&
        !it.nextFollowUp && !it.lastContact && !(it.minutes > 0)) {
        notStarted.push(it);
      }
    }
    const rank = { overdue: 0, today: 1, week: 2 };
    followups.sort((a, b) =>
      (rank[a.bucket] - rank[b.bucket]) ||
      (a.nextFollowUp || "").localeCompare(b.nextFollowUp || "") ||
      a.name.localeCompare(b.name));
    notStarted.sort((a, b) => a.name.localeCompare(b.name));

    // inbound patient requests (open) from the triage queue
    let requests = [];
    try {
      const q = await queryDb(QUEUE_DB);
      requests = q.map((r) => {
        const p = r.properties;
        return {
          id: r.id,
          type: qsel(p["Request Type"]),
          source: qsel(p["Source"]),
          priority: qsel(p["Priority"]),
          status: qsel(p["Status"]),
          sla: p["⚠️ SLA"]?.formula?.string || "",
          received: p["Received"]?.date?.start || "",
          summary: qtext(p["Summary"]),
          name: qtext(p["Patient Name"]),
          assigned: qsel(p["Assigned To"]),
        };
      }).filter((r) => r.status && !["Done", "Resolved", "Closed"].includes(r.status));
      requests.sort((a, b) => (b.received || "").localeCompare(a.received || ""));
    } catch (_) { /* queue optional — leave empty if unreachable */ }

    return json(200, {
      today, endOfWeek: eow, followups, notStarted, requests,
      counts: {
        overdue: followups.filter((f) => f.bucket === "overdue").length,
        today: followups.filter((f) => f.bucket === "today").length,
        week: followups.filter((f) => f.bucket === "week").length,
        notStarted: notStarted.length,
        requests: requests.length,
      },
    });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
