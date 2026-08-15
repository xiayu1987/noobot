/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_ASSESSMENT_PROTOCOL_NAME,
  SECURITY_ASSESSMENT_PROTOCOL_VERSION,
  SECURITY_EVIDENCE_SOURCE,
  SECURITY_RISK_LEVELS,
  classifyResourceRisk,
  classifyToolCallBaselineRisk,
  classifyToolExecutionRisk,
  createSecurityAssessment,
  maxSecurityRiskLevel,
  raiseSecurityAssessment,
  shouldRequireSecurityConfirmation,
  validateSecurityAssessment,
} from "../src/index.js";

test("assessment combines model declaration and the tool profile monotonically", () => {
  assert.deepEqual(SECURITY_RISK_LEVELS, ["low", "medium", "high", "critical"]);
  const initial = createSecurityAssessment({
    toolName: "write_file",
    args: { riskLevel: "low" },
  });
  assert.equal(initial.protocol, SECURITY_ASSESSMENT_PROTOCOL_NAME);
  assert.equal(initial.version, SECURITY_ASSESSMENT_PROTOCOL_VERSION);
  assert.equal(initial.effectiveRiskLevel, "medium");
  const raised = raiseSecurityAssessment(initial, {
    source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
    riskLevel: "critical",
  });
  assert.equal(raised.effectiveRiskLevel, "critical");
  assert.equal(initial.effectiveRiskLevel, "medium");
  assert.equal(Object.isFrozen(raised.evidence), true);
  assert.equal(validateSecurityAssessment(raised).valid, true);
  assert.equal(validateSecurityAssessment({ ...raised, effectiveRiskLevel: "low" }).valid, false);
  assert.throws(
    () =>
      raiseSecurityAssessment(raised, {
        source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
        riskLevel: "low",
      }),
    /sources must be unique/,
  );
});

test("tool, execution, and resource classification use one risk matrix", () => {
  assert.equal(classifyToolCallBaselineRisk({ toolName: "read_file" }), "low");
  assert.equal(classifyToolCallBaselineRisk({ toolName: "write_file" }), "medium");
  assert.equal(
    classifyToolCallBaselineRisk({ toolName: "patch_file", args: { dryRun: true } }),
    "low",
  );
  assert.equal(
    classifyToolExecutionRisk({
      toolName: "execute_script",
      executionView: "workspace_sandbox",
    }),
    "medium",
  );
  assert.equal(
    classifyToolExecutionRisk({
      toolName: "execute_script",
      executionView: "service_host_restricted",
    }),
    "critical",
  );
  assert.equal(classifyResourceRisk({ operation: "read", scope: "workspace" }), "low");
  assert.equal(classifyResourceRisk({ operation: "write", scope: "workspace" }), "medium");
  assert.equal(classifyResourceRisk({ operation: "delete", scope: "workspace" }), "high");
  assert.equal(classifyResourceRisk({ operation: "write", scope: "host" }), "critical");
  assert.equal(maxSecurityRiskLevel("low", "high", "medium"), "high");
});

test("confirmation policy covers the complete risk and preference matrix", () => {
  const levels = ["low", "medium", "high", "critical"];
  const expected = {
    low: [false, false, false, true],
    medium: [false, false, true, true],
    high: [false, true, true, true],
    critical: [true, true, true, true],
  };
  for (const confirmationLevel of levels) {
    levels.forEach((riskLevel, index) => {
      assert.equal(
        shouldRequireSecurityConfirmation({ confirmationLevel, riskLevel }),
        expected[confirmationLevel][index],
      );
    });
  }
  assert.equal(shouldRequireSecurityConfirmation({ enabled: false, riskLevel: "critical" }), false);
});
