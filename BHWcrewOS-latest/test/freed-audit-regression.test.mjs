import assert from "node:assert/strict";
import test from "node:test";
import { assertClinicalAuditReport, parseClinicalAuditReport } from "../engine/clinical-audit.mjs";

const report = `CLOSURE VERDICT: Close after fixes below
Estimated fix time: 5 min
Recommended risk level: High
FIX BEFORE CLOSING (Critical + High)
1. [HIGH] Issue: Follow-up is incomplete | Location: Plan | Suggested fix: Clarify follow-up | Supporting source: BHW workflow review
STRENGTHEN (Moderate)
1. [MODERATE] Issue: Complete the laterality clarification
Location: Assessment
Suggested fix: Ask the provider which knee was evaluated
Supporting source: Current primary-source verification required
NOTE FOR FUTURE (Low)
None
COMPLETE
- Chief concern is present
CODING AS DOCUMENTED
CPT/HCPCS: 99213 | Exact evidence: "complete assessment of knee pain" | Location: Assessment | Basis: MDM
ICD-10-CM: M25.569
CODING AFTER CONFIRMED CHANGES (review only)
CPT/HCPCS: none
ICD-10-CM: M25.561 | Location: Assessment after fixes | Relationship: replaces M25.569
NEXT ACTION: Provider review`;

test("findings and coding evidence containing section words remain visible", () => {
  assertClinicalAuditReport(report);
  const audit = parseClinicalAuditReport(report);
  assert.equal(audit.findings.length, 2);
  assert.match(audit.findings[0].issue, /incomplete/);
  assert.match(audit.findings[1].issue, /Complete the laterality/);
  assert.deepEqual(audit.codingAsDocumented.cpt, ["99213"]);
  assert.deepEqual(audit.suggestedCodesAfterChanges.icd10, ["M25.561", "M25.569"]);
});

test("empty, generic, and truncated audit responses cannot become clean results", () => {
  for (const text of ["", "Everything looks good", report.split("NOTE FOR FUTURE")[0], report.replace("CODING AS DOCUMENTED", "MISSING CODING SECTION")]) {
    assert.throws(() => assertClinicalAuditReport(text), /incomplete or unreadable/);
  }
});

test("an explicitly clean complete audit is accepted without inventing findings", () => {
  const text = `CLOSURE VERDICT: Ready to close
FIX BEFORE CLOSING (Critical + High)
None
STRENGTHEN (Moderate)
None
NOTE FOR FUTURE (Low)
None
CODING AS DOCUMENTED
CPT/HCPCS: none
ICD-10-CM: none
CODING AFTER CONFIRMED CHANGES (review only)
None`;
  assertClinicalAuditReport(text);
  assert.equal(parseClinicalAuditReport(text).findings.length, 0);
});
