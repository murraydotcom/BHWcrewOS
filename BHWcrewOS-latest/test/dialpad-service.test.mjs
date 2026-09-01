import assert from "node:assert/strict";
import test from "node:test";
import { createDialpadService } from "../cloud/operations-api/dialpad-service.mjs";

test("Dialpad SMS uses the authorization header and never places its token in the URL", async () => {
  const calls = [];
  const service = createDialpadService({
    DIALPAD_TOKEN: "synthetic-dialpad-token",
    DIALPAD_FROM: "+15555550100",
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: "synthetic-message-1", status: "accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  await service.sendSms({
    to: "+15555550101",
    text: "BHW Medical Group has an update. Please open your secure patient page.",
    idempotencyKey: "synthetic-send-1",
  });

  assert.equal(calls[0].url, "https://dialpad.com/api/v2/sms");
  assert.equal(calls[0].url.includes("synthetic-dialpad-token"), false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-dialpad-token");
});
