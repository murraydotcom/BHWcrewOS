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
  const RESUME_SCOPE_PATTERN = /^[a-f0-9]{64}$/;

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

  function withResumeScope(path, resumeScope) {
    if (!resumeScope) return path;
    if (!RESUME_SCOPE_PATTERN.test(String(resumeScope))) throw new Error("Private resume scope is invalid");
    return `${path}#resume=${resumeScope}`;
  }

  function workbookUrl(ageBandId, resumeScope) {
    const band = getAgeBand(ageBandId);
    if (!band) return "";
    const path = "/patient-resources/charmed-minds/neurodivergence-workbook/" + encodeURIComponent(band.file).replace(/%2F/gi, "/");
    return withResumeScope(path, resumeScope);
  }

  function workbookIndexUrl(resumeScope) {
    return withResumeScope("/patient-resources/charmed-minds/neurodivergence-workbook/", resumeScope);
  }

  async function privateResumeScope(assignmentId, token, cryptoApi) {
    const assignment = String(assignmentId || "");
    const capability = String(token || "");
    const runtimeCrypto = cryptoApi || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    if (!assignment || !capability) throw new Error("Private assignment capability is incomplete");
    if (!runtimeCrypto?.subtle || typeof TextEncoder === "undefined") throw new Error("Private device resume is not supported by this browser");
    const input = new TextEncoder().encode(`bhw-neuro-workbook-v2\u0000${assignment}\u0000${capability}`);
    const digest = await runtimeCrypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

  return Object.freeze({ AGE_BANDS, getAgeBand, addSelectionToPatientLink, selectionFromSearch, workbookUrl, workbookIndexUrl, privateResumeScope, assignedTitle });
}));
