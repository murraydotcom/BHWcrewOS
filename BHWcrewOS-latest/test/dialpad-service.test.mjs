import assert from "node:assert/strict";
import test from "node:test";
import { createDialpadService, normalizeDialpadEvent } from "../cloud/operations-api/dialpad-service.mjs";

test("Dialpad webhook normalization uses current SMS phone and delivery fields", () => {
  const inbound = normalizeDialpadEvent({
    id: "synthetic-inbound-1",
    direction: "inbound",
    contact: { phone_number: "+15555550199" },
    target: { phone_number: "+15555550100" },
    to_number: ["+15555550100"],
    text: "STOP",
    message_status: "delivered",
    created_date: 1788811200000,
  });
  assert.equal(inbound.kind, "sms");
  assert.equal(inbound.from, "+15555550199");
  assert.equal(inbound.to, "+15555550100");
  assert.equal(inbound.providerStatus, "delivered");

  const delivery = normalizeDialpadEvent({
    id: "synthetic-outbound-1",
    direction: "outbound",
    from_number: "+15555550100",
    to_number: ["+15555550199"],
    message_status: "undelivered",
    message_delivery_result: "rejected_spam",
    created_date: 1788811200000,
  });
  assert.equal(delivery.kind, "delivery-status");
  assert.equal(delivery.providerStatus, "undelivered");
  assert.equal(delivery.providerDetail, "rejected_spam");
});

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
