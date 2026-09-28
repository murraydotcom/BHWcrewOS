import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const frontDesk = await readFile(new URL("../bhw-front-desk.html", import.meta.url), "utf8");
const requests = await readFile(new URL("../bhw-requests.html", import.meta.url), "utf8");
const frontDeskApi = await readFile(new URL("../netlify/functions/frontdesk-data.js", import.meta.url), "utf8");

test("Front Desk response cards open the authoritative Patient Request", () => {
  assert.match(frontDesk, /class="inb request-card/);
  assert.match(frontDesk, /data-request-id=/);
  assert.match(frontDesk, /function openRequest\(id,completed=false\)/);
  assert.match(frontDesk, /Open request/);
  assert.match(frontDesk, /View full history/);
  assert.match(frontDesk, /e\.target\.closest\('\.request-card'\)/);
});

test("Front Desk reply composer keeps fast templates and explicit no-PHI confirmation", () => {
  assert.match(frontDesk, /Reply by text/);
  assert.match(frontDesk, /class="quick-reply"/);
  assert.match(frontDesk, /class="no-phi"/);
  assert.match(frontDesk, /noPhiAttestation:true/);
  assert.match(frontDeskApi, /noPhiAttestation !== true/);
  assert.match(frontDesk, /Open conversation history/);
  assert.doesNotMatch(frontDesk, /Good news — your prescription was sent/);
});

test("completed and pre-existing work has a stable review route", () => {
  assert.match(frontDesk, /href="\/bhw-requests\.html\?filter=done"/);
  assert.match(requests, /REQUEST_QUERY\.get\('filter'\)/);
  assert.match(requests, /button\.dataset\.f===FILTER/);
});

test("unmatched Front Desk work connects to one verified existing Registry patient without creating a duplicate", () => {
  assert.match(frontDesk, /Connect existing patient/);
  assert.match(frontDesk, /Confirm and connect/);
  assert.match(frontDesk, /No new patient will be created/);
  assert.match(frontDesk, /action:'link_patient'/);
  assert.match(frontDesk, /Saved to BHW Cloud/);
  assert.match(frontDeskApi, /action: 'link-patient'/);
  assert.match(frontDeskApi, /patientMatchStatus !== 'matched'/);
  assert.doesNotMatch(frontDeskApi, /link_patient[\s\S]{0,500}patient-create/);
});
