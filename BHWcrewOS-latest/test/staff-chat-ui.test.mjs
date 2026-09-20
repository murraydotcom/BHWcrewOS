import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import shell from "../netlify/functions/staff-chat-shell.mjs";
const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
test("all authenticated CrewOS page shells mount the shared launcher, never public/patient shells", async () => {
  let count = 0;
  for (const directory of ["", "provider/"]) {
    for (const name of await readdir(new URL(`../${directory}`, import.meta.url))) {
      if (!name.endsWith(".html") || name.startsWith("staff-chat")) continue;
      const html = await read(directory + name);
      const staff = /crew-provider-gate|bhw-alert-center|crewos_token/.test(html) || ["hq.html", "bhw-staff-guide.html"].includes(name);
      if (staff) { assert.match(html, /staff-chat-launcher\.js/, `${directory}${name}`); count++; }
      else assert.doesNotMatch(html, /staff-chat-launcher\.js/, `${directory}${name}`);
    }
  }
  assert.ok(count >= 40);
});
test("chat shell allows only named staff ancestors and does not contain identity or messages", async () => {
  globalThis.Netlify = { env: { get: () => "https://extra.example.invalid,http://bad.invalid,*" } };
  const result = await shell(new Request("https://crewhq.bhwmedical.org/staff-chat"));
  const csp = result.headers.get("Content-Security-Policy");
  assert.match(csp, /frame-ancestors 'self' https:\/\/rcm.bhwmedical.org/);
  assert.match(csp, /https:\/\/extra.example.invalid/);
  assert.doesNotMatch(csp, /bad.invalid|frame-ancestors \*/);
  assert.equal(result.headers.get("Cache-Control"), "no-store, private");
  assert.match(await result.text(), /Connecting to BHW Staff Chat/);
  assert.equal((await shell(new Request("https://crewhq.bhwmedical.org/staff-chat", { method: "POST" }))).status, 405);
  delete globalThis.Netlify;
});
test("browser safety: no message drafts in storage, source-checked auth handoff, top-level-only launcher", async () => {
  const [client, launcher, signin, notes] = await Promise.all([read("staff-chat-app.mjs"), read("staff-chat-launcher.js"), read("staff-chat-signin.mjs"), read("bhw-requests.html")]);
  assert.match(launcher, /window !== window.top/);
  assert.match(launcher, /event.source !== frame.contentWindow \|\| event.origin !== origin/);
  assert.match(client, /event.source === popup/);
  assert.match(client, /event.origin === location.origin/);
  assert.match(signin, /postMessage\(.+location.origin\)/);
  assert.doesNotMatch(launcher, /postMessage\([^\n]*(?:token|patient|content)/);
  assert.match(client, /text.textContent = message.content/);
  assert.doesNotMatch(client, /localStorage\.|new Notification|requestPermission\(/);
  assert.match(notes, /TEAM_NOTE_DRAFTS/);
  assert.match(notes, /idempotencyKey:draft.pending.idempotencyKey/);
});
