/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createGuidanceHandler,
  createPlanningHandler,
  canAttemptPlanRevision,
  runPlanUpdateAfterSummary,
  LLM_SUMMARY_THRESHOLD,
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  MAX_PLAN_UPDATE_ATTEMPTS,
  FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  createAgentContext,
  createPlanningAgentContext,
  WORKFLOW_PARAMS,
} from "../helpers/guidance-plan-update-threshold-helper.js";

test("phase acceptance is deferred (not lost) when same-turn plan update has higher priority", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      llmTurns: 0,
      planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
      phaseAcceptanceTurns: FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  agentContext.payload.harness.state.flags = {
    ...agentContext.payload.harness.state.flags,
    planningCaptured: true,
  };

  const firstCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "agent.before_llm_call", ctx: firstCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, false);
  assert.equal(
    agentContext.payload.harness.state.counters.phaseAcceptanceTurns,
    FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  );

  agentContext.payload.harness.state.pending.planRevision = false;
  agentContext.payload.harness.state.pending.planRevisionContext = null;
  const secondCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "agent.before_llm_call", ctx: secondCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, true);
  assert.equal(agentContext.payload.harness.state.counters.phaseAcceptanceTurns, 0);
});

test("planning and phase acceptance use canonical per-run thresholds", async () => {
  const handler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { llmTurns: 0, planUpdateTurns: 0, phaseAcceptanceTurns: 0 },
  });
  agentContext.payload.harness.state.flags = {
    ...agentContext.payload.harness.state.flags,
    planningCaptured: true,
  };

  await handler({
    capability: "planning",
    point: "agent.before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext },
    meta: {
      harness: {
        planning: { planUpdate: { triggerTurnsThreshold: 1 } },
        acceptance: { phase: { triggerTurnsThreshold: 1 } },
      },
    },
  });

  const planningEvent = agentContext.payload.harness.logs.planning.find(
    (item = {}) => item?.event === "planning_revision_scheduled_by_turn_threshold",
  );
  assert.equal(planningEvent?.detail?.triggerTurns, 1);
  assert.equal(planningEvent?.detail?.thresholdSource, "runtime");
  assert.equal(agentContext.payload.harness.state.counters.phaseAcceptanceTurns, 1);

  agentContext.payload.harness.state.pending.planRevision = false;
  agentContext.payload.harness.state.pending.planRevisionContext = null;
  await handler({
    capability: "planning",
    point: "agent.before_llm_call",
    ctx: { turn: 2, messages: [{ role: "user", content: "继续任务" }], agentContext },
    meta: {
      harness: {
        planning: { planUpdate: { triggerTurnsThreshold: 99 } },
        acceptance: { phase: { triggerTurnsThreshold: 1 } },
      },
    },
  });
  const acceptanceEvent = agentContext.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "phase_acceptance_scheduled_by_turn_threshold",
  );
  assert.equal(acceptanceEvent?.detail?.triggerTurns, 1);
  assert.equal(acceptanceEvent?.detail?.thresholdSource, "runtime");
});
