import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CrewHQ exposes the protected Website Content workflow", async () => {
  const [hq, page, client] = await Promise.all([
    readFile(new URL("../hq.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-website-content.html", import.meta.url), "utf8"),
    readFile(new URL("../provider/operations-queue.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(hq, /name:'Website Content'.*href:'\/bhw-website-content\.html'/s);
  assert.match(page, /Shade and designated staff/);
  assert.match(page, /Public content only/);
  assert.match(page, /Never place passwords, secret keys, or patient information into ChatGPT/);
  assert.match(page, /Staff can draft\. Publishing is limited to an operations manager or executive/);
  assert.match(page, /Not saved/);
  assert.match(page, /Saving…/);
  assert.match(page, /Saved to BHW Cloud/);
  assert.match(page, /Publish this exact wording to patients\?/);
  assert.match(page, /BHW Medical public site — connection pending/);
  assert.match(client, /listWebsiteContent/);
  assert.match(client, /createWebsiteContent/);
  assert.match(client, /updateWebsiteContent/);
  assert.match(client, /websiteContentAction/);
});
