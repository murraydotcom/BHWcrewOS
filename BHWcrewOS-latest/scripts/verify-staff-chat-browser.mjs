// Isolated local HTTP + browser integration. Every browser request is intercepted;
// no production website, patient record, SMS provider or Google Chat is contacted.
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { StaffChatRepository } from "../cloud/operations-api/staff-chat.mjs";
import { createStaffChatApp } from "../cloud/operations-api/staff-chat-app.mjs";
import shell from "../netlify/functions/staff-chat-shell.mjs";
import { MemoryFirestore } from "../test/helpers/firestore-memory.mjs";
const modulePath = process.env.BHW_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set BHW_PLAYWRIGHT_MODULE to the installed Playwright index.js");
const playwright = await import(pathToFileURL(modulePath));
const { chromium } = playwright.default || playwright;
const root = fileURLToPath(new URL("../", import.meta.url));
const db = new MemoryFirestore(), chat = new StaffChatRepository(db);
const approvedHosts = new Set(["crewhq.bhwmedical.org", "rcm.bhwmedical.org", "onboarding.bhwmedical.org"]);
const environment = { STAFF_CHAT_ENABLED: "true", ALLOWED_ORIGINS: "https://crewhq.bhwmedical.org", CREWOS_OPERATIONS_TOKEN_SECRET: "synthetic-local-test-only" };
globalThis.Netlify = { env: { get: () => "" } };
const app = createStaffChatApp({ chat, environment, baseApp: () => new Response("not found", { status: 404 }) });
function issue(id) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: `crew:synthetic-${id}`, staffId: `synthetic-${id}`, name: `Synthetic ${id === "alpha" ? "Alpha" : "Beta"}`, role: "staff", iss: "bhw-crewhq", aud: "bhw-operations-cloud", iat: now, exp: now + 300 };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", environment.CREWOS_OPERATIONS_TOKEN_SECRET).update(payload).digest("base64url")}`;
}
const server = http.createServer(async (req, res) => {
  const parts = []; for await (const part of req) parts.push(part);
  const url = new URL(req.url, "https://crewhq.bhwmedical.org");
  let response;
  if (url.pathname.startsWith("/v1/staff-chat/")) response = await app(new Request(url, { method: req.method, headers: req.headers, ...(req.method === "POST" ? { body: Buffer.concat(parts) } : {}) }));
  else if (url.pathname === "/staff-chat") response = await shell(new Request(url));
  else if (url.pathname.endsWith("/operations-cloud-config")) response = Response.json({ enabled: true, apiBase: "https://crewhq.bhwmedical.org" });
  else if (url.pathname.endsWith("/operations-cloud-token")) {
    const id = req.headers.authorization?.replace("Bearer ", "");
    response = ["alpha", "beta"].includes(id) ? Response.json({ token: issue(id), expiresIn: 300, role: "staff" }) : Response.json({ error: "Synthetic sign-in required" }, { status: 401 });
  } else {
    const file = resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root) || ![".mjs", ".js", ".css", ".html"].includes(extname(file))) response = new Response("not found", { status: 404 });
    else try { response = new Response(await readFile(file), { headers: { "Content-Type": extname(file) === ".css" ? "text/css" : extname(file) === ".html" ? "text/html" : "text/javascript" } }); } catch { response = new Response("not found", { status: 404 }); }
  }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const local = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BHW_TEST_BROWSER ? { channel: process.env.BHW_TEST_BROWSER } : {}) });
const browserErrors = [], networkHosts = new Set();
let loseNextSaveResponse = false;
async function syntheticContext(id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on("page", (page) => { page.on("pageerror", (error) => browserErrors.push(error.message)); });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()); networkHosts.add(url.hostname);
    if (!approvedHosts.has(url.hostname)) { await route.abort(); return; }
    if (url.pathname.startsWith("/synthetic-")) {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><h1>Synthetic signed-in staff page</h1><p>No patient or real staff data.</p><script src="/staff-chat-launcher.js"></script><script>BHWStaffChat.mount({sessionKey:${JSON.stringify(id)}})</script></body></html>` }); return;
    }
    if (url.pathname === "/crewos") {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><button id="synthetic-login">Sign in synthetic ${id}</button><script>document.getElementById('synthetic-login').onclick=()=>{sessionStorage.setItem('crewos_token',${JSON.stringify(id)});location.href='/staff-chat-signin.html'}</script>` }); return;
    }
    const headers = { ...request.headers() }; delete headers.host;
    const response = await fetch(`${local}${url.pathname}${url.search}`, { method: request.method(), headers, ...(request.postData() ? { body: request.postData() } : {}) });
    const body = Buffer.from(await response.arrayBuffer());
    if (loseNextSaveResponse && request.method() === "POST" && /\/messages$/.test(url.pathname)) { loseNextSaveResponse = false; await route.abort("failed"); return; }
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto("https://rcm.bhwmedical.org/synthetic-one");
  await page.getByRole("button", { name: "Open or close internal staff chat" }).click();
  const panel = page.frameLocator('iframe[title="BHW internal staff chat"]');
  const popupPromise = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Sign in with CrewOS" }).click();
  const popup = await popupPromise; await popup.locator("#synthetic-login").click();
  try { await panel.locator("#identity").waitFor(); }
  catch (error) { console.log("Synthetic panel diagnostics", await page.locator("iframe").evaluate((el) => ({ hidden: el.hidden, style: getComputedStyle(el).cssText, box: el.getBoundingClientRect().toJSON(), host: el.getRootNode().host.getBoundingClientRect().toJSON() }))); throw error; }
  console.log(`Synthetic ${id} signed in through cross-origin host.`);
  assert.equal(await panel.locator("#show-badge").isChecked(), false);
  return { context, page, panel };
}
try {
  const alpha = await syntheticContext("alpha"), beta = await syntheticContext("beta");
  const send = async (side, text) => { await side.panel.locator("#message").fill(text); await side.panel.locator("#no-patient-data").check(); await side.panel.locator("#send").click(); };
  await send(alpha, "Synthetic team check: <script>never executes</script>");
  await alpha.panel.getByText(/Saved to BHW Cloud/).waitFor();
  assert.equal(await alpha.panel.locator(".message p").textContent(), "Synthetic team check: <script>never executes</script>");
  await alpha.panel.locator("#show-badge").check();
  await alpha.panel.getByText("Notification preference saved to BHW Cloud.").waitFor();
  await alpha.page.goto("https://onboarding.bhwmedical.org/synthetic-two");
  await alpha.page.getByRole("button", { name: "Open or close internal staff chat" }).click();
  const firstHrSignIn = alpha.context.waitForEvent("page");
  await alpha.panel.getByRole("button", { name: "Sign in with CrewOS" }).click();
  await (await firstHrSignIn).locator("#synthetic-login").click();
  await alpha.panel.locator("#identity").waitFor();
  await alpha.panel.getByText("Synthetic team check: <script>never executes</script>", { exact: true }).waitFor();
  assert.equal(await alpha.panel.locator("#show-badge").isChecked(), true, "preference follows account between sites");
  loseNextSaveResponse = true;
  await send(alpha, "Synthetic retry must appear once.");
  await alpha.panel.getByText(/Save not confirmed/).waitFor();
  assert.equal(await alpha.panel.locator("#message").getAttribute("readonly"), "");
  await alpha.panel.getByRole("button", { name: "Retry save" }).click();
  await alpha.panel.getByText(/Saved to BHW Cloud/).waitFor();
  assert.equal((await chat.messages({ id: "crew:synthetic-alpha" }, "bhw-team")).messages.filter((row) => row.content === "Synthetic retry must appear once.").length, 1);
  await alpha.panel.getByRole("button", { name: "Message a teammate" }).click();
  await alpha.panel.locator("#people").selectOption("crew:synthetic-beta");
  await alpha.panel.getByRole("button", { name: "Start conversation" }).click();
  await alpha.panel.locator("#rooms option:checked").getByText("Synthetic Beta").waitFor({ state: "attached" });
  await send(alpha, "Synthetic direct message for Beta only.");
  await alpha.panel.getByText(/Saved to BHW Cloud/).waitFor();
  await beta.page.reload(); await beta.panel.locator("#identity").waitFor();
  await beta.panel.locator("#rooms").selectOption({ label: "Synthetic Alpha · new" });
  await beta.panel.getByText("Synthetic direct message for Beta only.", { exact: true }).waitFor();
  await beta.panel.getByRole("button", { name: "Mark read" }).click();
  const output = process.env.BHW_CHAT_SCREENSHOTS || resolve(root, "../staff-chat-verification"); await mkdir(output, { recursive: true });
  await alpha.page.screenshot({ path: resolve(output, "staff-chat-desktop.png"), fullPage: true });
  await alpha.page.setViewportSize({ width: 390, height: 844 });
  await alpha.page.screenshot({ path: resolve(output, "staff-chat-mobile.png"), fullPage: true });
  const frameBox = await alpha.page.locator("iframe").boundingBox(); assert.ok(frameBox.x >= 0 && frameBox.x + frameBox.width <= 390);
  await alpha.page.evaluate(() => window.BHWStaffChat.unmount());
  await alpha.page.locator("iframe").waitFor({ state: "detached" });
  await alpha.page.evaluate(() => window.BHWStaffChat.mount({ sessionKey: "synthetic-other-staff" }));
  await alpha.panel.getByRole("button", { name: "Sign in with CrewOS" }).waitFor();
  assert.equal(await alpha.panel.locator("#identity").count(), 0, "a different host staff account cannot inherit the prior chat identity");
  assert.deepEqual(browserErrors, []);
  assert.ok([...networkHosts].every((host) => approvedHosts.has(host)));
  console.log("PASS: two synthetic staff; actual backend HTTP; popup sign-in; cross-site/page continuity; persisted opt-in; XSS-safe rendering; ambiguous-send retry; DM delivery; explicit read; desktop/mobile layout. No production requests.");
} finally { await browser.close(); server.closeAllConnections(); server.close(); await once(server, "close"); }
