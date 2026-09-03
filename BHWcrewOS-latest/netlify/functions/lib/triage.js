// netlify/functions/lib/triage.js — shared ingestion for inbound patient
// communications. This is the "Keragon replacement": webhook → match the
// patient by phone → create a record in the Google Operations Patient Requests queue, which the
// Front Desk OS inbox already renders (Calls & voicemails / Texts & portal /
// Faxes) by the row's Source.
//
// Env: Cloud patient registry settings, Operations API URL, and the protected
// Front Desk intake secret.
//
// Source strings are chosen so Front Desk OS buckets them correctly — its
// bucket() sorts /voicemail|phone/ → voice, /text|sms|portal/ → text, else fax:
//   "Text / SMS"  "Voicemail"  "Missed Call (Phone)"  "Phone Call"  "Fax"

const crypto = require("crypto");
const digits = (s) => (s || "").replace(/\D/g, "");
const { listCloudPatients } = require("./cloud-patients");
const { createFrontDeskIntake } = require("./operations-cloud");

// Match a sender phone number to one patient on the Master Patient List.
// Returns the canonical BHW Patient ID only when the match is unique. Shared
// household/caregiver numbers remain unresolved for staff identity confirmation.
async function matchPatientByPhone(from) {
  const out = { patientId: null, patientName: "", bhwPatientId: "" };
  const d = digits(from);
  const last10 = d.slice(-10);
  const last7 = d.slice(-7);
  if (last7.length !== 7) return out;
  try {
    const hits = (await listCloudPatients()).filter((p) => digits(p.phone).endsWith(last10));
    if (hits.length === 1) {
      out.patientId = hits[0].bhwPatientId || null;
      out.bhwPatientId = hits[0].bhwPatientId || "";
      out.patientName = hits[0].name || "";
    } else if (hits.length > 1) {
      // Shared/family number — don't guess one patient (and don't link the wrong
      // relation). Surface the candidate names in the row so the desk can pick.
      const names = [...new Set(hits.map((p) => p.name).filter(Boolean))];
      out.patientName = (names.slice(0, 4).join(" / ") + (names.length > 4 ? " / …" : "") + " (shared number)").slice(0, 200);
    }
  } catch { /* matching is best-effort — never block ingestion */ }
  return out;
}

// Create one authoritative Patient Request. The original fax/recording link is
// retained in protected source metadata. A shared or unmatched phone never gets
// guessed onto a patient record.
async function createQueueEntry({ patientId, patientName, from, summary, source, receivedISO, link, sourceUrl }) {
  const when = receivedISO || new Date().toISOString();
  const url = sourceUrl || (String(link || "").match(/https?:\/\/[^\s)]+/) || [])[0] || "";
  const message = `${summary || ""}`.trim().slice(0, 4000) || "Inbound communication received";
  const sourceSlug = String(source || "front-desk").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fingerprint = crypto.createHash("sha256").update([sourceSlug, from, when, url, message].join("|")).digest("hex");
  const result = await createFrontDeskIntake({
    submissionId: `front-desk:${fingerprint}`,
    body: {
      bhwPatientId: patientId || "",
      patientMatchStatus: patientId ? "matched" : "unmatched",
      requestType: "general",
      priority: "routine",
      summary: (!patientId && patientName ? `${patientName}: ` : "") + message,
      message,
      source: sourceSlug || "front-desk",
      requester: {
        displayName: patientName || "Unmatched sender",
        callbackPhone: from || "",
        preferredChannel: /fax/i.test(source) ? "fax" : "phone",
      },
      routing: { targetSystem: "crewos", assignedTeam: "front-desk" },
      sourceMetadata: { sourceRecordId: fingerprint, sourcePage: "front-desk-inbound", sourceUrl: url },
    },
  });
  if (!result) return { ok: false, error: "Google Operations intake is not configured" };
  return { ok: true, matched: !!patientId };
}

// Verify a Dialpad webhook body. Requires an HS256 JWT signed with the shared
// secret — a raw unsigned JSON body is REJECTED so the endpoint can't be spoofed
// by anyone who knows the URL. Returns the decoded payload, or null when the
// secret is missing or the signature is absent/invalid. (The handler 503s before
// calling this when no secret is configured.)
function parseDialpadBody(raw, secret) {
  const s = (raw || "").trim();
  if (!secret) return null;
  const [h, p, sig] = s.split(".");
  if (!h || !p || !sig) return null; // not a signed JWT (e.g. raw JSON) → reject
  const crypto = require("crypto");
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
}

module.exports = { digits, matchPatientByPhone, createQueueEntry, parseDialpadBody };
