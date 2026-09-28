import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  carryForwardClinicalAuditDecisions,
  clinicalAuditSummary,
  parseClinicalAuditReport,
  resolveClinicalAuditFinding,
} from "../engine/clinical-audit.mjs";
import {
  WORKFLOW_STATUS,
  buildEncounterPacket,
  canQueueCharmEntry,
  isProviderReviewStatus,
  summarizeQueue,
} from "../engine/encounter-workflow.mjs";

const REPORT = `⚠️ FIX BEFORE CLOSING (Critical + High)
1. [HIGH] Issue: Hypertension code lacks supporting management | Location: Assessment | Suggested fix: Document only the management that occurred | Supporting source: BHW Documentation Standard (2026)
2. [HIGH] Issue: Medication monitoring needs review | Location: Plan | Suggested fix: Confirm monitoring | Supporting source: BHW Documentation Standard (2026)`;

test("empty audit placeholders do not create provider work", () => {
  const audit = parseClinicalAuditReport(`⚠️ FIX BEFORE CLOSING (Critical + High)
1. [HIGH] Issue: None | Location: None | Suggested fix: None | Supporting source: None`);
  assert.equal(audit.findings.length, 0);
  assert.equal(clinicalAuditSummary(audit).blocking, 0);
});

test("the one-cycle rerun preserves only exact resolved findings", () => {
  let previous = parseClinicalAuditReport(REPORT);
  previous = resolveClinicalAuditFinding(previous, "audit:1", "occurred", {
    providerResponse: "Confirmed during the visit.",
    approvedAddendum: "Hypertension management was addressed during the visit.",
  });
  previous.findings[0].addendumAppliedAt = "2026-09-28T13:00:00.000Z";

  const same = carryForwardClinicalAuditDecisions(parseClinicalAuditReport(REPORT), previous);
  assert.equal(same.findings[0].decision, "occurred");
  assert.equal(same.findings[0].addendumAppliedAt, "2026-09-28T13:00:00.000Z");
  assert.equal(same.findings[1].decision, "pending");

  const changed = carryForwardClinicalAuditDecisions(parseClinicalAuditReport(REPORT.replace(
    "Hypertension code lacks supporting management",
    "Diabetes code lacks supporting management",
  )), previous);
  assert.equal(changed.findings[0].decision, "pending");
});

test("only current-code conflicts block provider approval", () => {
  const conflict = buildEncounterPacket({
    id: "ENC-TIME-CONFLICT",
    visitType: "Established office visit",
    note: "Total provider time was 20 minutes.",
    codes: ["99214"],
    diagnoses: ["I10"],
    providerApproved: true,
    clinicalAudit: { status: "resolved", rawReport: "Audit complete", findings: [] },
  });
  assert.equal(canQueueCharmEntry(conflict).allowed, false);
  assert.match(canQueueCharmEntry(conflict).reasons.join(" "), /coding conflict/i);

  const optional = buildEncounterPacket({
    id: "ENC-OPTIONAL",
    visitType: "Established office visit",
    note: "Hypertension remains uncontrolled. Continue losartan 50 mg daily.",
    codes: ["99213"],
    diagnoses: ["I10"],
    providerApproved: true,
    clinicalAudit: { status: "resolved", rawReport: "Audit complete", findings: [] },
  });
  assert.ok(optional.codingRecommendations.some((item) => item.requiresDecision && item.status === "pending"));
  assert.equal(canQueueCharmEntry(optional).allowed, true);
});

test("My review includes every active provider decision state", () => {
  [
    WORKFLOW_STATUS.AUDIT_REVIEW,
    WORKFLOW_STATUS.CODING_REVIEW,
    WORKFLOW_STATUS.NEEDS_CLARIFICATION,
    WORKFLOW_STATUS.READY_FOR_PROVIDER,
  ].forEach((status) => assert.equal(isProviderReviewStatus(status), true));
  assert.equal(isProviderReviewStatus(WORKFLOW_STATUS.CLOSED), false);

  const now = new Date("2026-09-28T14:00:00.000Z");
  const summary = summarizeQueue([
    { completedAt: now.toISOString(), status: WORKFLOW_STATUS.AUDIT_REVIEW },
    { completedAt: now.toISOString(), status: WORKFLOW_STATUS.CODING_REVIEW },
  ], now);
  assert.equal(summary.ready, 2);
});

test("CrewHQ exposes one correction bundle and keeps optional revenue work nonblocking", async () => {
  const workflow = await readFile(new URL("../provider/workflow-app.mjs", import.meta.url), "utf8");
  assert.match(workflow, /isProviderReviewStatus\(row\.status\)/);
  assert.match(workflow, /id="applyConfirmedCorrections"/);
  assert.match(workflow, /preserveResolvedAudit: true/);
  assert.match(workflow, /Optional revenue review — does not block provider/);
  assert.doesNotMatch(workflow, /id="applyAuditCorrections"/);
  assert.doesNotMatch(workflow, /id="applyCodingCorrections"/);
});

test("CrewHQ Claim Laundering prioritizes the note and pulls documented time", async () => {
  const html = await readFile(new URL("../provider/index.html", import.meta.url), "utf8");
  assert.match(html, /Claim Laundering — Documentation &amp; Coding Review/);
  assert.match(html, /import \{ documentedTotalMinutes \}/);
  assert.match(html, /\$\("minutes"\)\.value = time\.minutes/);
  assert.ok(html.indexOf("<!-- ============ CLINICAL NOTE ============ -->") < html.indexOf("<!-- ============ COVERAGE ============ -->"));
  assert.match(html, /<details class="card"[^>]*>[\s\S]*Documentation coverage reference/);
});
