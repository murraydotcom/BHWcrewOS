import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8");
const requireFunction = createRequire(new URL("../netlify/functions/ops-data.js", import.meta.url));

function dashboard({ session, unavailable = [], error = null, rollupMinutes = 8 }) {
  const exports = {};
  const reads = [];
  const notionalRestriction = Object.assign(new Error("Synthetic source restriction"), {
    notionStatus: 403,
    notionCode: "restricted_resource",
  });
  const dependencies = {
    "./_lib": { ...requireFunction("./_lib"), getSession: () => session },
    "./lib/operational-store": {
      async queryOperational(key) {
        reads.push(key);
        if (unavailable.includes(key)) throw error || notionalRestriction;
        return key === "resources" ? [{
          id: "synthetic-resource",
          properties: {
            Resource: { title: [{ plain_text: "Synthetic resource" }] },
            Division: { select: { name: "All Divisions" } },
            Link: { url: "https://example.com/resource" },
          },
        }] : [];
      },
    },
    "./lib/cloud-patients": {
      listCloudPatients: async () => [],
      async cloudRequest(path) {
        reads.push(path);
        return path === "/v1/care-management/logs"
          ? { logs: [{ program: "Synthetic program", serviceMonth: new Date().toISOString().slice(0, 7), minutes: rollupMinutes }] }
          : {};
      },
    },
    "./lib/operations-cloud": {
      operationsRequest: async () => ({
        requests: [{ id: "synthetic-request", workflowContext: { kind: "referral" } }],
      }),
    },
  };
  runInNewContext(source, { exports, require: (path) => dependencies[path] ?? requireFunction(path) });
  return { handler: exports.handler, reads };
}

const staff = { staffId: "synthetic-staff", name: "Synthetic staff", access: "Division" };
const owner = { staffId: "39358075-8d30-81a2-9d5a-d2fbca3cf4b5", name: "Synthetic owner", access: "Admin" };
const controls = ["rooms", "schedule", "resources", "crewProjects"];

test("staff dashboard loads during a Notion access restriction with current referral data", async () => {
  const { handler, reads } = dashboard({ session: staff, unavailable: controls });
  const response = await handler({ httpMethod: "GET" });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.unavailableControls, [...controls].sort());
  assert.equal(payload.referrals[0].id, "synthetic-request");
  assert.deepEqual(payload.schedule, []);
  assert.equal(payload.user.canAdminMaster, false);
  assert.equal(payload.adminRollup, null);
  assert.ok(!reads.includes("/v1/care-management/logs"));
});

test("Admin Master remains restricted and approved staff receive the authorized rollup", async () => {
  const event = { httpMethod: "GET", queryStringParameters: { view: "admin-master" } };
  const standard = dashboard({ session: staff, unavailable: controls });
  assert.equal((await standard.handler(event)).statusCode, 403);
  assert.deepEqual(standard.reads, []);
  const allowed = dashboard({ session: owner, unavailable: ["rooms"] });
  const response = await allowed.handler(event);
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.unavailableControls, ["rooms"]);
  assert.equal(payload.resources[0].title, "Synthetic resource");
  assert.deepEqual(payload.adminRollup, { "Synthetic program": 8 });
});

test("healthy controls report no restrictions and unrelated failures retain their error path", async () => {
  const healthy = await dashboard({ session: staff }).handler({ httpMethod: "GET" });
  assert.equal(healthy.statusCode, 200);
  assert.deepEqual(JSON.parse(healthy.body).unavailableControls, []);
  const failed = await dashboard({ session: staff, unavailable: ["schedule"], error: new Error("Synthetic database timeout") })
    .handler({ httpMethod: "GET" });
  assert.equal(failed.statusCode, 500);
});
