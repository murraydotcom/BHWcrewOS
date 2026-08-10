// netlify/functions/care-log-import.js — monthly refresh for the Care Management
// Log. Reads the CCM List + APCM billing list, upserts one row per patient per
// program for the CURRENT month (idempotent — keyed by Patient Ctl No + Program
// + month), links each to the Patients Master List, and enriches from the Care
// Management Program Eligibility Dashboard (contact dates, status, coordinator,
// programs). Re-runnable: it never duplicates a month's row and never clobbers
// staff-entered minutes / activities / referrals / follow-up on an update.
//
//   POST { confirm:true }  (crewOS session)   → { ok, month, summary }
//   or header x-setup-secret: <SETUP_SECRET>  (for an automated monthly run)
//
// Sources (Notion database ids):
//   CCM List, APCM billing list, Care Management Program Eligibility Dashboard.

const { DB, queryDb, createPage, updatePage, P, W, getSession, json } = require("./_lib");

const CCM_DB = "77af6cd2e9c4409685dadeff02a2d307";
const APCM_DB = "335580758d3080438484c662fce22ad9";
const ELIG_DB = "5f83291ac81b40ae912a2db4ced8ecb2";
const MASTER_DB = process.env.MASTER_DB_ID || "2cf580758d3080f0825de4bbfb6c7528";

const status = (p) => p?.status?.name || p?.select?.name || "";
const people = (p) => (p?.people || []).map((u) => u.name).filter(Boolean).join(", ");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (last, first) => norm(String(first) + String(last));
const icdJoin = (arr) => arr.map((x) => String(x || "").trim().toUpperCase()).filter(Boolean).join(", ");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  // Auth: a crewOS session with confirm:true, OR the setup secret (automated run).
  let body; try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const secret = event.headers?.["x-setup-secret"] || event.headers?.["X-Setup-Secret"];
  const bySecret = process.env.SETUP_SECRET && secret === process.env.SETUP_SECRET;
  if (!bySecret) {
    const session = getSession(event);
    if (!session) return json(401, { error: "Sign in to crewOS again." });
    if (!body.confirm) return json(400, { error: "Pass confirm:true to run the import." });
  }

  const month = (body.month && /^\d{4}-\d{2}$/.test(body.month)) ? body.month : new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;

  try {
    // ---- reference data ----
    const [masterPages, logPages, eligPages] = await Promise.all([
      queryDb(MASTER_DB), queryDb(DB.careLog), queryDb(ELIG_DB),
    ]);

    const ctlToMaster = new Map();
    for (const pg of masterPages) {
      const ctl = P.text(pg.properties["Patient Ctl No"]);
      if (ctl && !ctlToMaster.has(ctl)) ctlToMaster.set(ctl, pg.id);
    }

    // existing rows this month, keyed ctl|program → pageId (idempotent upsert)
    const existing = new Map();
    for (const pg of logPages) {
      const p = pg.properties;
      if ((P.date(p["Service Month"]) || "").slice(0, 7) !== month) continue;
      const key = `${P.text(p["Patient Ctl No"])}|${P.sel(p["Program"])}`;
      if (key.startsWith("|")) continue;
      existing.set(key, pg.id);
    }

    // eligibility enrichment, keyed by member id and by name
    const enrich = new Map();
    for (const pg of eligPages) {
      const p = pg.properties;
      const rec = {
        lastContact: P.date(p["Last Contact Date"]),
        nextContact: P.date(p["Next Contact Date"]),
        contactStatus: status(p["Contact Status"]),
        programs: P.multi(p["Current Program Status"]).filter((x) => x && x !== "None"),
        coordinator: people(p["Assigned Care Coordinator"]),
      };
      const mid = P.text(p["MemberID"]);
      const nk = nameKey(P.title(p["Patient Last Name"]), P.text(p["Patient First Name"]));
      if (mid) enrich.set(`id:${mid.toLowerCase()}`, rec);
      if (nk) enrich.set(`nm:${nk}`, rec);
    }
    const enrichFor = (memberId, last, first) =>
      (memberId && enrich.get(`id:${String(memberId).toLowerCase()}`)) ||
      enrich.get(`nm:${nameKey(last, first)}`) || null;

    // ---- gather source patients (one per patient per program) ----
    const readBilling = (pages, program) => {
      const byCtl = new Map();
      for (const pg of pages) {
        const p = pg.properties;
        const ctl = P.title(p["Patient Control ID"]);
        if (!ctl || byCtl.has(ctl)) continue; // one row per patient
        byCtl.set(ctl, {
          program, ctl,
          last: P.text(p["PatientLast"]), first: P.text(p["PatientFirst"]),
          icd: icdJoin([P.text(p["DiagnosisCodes10.Principal"]), P.text(p["DiagnosisCodes10.Other1"]),
            P.text(p["DiagnosisCodes10.Other2"]), P.text(p["DiagnosisCodes10.Other3"])]),
          primaryDx: String(P.text(p["DiagnosisCodes10.Principal"]) || "").toUpperCase(),
          member: P.text(p["Insurances.SubscriberID.MemberID"]),
          payer: P.text(p["Insurances.PayerName"]),
        });
      }
      return [...byCtl.values()];
    };
    const patients = [
      ...readBilling(await queryDb(CCM_DB), "CCM"),
      ...readBilling(await queryDb(APCM_DB), "APCM"),
    ];

    // ---- upsert ----
    const summary = { month, created: 0, updated: 0, linked: 0, unmatched: 0, enriched: 0 };
    for (const pt of patients) {
      const masterId = ctlToMaster.get(pt.ctl) || "";
      const en = enrichFor(pt.member, pt.last, pt.first);
      if (masterId) summary.linked++; else summary.unmatched++;
      if (en) summary.enriched++;

      const noteBits = [pt.payer ? `Payer: ${pt.payer}` : "", `source: ${pt.program} list`];
      if (en) {
        if (en.contactStatus) noteBits.push(`contact: ${en.contactStatus}`);
        if (en.coordinator) noteBits.push(`coordinator: ${en.coordinator}`);
        if (en.programs.length) noteBits.push(`programs: ${en.programs.join("/")}`);
      }
      const notes = noteBits.filter(Boolean).join(" · ");

      const key = `${pt.ctl}|${pt.program}`;
      const pageId = existing.get(key);
      if (pageId) {
        // Refresh source-derived + enrichment fields only. Never overwrite the
        // staff's minutes / activities / referrals / follow-up / status.
        const upd = {
          "ICD-10 Codes": W.text(pt.icd),
          "Primary Diagnosis": W.text(pt.primaryDx),
          "Member ID": W.text(pt.member),
          "Notes": W.text(notes),
        };
        if (en && en.lastContact) upd["Last Contact"] = W.date(en.lastContact);
        await updatePage(pageId, upd);
        summary.updated++;
      } else {
        const name = `${pt.last}, ${pt.first}`.trim();
        const props = {
          "Entry": W.title(`${name} — ${pt.program} · ${month}`),
          "Program": W.sel(pt.program),
          "Type": W.sel("Monthly"),
          "Service Month": W.date(monthStart),
          "Status": W.sel("Open"),
          "ICD-10 Codes": W.text(pt.icd),
          "Primary Diagnosis": W.text(pt.primaryDx),
          "Member ID": W.text(pt.member),
          "Patient Ctl No": W.text(pt.ctl),
          "Notes": W.text(notes),
        };
        if (masterId) props["Patient"] = W.rel([masterId]);
        if (en && en.lastContact) props["Last Contact"] = W.date(en.lastContact);
        if (en && en.nextContact) props["Next Follow-up"] = W.date(en.nextContact);
        await createPage(DB.careLog, props);
        summary.created++;
      }
    }

    return json(200, { ok: true, month, summary });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
