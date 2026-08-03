// netlify/functions/submit-review.js
// Native patient reviews for BHW Care Connect + the Patient Portal.
//
// Collects a star rating + optional comment, stores every response in the
// "⭐ Patient Reviews" Notion database (BAA-covered), and hands back the Google
// review link so the front end can offer a one-tap "leave a Google review".
//
// Compliance notes:
//   • We never *post* to Google on the patient's behalf (Google's API is
//     read-only for reviews) — we only surface the link for them to write it.
//   • The Google link is offered to everyone after they submit, regardless of
//     rating. We do NOT gate it on sentiment (Google prohibits review gating).
//     Low ratings are additionally flagged "Follow-up needed" for the team.
//   • Reviews may contain PHI-adjacent detail; they only ever go to Notion.
//
// Env:
//   NOTION_TOKEN        (shared)
//   REVIEWS_DB_ID       optional override for the Patient Reviews database id
//   GOOGLE_REVIEW_URL   optional override for the practice's Google review link
//   SESSION_SECRET      to validate a portal session before linking a patient
//
// Actions:
//   GET                          -> { googleUrl }                 (for the button)
//   POST { rating, comment, name, contact, source, token?, patientId? }
//                                -> { ok, googleUrl }

const { json, createPage, updatePage, DB, W, verify } = require("./_lib");

const GOOGLE_REVIEW_URL =
  process.env.GOOGLE_REVIEW_URL || "https://share.google/cQNnl8gbsXqKB7oGM";
const REVIEWS_DB = process.env.REVIEWS_DB_ID || DB.reviews;

const clampRating = (r) => {
  const n = Math.round(Number(r));
  return n >= 1 && n <= 5 ? n : 0;
};

exports.handler = async (event) => {
  // The button needs the link before anything is submitted.
  if (event.httpMethod === "GET") return json(200, { googleUrl: GOOGLE_REVIEW_URL });
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  // "routed" ping: the patient tapped the Google button — flag the record.
  if (body.action === "routed" && body.id) {
    try {
      await updatePage(body.id, { "Routed to Google": W.check(true) });
    } catch {
      /* non-fatal */
    }
    return json(200, { ok: true, googleUrl: GOOGLE_REVIEW_URL });
  }

  const rating = clampRating(body.rating);
  const comment = String(body.comment || "").trim();
  if (!rating && !comment) return json(400, { error: "Add a rating or a comment." });

  const name = String(body.name || "").trim();
  const contact = String(body.contact || "").trim();
  const source = body.source === "Patient Portal" ? "Patient Portal" : "Care Connect";

  // Only link a patient record if the caller proves a matching session.
  let patientId = null;
  if (body.patientId && body.token) {
    const sess = verify(body.token);
    if (sess && (sess.patientId === body.patientId || (sess.dependentIds || []).includes(body.patientId))) {
      patientId = body.patientId;
    }
  }

  const stars = rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "—";
  const title = `${stars} · ${name || "Patient"} · ${source}`;

  const properties = {
    "Review": W.title(title),
    "Rating": W.num(rating || null),
    "Comment": W.text(comment),
    "Reviewer Name": W.text(name),
    "Contact": W.text(contact),
    "Source": W.sel(source),
    "Status": W.sel(rating && rating <= 3 ? "Follow-up needed" : "New"),
    "Submitted": W.date(new Date().toISOString().slice(0, 10)),
  };
  if (patientId) properties["Patient"] = W.rel([patientId]);

  let created;
  try {
    created = await createPage(REVIEWS_DB, properties);
  } catch (err) {
    return json(502, { error: "Could not save your review — please try again.", detail: String(err).slice(0, 200) });
  }

  return json(200, { ok: true, reviewId: created?.id || null, googleUrl: GOOGLE_REVIEW_URL });
};
