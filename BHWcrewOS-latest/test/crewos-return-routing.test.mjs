import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CrewOS returns signed-in staff to approved internal tools", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf("const SAFE_STANDALONE_NEXT");
  const end = html.indexOf("function redirectToRequestedPage", start);
  assert.ok(start >= 0 && end > start, "return-route policy is present");

  const routePolicy = html.slice(start, end);
  const getRequestedNext = new Function("search", `${routePolicy}\nreturn requestedNext(search);`);
  const encoded = (path) => `?next=${encodeURIComponent(path)}`;

  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list")), "/bhw-patient-monitor-list");
  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list.html")), "/bhw-patient-monitor-list.html");
  assert.equal(
    getRequestedNext(encoded("/bhw-patient-monitor.html?patient=BHW0000")),
    "/bhw-patient-monitor.html?patient=BHW0000",
  );
  assert.equal(getRequestedNext(encoded("/provider/patient-registry.html")), "/provider/patient-registry.html");
  assert.equal(getRequestedNext(encoded("https://example.com/collect")), "");
  assert.equal(getRequestedNext(encoded("//example.com/collect")), "");
  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list/../index.html")), "");

  assert.match(html, /if\(redirectToRequestedPage\(\)\) return;/);
  assert.match(html, /refresh\(\)\.then\(\(\)=>\{ redirectToRequestedPage\(\); \}\)\.catch\(\(\)=>logout\(\)\)/);
});
