import crypto from "node:crypto";
import { apiError, cleanText, optionalIsoDate } from "./schema.mjs";

export const WEBSITE_CONTENT_SITES = Object.freeze(["care-connect", "bhw-medical"]);
export const WEBSITE_CONTENT_TYPES = Object.freeze(["announcement", "resource", "site-detail"]);
export const WEBSITE_CONTENT_STATUSES = Object.freeze(["draft", "in-review", "published", "archived"]);
export const WEBSITE_CONTENT_TAGS = Object.freeze(["Hours", "Blueprint", "Staff", "Program", "Insurance", "Form", "General"]);
export const WEBSITE_DETAIL_KEYS = Object.freeze([
  "street",
  "cityStateZip",
  "phone",
  "fax",
  "hours",
  "frontDeskHours",
  "openStatus",
]);

const WEBSITE_CONTENT_ID_PATTERN = /^WEB-[A-Za-z0-9-]{12,90}$/;
const PUBLISHER_ROLES = new Set(["operations-manager", "executive"]);

const actorId = (actor = {}) => cleanText(actor.id || actor.staffId || actor.sub, 180, { required: true, field: "staff identity" });
const normalizedRole = (actor = {}) => cleanText(actor.role || "staff", 80).toLowerCase();

function oneOf(value, allowed, field) {
  const normalized = cleanText(value, 80, { required: true, field });
  if (!allowed.includes(normalized)) throw apiError(400, "validation_error", `${field} is not supported`);
  return normalized;
}

function plainText(value, maxLength, field, { required = false } = {}) {
  const text = cleanText(value, maxLength, { required, field });
  if (/<\/?[a-z][^>]*>/i.test(text)) throw apiError(400, "validation_error", `${field} must be plain text`);
  return text;
}

function safePublicUrl(value, field, { required = false } = {}) {
  const text = cleanText(value, 1000, { required, field });
  if (!text) return "";
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    return parsed.toString();
  } catch {
    throw apiError(400, "validation_error", `${field} must be an HTTPS or site-relative URL`);
  }
}

function safeOrder(value) {
  const order = Number(value ?? 100);
  if (!Number.isFinite(order) || order < 0 || order > 9999) throw apiError(400, "validation_error", "order must be between 0 and 9999");
  return Math.round(order);
}

function safeDisplayDate(value) {
  const text = cleanText(value, 20);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))) {
    throw apiError(400, "validation_error", "displayDate must use YYYY-MM-DD");
  }
  return text;
}

function requireNoPhiAttestation(input = {}) {
  if (input.noPhiAttestation !== true) {
    throw apiError(400, "no_phi_attestation_required", "confirm that public website content contains no patient information");
  }
}

export function normalizeWebsiteSiteId(value) {
  return oneOf(cleanText(value, 80).toLowerCase(), WEBSITE_CONTENT_SITES, "siteId");
}

export function requireWebsiteContentId(value) {
  const contentId = cleanText(value, 100, { required: true, field: "contentId" });
  if (!WEBSITE_CONTENT_ID_PATTERN.test(contentId)) throw apiError(400, "validation_error", "contentId is invalid");
  return contentId;
}

export function requireWebsiteContentEditor(actor = {}) {
  actorId(actor);
  return actor;
}

export function requireWebsiteContentPublisher(actor = {}) {
  requireWebsiteContentEditor(actor);
  if (!PUBLISHER_ROLES.has(normalizedRole(actor))) {
    throw apiError(403, "publisher_required", "an operations manager or executive must publish public website content");
  }
  return actor;
}

function normalizedFields(input = {}, existing = {}) {
  const siteId = normalizeWebsiteSiteId(input.siteId ?? existing.siteId);
  const contentType = oneOf(cleanText(input.contentType ?? existing.contentType, 80).toLowerCase(), WEBSITE_CONTENT_TYPES, "contentType");
  const startsAt = optionalIsoDate(input.startsAt ?? existing.startsAt, "startsAt");
  const expiresAt = optionalIsoDate(input.expiresAt ?? existing.expiresAt, "expiresAt");
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw apiError(400, "validation_error", "expiresAt must be after startsAt");
  }

  const fields = {
    siteId,
    contentType,
    contentKey: "",
    tag: "General",
    title: plainText(input.title ?? existing.title, 220, "title"),
    body: plainText(input.body ?? existing.body, 2000, "body"),
    link: "",
    ctaLabel: plainText(input.ctaLabel ?? existing.ctaLabel, 80, "ctaLabel"),
    ctaUrl: safePublicUrl(input.ctaUrl ?? existing.ctaUrl, "ctaUrl"),
    displayDate: safeDisplayDate(input.displayDate ?? existing.displayDate),
    order: safeOrder(input.order ?? existing.order),
    startsAt,
    expiresAt,
    changeSummary: plainText(input.changeSummary ?? existing.changeSummary, 400, "changeSummary"),
  };

  if (contentType === "announcement") {
    fields.title = plainText(fields.title, 220, "title", { required: true });
    fields.body = plainText(fields.body, 2000, "body", { required: true });
    const requestedTag = cleanText(input.tag ?? existing.tag ?? "General", 40);
    fields.tag = oneOf(requestedTag, WEBSITE_CONTENT_TAGS, "tag");
  } else if (contentType === "resource") {
    fields.title = plainText(fields.title, 220, "title", { required: true });
    fields.link = safePublicUrl(input.link ?? existing.link, "link", { required: true });
    const requestedTag = cleanText(input.tag ?? existing.tag ?? "General", 40);
    fields.tag = oneOf(requestedTag, WEBSITE_CONTENT_TAGS, "tag");
  } else {
    fields.contentKey = oneOf(cleanText(input.contentKey ?? existing.contentKey, 80), WEBSITE_DETAIL_KEYS, "contentKey");
    fields.body = plainText(fields.body, 500, "body", { required: true });
    fields.title = plainText(fields.title || fields.contentKey, 220, "title", { required: true });
    fields.ctaLabel = "";
    fields.ctaUrl = "";
  }
  return fields;
}

export function createWebsiteContent(input = {}, actor = {}, { now = new Date(), idFactory } = {}) {
  requireWebsiteContentEditor(actor);
  requireNoPhiAttestation(input);
  const timestamp = new Date(now).toISOString();
  const contentId = idFactory ? idFactory("WEB") : `WEB-${crypto.randomUUID()}`;
  requireWebsiteContentId(contentId);
  return {
    schemaVersion: 1,
    contentId,
    ...normalizedFields(input),
    status: "draft",
    version: 1,
    createdAt: timestamp,
    createdBy: actorId(actor),
    updatedAt: timestamp,
    updatedBy: actorId(actor),
    reviewRequestedAt: "",
    reviewRequestedBy: "",
    publishedAt: "",
    publishedBy: "",
    archivedAt: "",
    archivedBy: "",
  };
}

function expectedVersion(input = {}) {
  const version = Number(input.expectedVersion);
  if (!Number.isInteger(version) || version < 1) throw apiError(400, "expected_version_required", "expectedVersion is required");
  return version;
}

export function updateWebsiteContentDraft(existing = {}, input = {}, actor = {}, { now = new Date() } = {}) {
  requireWebsiteContentEditor(actor);
  requireNoPhiAttestation(input);
  requireWebsiteContentId(existing.contentId);
  if (existing.status !== "draft") throw apiError(409, "draft_required", "return this content to draft before editing it");
  if (expectedVersion(input) !== existing.version) throw apiError(409, "version_conflict", "website content changed; reload before saving");
  return {
    ...existing,
    ...normalizedFields(input, existing),
    version: existing.version + 1,
    updatedAt: new Date(now).toISOString(),
    updatedBy: actorId(actor),
  };
}

export function transitionWebsiteContent(existing = {}, input = {}, actor = {}, { now = new Date() } = {}) {
  requireWebsiteContentId(existing.contentId);
  const action = oneOf(cleanText(input.action, 80).toLowerCase(), ["submit-review", "return-to-draft", "publish", "archive"], "action");
  if (expectedVersion(input) !== existing.version) throw apiError(409, "version_conflict", "website content changed; reload before continuing");
  const timestamp = new Date(now).toISOString();
  const next = { ...existing, version: existing.version + 1, updatedAt: timestamp, updatedBy: actorId(actor) };

  if (action === "submit-review") {
    requireWebsiteContentEditor(actor);
    if (existing.status !== "draft") throw apiError(409, "invalid_transition", "only a draft can be submitted for review");
    next.status = "in-review";
    next.reviewRequestedAt = timestamp;
    next.reviewRequestedBy = actorId(actor);
  } else if (action === "return-to-draft") {
    requireWebsiteContentEditor(actor);
    if (existing.status !== "in-review") throw apiError(409, "invalid_transition", "only content in review can return to draft");
    next.status = "draft";
  } else if (action === "publish") {
    requireWebsiteContentPublisher(actor);
    requireNoPhiAttestation(input);
    if (existing.status !== "in-review") throw apiError(409, "invalid_transition", "content must be reviewed before publishing");
    next.status = "published";
    next.publishedAt = timestamp;
    next.publishedBy = actorId(actor);
  } else {
    requireWebsiteContentPublisher(actor);
    if (existing.status === "archived") throw apiError(409, "invalid_transition", "content is already archived");
    next.status = "archived";
    next.archivedAt = timestamp;
    next.archivedBy = actorId(actor);
  }
  return next;
}

function shortDate(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function projectPublishedWebsiteContent(records = [], siteId, { now = new Date() } = {}) {
  const normalizedSite = normalizeWebsiteSiteId(siteId);
  const nowMs = new Date(now).getTime();
  const managedContentTypes = [...new Set(records
    .filter((record) => record.siteId === normalizedSite && record.publishedAt)
    .map((record) => record.contentType)
    .filter((contentType) => WEBSITE_CONTENT_TYPES.includes(contentType)))];
  const active = records.filter((record) => record.siteId === normalizedSite
    && record.status === "published"
    && (!record.startsAt || Date.parse(record.startsAt) <= nowMs)
    && (!record.expiresAt || Date.parse(record.expiresAt) > nowMs));
  const byDisplayOrder = (left, right) => (left.order - right.order)
    || String(right.publishedAt).localeCompare(String(left.publishedAt));
  const announcements = active.filter((record) => record.contentType === "announcement").sort(byDisplayOrder).map((record) => ({
    contentId: record.contentId,
    tag: record.tag,
    date: shortDate(record.displayDate || record.publishedAt),
    title: record.title,
    body: record.body,
    ctaLabel: record.ctaLabel,
    ctaUrl: record.ctaUrl,
  }));
  const resources = active.filter((record) => record.contentType === "resource").sort(byDisplayOrder).map((record) => ({
    contentId: record.contentId,
    tag: record.tag,
    title: record.title,
    body: record.body,
    url: record.link,
  }));
  const details = active.filter((record) => record.contentType === "site-detail").sort((left, right) => (
    String(right.publishedAt).localeCompare(String(left.publishedAt))
  ));
  const siteInformation = {};
  for (const record of details) {
    if (!(record.contentKey in siteInformation)) siteInformation[record.contentKey] = record.body;
  }
  const updatedAt = active.map((record) => record.publishedAt || record.updatedAt || "").sort().at(-1) || "";
  return {
    schemaVersion: "bhw.public-site-content.v1",
    siteId: normalizedSite,
    available: active.length > 0,
    managedContentTypes,
    updatedAt,
    announcements,
    resources,
    siteInformation,
  };
}

export function websiteContentAudit(record, eventType, actor = {}, occurredAt = new Date().toISOString()) {
  return {
    auditEventId: `AUD-${crypto.randomUUID()}`,
    schemaVersion: 1,
    eventType,
    actorType: "staff",
    actorId: actorId(actor),
    resourceType: "website-content",
    resourceId: record.contentId,
    siteId: record.siteId,
    contentType: record.contentType,
    status: record.status,
    version: record.version,
    occurredAt,
  };
}
