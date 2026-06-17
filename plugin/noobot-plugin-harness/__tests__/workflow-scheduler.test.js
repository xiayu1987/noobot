/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_ACTION_META,
  WORKFLOW_SCHEDULER_ORDER,
  resolveWorkflowActionDecision,
  resolveWorkflowActionExecutor,
} from "../src/capabilities/handlers/shared/workflow/scheduler.js";

test("workflow scheduler order is described by one flow/subflow config item", () => {
  assert.deepEqual(
    WORKFLOW_SCHEDULER_ORDER.map((item = {}) => `${item.flow}:${item.subflow}:${item.action}`),
    [
      "final_acceptance:forced:forced_acceptance",
      "guidance:failure_recovery:guidance",
      "planning:bootstrap:planning_bootstrap",
      "plan_update:revision:plan_update_revision",
      "plan_update:refinement:plan_update_refinement",
      "phase_acceptance:phase:phase_acceptance",
      "summary:overflow:summary_overflow",
      "summary:turns:summary_turns",
      "phase_acceptance:semantic_validation:acceptance_semantic_validation",
    ],
  );
  assert.equal(WORKFLOW_ACTION_META.plan_update_revision.flow, "plan_update");
  assert.equal(WORKFLOW_ACTION_META.plan_update_revision.subflow, "revision");
  assert.equal(WORKFLOW_ACTION_META.plan_update_revision.executor, "guidance");
});

test("workflow scheduler keeps cache-friendly business order", () => {
  const decision = resolveWorkflowActionDecision({
    pending: {
      summary: true,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
    flags: { summaryByCharsPrompted: true, planningCaptured: true },
  });

  assert.equal(decision.chosenAction, "guidance");
  assert.equal(decision.chosenReason, "pending_guidance");
  assert.deepEqual(decision.deferredActions, ["plan_update_revision", "summary_overflow"]);
  assert.equal(resolveWorkflowActionExecutor(decision.chosenAction), "guidance");
});

test("workflow scheduler lets phase acceptance run before summary when no hard blocker exists", () => {
  const decision = resolveWorkflowActionDecision({
    pending: {
      summary: true,
      phaseAcceptance: true,
    },
    flags: { summaryByCharsPrompted: true, planningCaptured: true },
  });

  assert.equal(decision.chosenAction, "phase_acceptance");
  assert.equal(decision.chosenReason, "phase_acceptance_pending");
  assert.deepEqual(decision.blockedActions, ["summary_overflow"]);
  assert.deepEqual(decision.blockedReasons, ["summary_deferred_by_phase_acceptance"]);
  assert.equal(resolveWorkflowActionExecutor(decision.chosenAction), "acceptance");
});

test("workflow scheduler hard overflow forced acceptance overrides normal actions", () => {
  const decision = resolveWorkflowActionDecision({
    pending: {
      summary: true,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      phaseAcceptance: true,
    },
    flags: {
      summaryByCharsPrompted: true,
      planningCaptured: true,
      overflowForceAcceptancePending: true,
    },
  });

  assert.equal(decision.chosenAction, "forced_acceptance");
  assert.equal(decision.chosenReason, "overflow_force_acceptance");
  assert.equal(resolveWorkflowActionExecutor(decision.chosenAction), "acceptance");
  assert.deepEqual(decision.deferredActions, [
    "guidance",
    "plan_update_revision",
    "phase_acceptance",
    "summary_overflow",
  ]);
});

test("workflow scheduler skips pending plan refinement when refinement is disabled", () => {
  const decision = resolveWorkflowActionDecision({
    pending: {
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [1, 2] },
    },
    flags: {
      planningCaptured: true,
      planRefinementEnabled: false,
    },
  });

  assert.notEqual(decision.chosenAction, "plan_update_refinement");
});
