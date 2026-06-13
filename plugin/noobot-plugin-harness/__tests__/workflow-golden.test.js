/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveGuidancePriorityDecision } from "../src/capabilities/handlers/planning/plan-update-scheduler.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";

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

test("golden: summary_overflow outranks guidance and plan_update", () => {
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
  assert.equal(decision.chosenAction, "summary_overflow");
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

test("golden: phase_acceptance is blocked when summary is pending", async () => {
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
  assert.equal(decisionLog?.detail?.chosenReason, "phase_acceptance_blocked");
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
