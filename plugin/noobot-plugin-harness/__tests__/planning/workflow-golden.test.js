/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveGuidancePriorityDecision } from "../src/capabilities/handlers/planning/plan-update-scheduler.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import {
  WORKFLOW_SCHEDULER_ORDER,
  resolveWorkflowActionDecision,
} from "../src/capabilities/handlers/shared/workflow/scheduler.js";

function createAgentContext({
  pending = {},
  flags = {},
} = {}) {
  return {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        state: {
          pending: {
            summary: false,
            guidance: null,
            planRevision: false,
            planRevisionContext: null,
            planRefinement: false,
            planRefinementContext: null,
            phaseAcceptance: false,
            acceptanceSemanticValidation: null,
            ...pending,
          },
          flags: {
            planningCaptured: true,
            summaryByCharsPrompted: false,
            overflowForceAcceptancePending: false,
            ...flags,
          },
          counters: {},
          signals: {},
        },
      },
    },
  };
}

test("golden: guidance outranks summary_overflow and plan_update", () => {
  const decision = resolveGuidancePriorityDecision({
    pending: {
      summary: true,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
    flags: {
      summaryByCharsPrompted: true,
    },
  });
  assert.equal(decision.chosenAction, "guidance");
});

test("golden: guidance outranks plan_update", () => {
  const decision = resolveGuidancePriorityDecision({
    pending: {
      summary: false,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
    flags: {
      summaryByCharsPrompted: false,
    },
  });
  assert.equal(decision.chosenAction, "guidance");
});

test("golden: unified scheduler order stays stable", () => {
  assert.deepEqual(
    WORKFLOW_SCHEDULER_ORDER.map((item = {}) => item.action),
    [
      "forced_acceptance",
      "planning_bootstrap",
      "guidance",
      "plan_update_revision",
      "plan_update_refinement",
      "summary_overflow",
      "summary_turns",
      "phase_acceptance",
      "acceptance_semantic_validation",
      "analysis",
    ],
  );
});

test("golden: simultaneous workflow candidates follow priority order", () => {
  const baseState = {
    pending: {
      summary: true,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
      phaseAcceptance: true,
      analysis: true,
      acceptanceSemanticValidation: { phase: "final" },
    },
    flags: {
      planningCaptured: true,
      summaryByCharsPrompted: true,
    },
  };

  const guidanceFirst = resolveWorkflowActionDecision(baseState);
  assert.equal(guidanceFirst.chosenAction, "guidance");
  assert.deepEqual(guidanceFirst.deferredActions, [
    "plan_update_revision",
    "summary_overflow",
    "phase_acceptance",
    "acceptance_semantic_validation",
    "analysis",
  ]);
  assert.deepEqual(guidanceFirst.blockedActions, ["phase_acceptance", "acceptance_semantic_validation"]);
  assert.deepEqual(guidanceFirst.blockedReasons, [
    "phase_acceptance_blocked_by_guidance",
    "acceptance_semantic_validation_deferred_by_phase_acceptance",
  ]);

  const revisionFirst = resolveWorkflowActionDecision({
    ...baseState,
    pending: { ...baseState.pending, guidance: null },
  });
  assert.equal(revisionFirst.chosenAction, "plan_update_revision");
  assert.deepEqual(revisionFirst.blockedActions, ["phase_acceptance", "acceptance_semantic_validation"]);
  assert.deepEqual(revisionFirst.blockedReasons, [
    "phase_acceptance_blocked_by_plan_update",
    "acceptance_semantic_validation_deferred_by_phase_acceptance",
  ]);

  const phaseFirst = resolveWorkflowActionDecision({
    ...baseState,
    pending: {
      ...baseState.pending,
      guidance: null,
      planRevision: false,
      planRevisionContext: null,
    },
  });
  assert.equal(phaseFirst.chosenAction, "phase_acceptance");
  assert.deepEqual(phaseFirst.blockedActions, ["summary_overflow", "acceptance_semantic_validation"]);
  assert.deepEqual(phaseFirst.blockedReasons, [
    "summary_deferred_by_phase_acceptance",
    "acceptance_semantic_validation_deferred_by_phase_acceptance",
  ]);

  const summaryBeforeAnalysis = resolveWorkflowActionDecision({
    ...baseState,
    pending: {
      ...baseState.pending,
      guidance: null,
      planRevision: false,
      planRevisionContext: null,
      phaseAcceptance: false,
    },
  });
  assert.equal(summaryBeforeAnalysis.chosenAction, "summary_overflow");
  assert.deepEqual(summaryBeforeAnalysis.deferredActions, ["acceptance_semantic_validation", "analysis"]);
  assert.deepEqual(summaryBeforeAnalysis.blockedActions, []);

  const semanticValidationBeforeAnalysis = resolveWorkflowActionDecision({
    ...baseState,
    pending: {
      ...baseState.pending,
      guidance: null,
      planRevision: false,
      planRevisionContext: null,
      phaseAcceptance: false,
      summary: false,
    },
  });
  assert.equal(semanticValidationBeforeAnalysis.chosenAction, "acceptance_semantic_validation");
  assert.deepEqual(semanticValidationBeforeAnalysis.deferredActions, ["analysis"]);
  assert.deepEqual(semanticValidationBeforeAnalysis.blockedActions, []);

  const analysisFirst = resolveWorkflowActionDecision({
    ...baseState,
    pending: {
      ...baseState.pending,
      guidance: null,
      planRevision: false,
      planRevisionContext: null,
      phaseAcceptance: false,
      summary: false,
      acceptanceSemanticValidation: null,
    },
  });
  assert.equal(analysisFirst.chosenAction, "analysis");
  assert.deepEqual(analysisFirst.deferredActions, []);
  assert.deepEqual(analysisFirst.blockedActions, []);
});

test("golden: forced acceptance overrides all simultaneous workflow candidates", () => {
  const decision = resolveWorkflowActionDecision({
    pending: {
      summary: true,
      guidance: { reason: "tool_failures" },
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
      phaseAcceptance: true,
      analysis: true,
      acceptanceSemanticValidation: { phase: "final" },
    },
    flags: {
      planningCaptured: true,
      overflowForceAcceptancePending: true,
    },
  });
  assert.equal(decision.chosenAction, "forced_acceptance");
  assert.deepEqual(decision.deferredActions, [
    "guidance",
    "plan_update_revision",
    "summary_turns",
    "phase_acceptance",
    "acceptance_semantic_validation",
    "analysis",
  ]);
});

test("golden: phase_acceptance can run when only summary is pending", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      phaseAcceptance: true,
    },
  });
  const ctx = { agentContext, messages: [{ role: "user", content: "继续" }] };
  await handler({ capability: "acceptance", point: "before_llm_call", ctx, meta: {} });
  const decisionLog = agentContext.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "workflow_priority_decision" && item?.detail?.point === "before_llm_call",
  );
  assert.equal(decisionLog?.detail?.chosenReason, "phase_acceptance_pending");
  assert.match(
    String(decisionLog?.detail?.chosenReasonLabel || ""),
    /阶段验收|Phase acceptance/i,
  );
});

test("golden: overflow force acceptance wins priority at before_llm_call", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      phaseAcceptance: true,
    },
    flags: {
      overflowForceAcceptancePending: true,
    },
  });
  const ctx = { agentContext, messages: [{ role: "user", content: "继续" }] };
  await handler({ capability: "acceptance", point: "before_llm_call", ctx, meta: {} });
  const decisionLog = agentContext.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "workflow_priority_decision" && item?.detail?.point === "before_llm_call",
  );
  assert.equal(decisionLog?.detail?.chosenAction, "forced_acceptance");
  assert.equal(decisionLog?.detail?.chosenReason, "overflow_force_acceptance");
});

test("golden: planningCaptured=false blocks phase_acceptance execution", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      phaseAcceptance: true,
    },
    flags: {
      planningCaptured: false,
    },
  });
  const ctx = { agentContext, messages: [{ role: "user", content: "继续" }] };
  await handler({ capability: "acceptance", point: "before_llm_call", ctx, meta: {} });
  const decisionLog = agentContext.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "workflow_priority_decision" && item?.detail?.point === "before_llm_call",
  );
  const executionLog = agentContext.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "workflow_execution_result" && item?.detail?.point === "before_llm_call",
  );
  assert.equal(decisionLog?.detail?.chosenReason, "phase_acceptance_blocked");
  assert.equal(executionLog?.detail?.executedPrimary, false);
});
