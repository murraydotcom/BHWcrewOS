// netlify/functions/hub-content.js
// Serves the editable content of the BHW Care Connect hub from Notion, so staff
// can change announcements, info blurbs and PDFs/forms from a Notion database
// with no code change or rebuild.
//
// Source: the "🗞️ Care Connect Hub Content" database. Rows with Active checked
// are published; Type splits them into announcements vs resources; Order (then
// Date) controls sort. File uploads return a fresh signed URL on each request,
// so uploaded PDFs keep working; a Link is preferred (permanent).
//
// Env: NOTION_TOKEN (shared), HUB_CONTENT_DB_ID (optional override)
//
// GET -> { announcements:[{tag,date,title,body}], resources:[{tag,title,body,url}] }

const { json, queryDb, DB, P } = require("./_lib");

const CONTENT_DB = process.env.HUB_CONTENT_DB_ID || DB.hubContent;

// A file property returns [{name, file:{url}} | {name, external:{url}}]; take the
// first usable URL. Notion-hosted URLs are signed and refresh each request.
function firstFileUrl(prop) {
  const files = prop?.files || [];
  for (const f of files) {
    const u = f?.external?.url || f?.file?.url;
    if (u) return u;
  }
  return "";
}

// Format an ISO date as "Jul 30" for the announcement line.
function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  try {
    const rows = await queryDb(CONTENT_DB, { property: "Active", checkbox: { equals: true } });

    // Sort: Order asc (blanks last), then Date desc.
    rows.sort((a, b) => {
      const oa = P.num(a.properties?.["Order"]);
      const ob = P.num(b.properties?.["Order"]);
      if (oa !== ob) return (oa ?? 1e9) - (ob ?? 1e9);
      const da = a.properties?.["Date"]?.date?.start || "";
      const db = b.properties?.["Date"]?.date?.start || "";
      return db.localeCompare(da);
    });

    const announcements = [];
    const resources = [];
    for (const pg of rows) {
      const p = pg.properties || {};
      const type = P.sel(p["Type"]);
      const title = P.title(p["Title"]);
      const body = P.text(p["Body"]);
      const tag = P.sel(p["Tag"]);
      const url = (p["Link"]?.url || "").trim() || firstFileUrl(p["File"]);
      if (!title && !body) continue;
      if (type === "Resource / PDF") {
        resources.push({ tag, title, body, url });
      } else {
        announcements.push({ tag, date: shortDate(p["Date"]?.date?.start), title, body });
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Cache at the edge for a minute so the hub is snappy but edits still
        // land quickly.
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
      body: JSON.stringify({ announcements, resources }),
    };
  } catch (err) {
    // Non-fatal: the app falls back to its built-in defaults on any error.
    return json(200, { announcements: [], resources: [], error: String(err).slice(0, 200) });
  }
};
