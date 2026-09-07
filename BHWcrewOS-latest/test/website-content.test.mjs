import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createOperationsApp } from "../cloud/operations-api/app.mjs";
import {
  createWebsiteContent,
  projectPublishedWebsiteContent,
  transitionWebsiteContent,
  updateWebsiteContentDraft,
} from "../cloud/operations-api/site-content.mjs";

const NOW = "2026-09-07T14:00:00.000Z";
const SECRET = "synthetic-crew-secret";

function token(role = "front-desk") {
  const now = Math.floor(Date.parse(NOW) / 1000);
  const claims = {
    sub: "crew:synthetic-staff",
    staffId: "synthetic-staff",
    name: "Synthetic Staff",
    role,
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
    iat: now - 30,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

const actorFor = (role = "front-desk") => ({ id: "crew:synthetic-staff", staffId: "synthetic-staff", name: "Synthetic Staff", role });

class MemoryWebsiteRepository {
  constructor() { this.records = new Map(); }
  async createWebsiteContent(input, actor, options) {
    const record = createWebsiteContent(input, actor, options);
    this.records.set(record.contentId, record);
    return record;
  }
  async getWebsiteContent(id) {
    const record = this.records.get(id);
    if (!record) throw Object.assign(new Error("website content was not found"), { status: 404, code: "not_found" });
    return record;
  }
  async listWebsiteContent({ siteId = "care-connect", status = "" } = {}) {
    return [...this.records.values()].filter((record) => record.siteId === siteId && (!status || record.status === status));
  }
  async updateWebsiteContent(id, input, actor, options) {
    const record = updateWebsiteContentDraft(await this.getWebsiteContent(id), input, actor, options);
    this.records.set(id, record);
    return record;
  }
  async transitionWebsiteContent(id, input, actor, options) {
    const record = transitionWebsiteContent(await this.getWebsiteContent(id), input, actor, options);
    this.records.set(id, record);
    return record;
  }
  async publicWebsiteContent(siteId, options) {
    return projectPublishedWebsiteContent([...this.records.values()], siteId, options);
  }
}

function fixture() {
  let sequence = 0;
  const repository = new MemoryWebsiteRepository();
  const app = createOperationsApp({
    repository,
    environment: { CREWOS_OPERATIONS_TOKEN_SECRET: SECRET, ALLOWED_ORIGINS: "https://crew.example.test" },
    now: () => new Date(NOW),
    idFactory: (prefix) => `${prefix}-synthetic-${String(++sequence).padStart(4, "0")}`,
  });
  return { app, repository };
}

function staffRequest(path, { role = "front-desk", method = "GET", body } = {}) {
  return new Request(`https://operations.example.test${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token(role)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const draft = {
  siteId: "care-connect",
  contentType: "announcement",
  tag: "Hours",
  title: "Synthetic office schedule",
  body: "Synthetic office hours for interface testing only.",
  displayDate: "2026-09-07",
  order: 10,
  noPhiAttestation: true,
};

test("signed-in staff can draft and review public content while publishing stays operations-controlled", async () => {
  const { app } = fixture();
  let response = await app(staffRequest("/v1/site-content", { method: "POST", body: draft }));
  assert.equal(response.status, 201);
  let record = (await response.json()).websiteContent;
  assert.equal(record.status, "draft");

  response = await app(staffRequest(`/v1/site-content/${record.contentId}/actions`, {
    method: "POST", body: { action: "submit-review", expectedVersion: record.version },
  }));
  assert.equal(response.status, 200);
  record = (await response.json()).websiteContent;
  assert.equal(record.status, "in-review");

  response = await app(staffRequest(`/v1/site-content/${record.contentId}/actions`, {
    method: "POST", body: { action: "publish", expectedVersion: record.version, noPhiAttestation: true },
  }));
  assert.equal(response.status, 403);

  response = await app(staffRequest(`/v1/site-content/${record.contentId}/actions`, {
    role: "operations-manager",
    method: "POST",
    body: { action: "publish", expectedVersion: record.version, noPhiAttestation: true },
  }));
  assert.equal(response.status, 200);
  record = (await response.json()).websiteContent;
  assert.equal(record.status, "published");
  assert.equal(record.publishedBy, "crew:synthetic-staff");
});

test("public route exposes only currently effective published fields", async () => {
  const { app } = fixture();
  let response = await app(staffRequest("/v1/site-content", { method: "POST", body: draft }));
  let record = (await response.json()).websiteContent;
  response = await app(staffRequest(`/v1/site-content/${record.contentId}/actions`, {
    method: "POST", body: { action: "submit-review", expectedVersion: record.version },
  }));
  record = (await response.json()).websiteContent;
  response = await app(staffRequest(`/v1/site-content/${record.contentId}/actions`, {
    role: "operations-manager",
    method: "POST",
    body: { action: "publish", expectedVersion: record.version, noPhiAttestation: true },
  }));
  assert.equal(response.status, 200);

  response = await app(new Request("https://operations.example.test/v1/public/site-content?siteId=care-connect"));
  assert.equal(response.status, 200);
  const publicBody = await response.json();
  assert.equal(publicBody.available, true);
  assert.deepEqual(publicBody.announcements[0], {
    contentId: record.contentId,
    tag: "Hours",
    date: "Sep 7",
    title: "Synthetic office schedule",
    body: "Synthetic office hours for interface testing only.",
    ctaLabel: "",
    ctaUrl: "",
  });
  assert.equal(JSON.stringify(publicBody).includes("createdBy"), false);
  assert.equal(JSON.stringify(publicBody).includes("publishedBy"), false);
});

test("draft edits require the current version and a no-PHI attestation", () => {
  const record = createWebsiteContent(draft, actorFor(), { now: new Date(NOW), idFactory: () => "WEB-synthetic-0001" });
  assert.throws(() => updateWebsiteContentDraft(record, { ...draft, expectedVersion: 2 }, actorFor(), { now: new Date(NOW) }), /changed; reload/i);
  assert.throws(() => updateWebsiteContentDraft(record, { ...draft, expectedVersion: 1, noPhiAttestation: false }, actorFor(), { now: new Date(NOW) }), /patient information/i);
});

test("scheduled, expired, draft, and archived content never enters the public projection", () => {
  const base = createWebsiteContent(draft, actorFor(), { now: new Date(NOW), idFactory: () => "WEB-synthetic-0001" });
  const review = transitionWebsiteContent(base, { action: "submit-review", expectedVersion: 1 }, actorFor(), { now: new Date(NOW) });
  const published = transitionWebsiteContent(review, { action: "publish", expectedVersion: 2, noPhiAttestation: true }, actorFor("operations-manager"), { now: new Date(NOW) });
  const future = { ...published, contentId: "WEB-synthetic-future", startsAt: "2026-09-08T14:00:00.000Z" };
  const expired = { ...published, contentId: "WEB-synthetic-expired", expiresAt: "2026-09-07T13:59:00.000Z" };
  const archived = { ...published, contentId: "WEB-synthetic-archive", status: "archived" };
  const projection = projectPublishedWebsiteContent([future, expired, archived], "care-connect", { now: new Date(NOW) });
  assert.equal(projection.available, false);
  assert.deepEqual(projection.announcements, []);
});

test("public projection groups resources and uses the newest published practice detail", () => {
  const publish = (input, id, minute) => {
    const created = createWebsiteContent(input, actorFor(), {
      now: new Date(`2026-09-07T13:${minute}:00.000Z`),
      idFactory: () => id,
    });
    const review = transitionWebsiteContent(created, {
      action: "submit-review", expectedVersion: created.version,
    }, actorFor(), { now: new Date(`2026-09-07T13:${Number(minute) + 1}:00.000Z`) });
    return transitionWebsiteContent(review, {
      action: "publish", expectedVersion: review.version, noPhiAttestation: true,
    }, actorFor("operations-manager"), { now: new Date(`2026-09-07T13:${Number(minute) + 2}:00.000Z`) });
  };

  const resource = publish({
    siteId: "care-connect",
    contentType: "resource",
    tag: "Form",
    title: "Synthetic patient form",
    body: "General public form for interface testing.",
    link: "https://mybhw.com/forms/synthetic",
    noPhiAttestation: true,
  }, "WEB-synthetic-resource", "10");
  const olderHours = publish({
    siteId: "care-connect",
    contentType: "site-detail",
    contentKey: "hours",
    title: "Office hours",
    body: "Synthetic old hours",
    noPhiAttestation: true,
  }, "WEB-synthetic-hours-old", "20");
  const currentHours = publish({
    siteId: "care-connect",
    contentType: "site-detail",
    contentKey: "hours",
    title: "Office hours",
    body: "Synthetic current hours",
    noPhiAttestation: true,
  }, "WEB-synthetic-hours-new", "30");

  const projection = projectPublishedWebsiteContent(
    [olderHours, resource, currentHours], "care-connect", { now: new Date(NOW) },
  );
  assert.equal(projection.resources[0].url, "https://mybhw.com/forms/synthetic");
  assert.equal(projection.siteInformation.hours, "Synthetic current hours");
  assert.deepEqual(new Set(projection.managedContentTypes), new Set(["resource", "site-detail"]));
  assert.equal(JSON.stringify(projection).includes("changeSummary"), false);
});

test("public content rejects HTML and non-HTTPS external links", () => {
  assert.throws(() => createWebsiteContent({
    ...draft,
    body: "<strong>Do not render staff HTML</strong>",
  }, actorFor(), { now: new Date(NOW), idFactory: () => "WEB-synthetic-html" }), /plain text/i);
  assert.throws(() => createWebsiteContent({
    ...draft,
    contentType: "resource",
    link: "http://example.test/private.pdf",
  }, actorFor(), { now: new Date(NOW), idFactory: () => "WEB-synthetic-link" }), /HTTPS/i);
});
