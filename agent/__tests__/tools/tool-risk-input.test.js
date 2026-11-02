/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createToolRiskAssessment, getToolRiskLevel } from "../../src/tools/execution/tool-risk.js";

test("tool risk reads the validated assessment without changing its evidence", () => {
  for (const riskLevel of ["low", "medium", "high", "critical"]) {
    const assessment = createToolRiskAssessment({ name: "read_file", args: { riskLevel } });
    const before = structuredClone(assessment);
    assert.equal(getToolRiskLevel(assessment), assessment.current.effectiveRiskLevel);
    assert.deepEqual(assessment, before);
  }
});

test("tool risk rejects absent, invalid and conflicting assessments without lowering risk", () => {
  const valid = createToolRiskAssessment({ name: "read_file", args: { riskLevel: "critical" } });
  for (const assessment of [
    undefined,
    {},
    { current: null },
    { current: { ...valid.current, effectiveRiskLevel: "unknown" } },
    { current: { ...valid.current, effectiveRiskLevel: "low" } },
    { current: { ...valid.current, evidence: [] } },
  ]) {
    const before = structuredClone(assessment);
    assert.throws(() => getToolRiskLevel(assessment), /invalid security assessment/);
    assert.deepEqual(assessment, before);
  }
});
