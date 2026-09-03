import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectCrispPreventiveColumns, sanitizeCrispPreventiveRows } from "../engine/crisp-preventive-upload.mjs";
import { sheetToObjects } from "../engine/xlsx-lite.mjs";
import handler from "../netlify/functions/crisp-preventive-import.mjs";

const SESSION_SECRET = "synthetic-session-secret";
const CLOUD_SECRET = "synthetic-cloud-secret";
const HEADERS = [
  "BHW Patient ID", "First Name", "Last Name", "Date of Birth", "Category", "Code", "Description",
  "Results", "Test Name", "Data Source", "Document Evidence Date", "Event Date", "Facility Name",
];
const VALUES = [
  "BHW0000", "Synthetic", "Patient", "1986-01-01", "Breast cancer screening", "SYNTHETIC-BREAST-SCREEN",
  "SYNTHETIC completed screening", "", "", "CCD", "2026-09-01", "2026-08-15", "Synthetic Maryland Facility",
];

function sessionToken(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    staffId: "synthetic-provider",
    name: "Synthetic Provider",
    role: "Family Nurse Practitioner",
    scope: "clinical",
    authTime: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function post(body, token = sessionToken()) {
  return new Request("https://crewhq.example/api/crisp-preventive-import", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function csvBase64() {
  const csv = [HEADERS, VALUES].map((row) => row.map((value) => `"${value}"`).join(",")).join("\r\n");
  return Buffer.from(csv).toString("base64");
}

test("preventive upload accepts only published evidence and patient identity columns", () => {
  const row = Object.fromEntries(HEADERS.map((header, index) => [header, VALUES[index]]));
  row["Unexpected Clinical Note"] = "must not leave CrewOS";
  const columns = inspectCrispPreventiveColumns([row]);
  assert.deepEqual(columns.missing, []);
  const sanitized = sanitizeCrispPreventiveRows([row]);
  assert.equal(sanitized[0].row["BHW Patient ID"], "BHW0000");
  assert.equal(sanitized[0].row["Event Date"], "2026-08-15");
  assert.equal(Object.hasOwn(sanitized[0].row, "Unexpected Clinical Note"), false);
});

test("xlsx-lite recognizes a Preventive Services header below a report title", () => {
  const strings = ["CRISP Population Explorer", ...HEADERS, ...VALUES];
  const headerCells = HEADERS.map((_, index) => `<c r="${String.fromCharCode(65 + index)}2" t="s"><v>${index + 1}</v></c>`).join("");
  const valueCells = VALUES.map((_, index) => `<c r="${String.fromCharCode(65 + index)}3" t="s"><v>${HEADERS.length + index + 1}</v></c>`).join("");
  const xml = `<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2">${headerCells}</row><row r="3">${valueCells}</row>`;
  const rows = sheetToObjects(xml, strings);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Category, "Breast cancer screening");
  assert.equal(rows[0]["Event Date"], "2026-08-15");
});

test("Netlify intake requires a recent provider clinical session", async () => {
  const priorNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => name === "SESSION_SECRET" ? SESSION_SECRET : "" } };
  try {
    const unsigned = await handler(new Request("https://crewhq.example/api/crisp-preventive-import", { method: "POST" }));
    assert.equal(unsigned.status, 401);
    const stale = await handler(post({ action: "preview" }, sessionToken({ authTime: Date.now() - 16 * 60_000 })));
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).clinicalReauthenticationRequired, true);
    const staff = await handler(post({ action: "preview" }, sessionToken({ role: "Front Desk" })));
    assert.equal(staff.status, 403);
  } finally {
    globalThis.Netlify = priorNetlify;
  }
});

test("Netlify intake parses server-side, drops unexpected columns, and uses the protected RCM bridge", async () => {
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const environment = new Map([
    ["SESSION_SECRET", SESSION_SECRET],
    ["CREWHQ_CLOUD_TOKEN_SECRET", CLOUD_SECRET],
    ["RCM_CLOUD_API_URL", "https://rcm-cloud.example"],
  ]);
  const outbound = [];
  globalThis.Netlify = { env: { get: (name) => environment.get(name) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({
      ok: true,
      saveState: "not-saved",
      previewToken: "synthetic-preview-token",
      preview: { sourceFile: "Preventive.csv", counts: { reviewed: 1, readyToSave: 1, needsAttention: 0 }, records: [{ bhwPatientId: "BHW0000" }], issues: [] },
    });
  };
  try {
    const result = await handler(post({ action: "preview", fileName: "Preventive.csv", fileBase64: csvBase64(), sourceUpdatedAt: "2026-09-03" }));
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(body.rawFileRetained, false);
    assert.equal(outbound[0].url, "https://rcm-cloud.example/v1/crisp/preventive-services/preview");
    assert.equal(outbound[0].body.rows[0].row["BHW Patient ID"], "BHW0000");
    const claims = JSON.parse(Buffer.from(outbound[0].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(claims.aud, "bhw-rcm-cloud");
    assert.equal(claims.scope, "clinical");
    assert.equal(claims.healthRole, "provider");
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("Preventive UI exposes preview, explicit save state, review gate, and Patient 360 connection", async () => {
  const [html, patient360] = await Promise.all([
    readFile(new URL("../provider/preventive.html", import.meta.url), "utf8"),
    readFile(new URL("../provider/patient-360-app.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Preview — no save/);
  assert.match(html, /Saved to BHW Cloud/);
  assert.match(html, /rawFileRetained/);
  assert.match(html, /clinical-login/);
  assert.match(html, /do not create orders or referrals/i);
  assert.match(patient360, /record\.preventiveCare/);
  assert.match(patient360, /Preventive care &amp; health screenings/);
  assert.match(patient360, /no automatic order/i);
});
