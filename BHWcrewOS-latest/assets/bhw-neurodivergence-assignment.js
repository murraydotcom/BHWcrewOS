(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BHWNeuroWorkbook = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AGE_BANDS = Object.freeze([
    Object.freeze({ id: "0-5", label: "Ages 0–5", audience: "Completed by a parent or guardian", file: "Workbook App 0-5.dc.html" }),
    Object.freeze({ id: "6-7", label: "Ages 6–7", audience: "For the young person, with a grown-up nearby", file: "Workbook App 6-7.dc.html" }),
    Object.freeze({ id: "8-12", label: "Ages 8–12", audience: "For the young person", file: "Workbook App 8-12.dc.html" }),
    Object.freeze({ id: "13-18", label: "Ages 13–18", audience: "For the young person", file: "Workbook App 13-18.dc.html" }),
    Object.freeze({ id: "19-29", label: "Ages 19–29", audience: "Adult", file: "Workbook App 19-29.dc.html" }),
    Object.freeze({ id: "30-54", label: "Ages 30–54", audience: "Adult", file: "Workbook App 30-54.dc.html" }),
    Object.freeze({ id: "55+", label: "Ages 55+", audience: "Adult", file: "Workbook App 55plus.dc.html" })
  ]);

  const byId = new Map(AGE_BANDS.map((band) => [band.id, band]));

  function getAgeBand(id) {
    return byId.get(String(id || "").trim()) || null;
  }

  function addSelectionToPatientLink(patientLink, ageBandId, allowAdjustment) {
    const band = getAgeBand(ageBandId);
    if (!band) throw new Error("Select a supported workbook age band");
    const url = new URL(patientLink, "https://crewhq.bhwmedical.org");
    if (url.protocol !== "https:") throw new Error("The private workbook link must use HTTPS");
    if (url.origin !== "https://crewhq.bhwmedical.org") throw new Error("The private workbook link must use the approved CrewHQ origin");
    url.searchParams.set("ageBand", band.id);
    url.searchParams.set("adjustAge", allowAdjustment ? "1" : "0");
    return url.toString();
  }

  function selectionFromSearch(search) {
    const params = new URLSearchParams(search || "");
    const requested = params.get("ageBand");
    return {
      requested,
      band: getAgeBand(requested),
      allowAdjustment: params.get("adjustAge") === "1"
    };
  }

  function workbookUrl(ageBandId) {
    const band = getAgeBand(ageBandId);
    if (!band) return "";
    return "/patient-resources/charmed-minds/neurodivergence-workbook/" + encodeURIComponent(band.file).replace(/%2F/gi, "/");
  }

  function assignedTitle(title, ageBandId) {
    const band = getAgeBand(ageBandId);
    if (!band) throw new Error("Select a supported workbook age band");
    const base = String(title || "").trim();
    if (!base) throw new Error("Enter an assignment title");
    const value = `${base} — ${band.label}`;
    if (value.length > 200) throw new Error("Shorten the workbook assignment title so the age band can be recorded");
    return value;
  }

  return Object.freeze({ AGE_BANDS, getAgeBand, addSelectionToPatientLink, selectionFromSearch, workbookUrl, assignedTitle });
}));
