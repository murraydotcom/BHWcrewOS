import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("authenticated CrewHQ pages receive a browser-history Back control and CrewHQ fallback", async () => {
  const [gate, workflow] = await Promise.all([
    readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8"),
    readFile(new URL("../provider/workflow.html", import.meta.url), "utf8"),
  ]);
  assert.match(gate, /installSystemNavigation/);
  assert.match(gate, /data-system-nav="back"/);
  assert.match(gate, /data-system-nav="home"/);
  assert.match(gate, /⌂ CrewHQ/);
  assert.match(gate, /href="\/hq\.html"/);
  assert.match(gate, /window\.navigation\.canGoBack/);
  assert.match(gate, /history\.length > 1/);
  assert.match(gate, /history\.back\(\)/);
  assert.match(gate, /returnToPreviousPage/);
  assert.match(gate, /location\.assign\("\/hq\.html"\)/);
  assert.doesNotMatch(gate, /document\.referrer/);
  assert.doesNotMatch(gate, /bhw_crewhq_navigation_v1/);
  assert.match(gate, /@media print/);
  assert.match(workflow, /crew-provider-gate\.js/);
  assert.doesNotMatch(workflow, /auth-gate\.js/);
});

function executeGate(gate, { canGoBack, historyLength = 1 }) {
  let backHandler;
  const calls = { back: 0, assign: [], replace: [] };
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 })).toString("base64url");
  const storage = new Map([["crewos_token", `${payload}.signature`]]);
  const backControl = {
    addEventListener(type, handler) {
      if (type === "click") backHandler = handler;
    },
  };
  const navigationElement = {
    className: "",
    dataset: {},
    innerHTML: "",
    setAttribute() {},
    querySelector(selector) {
      return selector === '[data-system-nav="back"]' ? backControl : null;
    },
  };
  const document = {
    readyState: "complete",
    querySelector() { return null; },
    createElement(tagName) {
      return tagName === "nav" ? navigationElement : { textContent: "" };
    },
    head: { append() {} },
    body: { append() {} },
  };
  const location = {
    href: "https://crewhq.bhwmedical.org/provider/workflow.html",
    origin: "https://crewhq.bhwmedical.org",
    pathname: "/provider/workflow.html",
    search: "",
    hash: "",
    assign(target) { calls.assign.push(target); },
    replace(target) { calls.replace.push(target); },
  };
  const history = {
    length: historyLength,
    back() { calls.back += 1; },
  };
  const window = canGoBack === undefined ? {} : { navigation: { canGoBack } };
  const sessionStorage = {
    getItem(key) { return storage.get(key) || null; },
    removeItem(key) { storage.delete(key); },
  };
  vm.runInNewContext(gate, { Buffer, Date, URL, atob, document, history, location, sessionStorage, window });
  assert.equal(typeof backHandler, "function");
  backHandler();
  return calls;
}

test("Back follows the actual browser history instead of a stale app page", async () => {
  const gate = await readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8");
  assert.deepEqual(executeGate(gate, { canGoBack: true }), { back: 1, assign: [], replace: [] });
  assert.deepEqual(executeGate(gate, { canGoBack: undefined, historyLength: 3 }), { back: 1, assign: [], replace: [] });
});

test("Back falls through to CrewHQ when the tab has no prior page", async () => {
  const gate = await readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8");
  assert.deepEqual(executeGate(gate, { canGoBack: false, historyLength: 5 }), { back: 0, assign: ["/hq.html"], replace: [] });
  assert.deepEqual(executeGate(gate, { canGoBack: undefined, historyLength: 1 }), { back: 0, assign: ["/hq.html"], replace: [] });
});

test("CrewHQ uses the complete Visit Documentation Assistance and CRISP Flow names", async () => {
  const [index, workflow, crispFlow] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../provider/workflow.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-discharges.html", import.meta.url), "utf8"),
  ]);
  assert.match(index, /onclick="activate\('pg-discharges'\)">CRISP Flow<\/button>/);
  assert.match(index, /id:"pg-discharges", title:"CRISP Flow"/);
  assert.doesNotMatch(index, /Hospital Discharges &amp; TCM|Hospital Discharges & TCM/);
  assert.match(workflow, />Visit Documentation Assistance<\/a>/);
  assert.doesNotMatch(workflow, />Visit Assistance<\/a>/);
  assert.match(crispFlow, /<title>CRISP Flow — Care Management<\/title>/);
  assert.match(crispFlow, /<h1>CRISP Flow<\/h1>/);
  assert.match(crispFlow, />Add to CRISP Flow<\/button>/);
});
