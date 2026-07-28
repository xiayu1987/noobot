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
} from "./helpers/guidance-plan-update-threshold-helper.js";

test("guidance summary and planning plan-update thresholds use full-mode defaults", async () => {
  assert.equal(WORKFLOW_PARAMS.planning.summary, undefined);
  assert.equal(WORKFLOW_PARAMS.guidance.summary.turnsThreshold, LLM_SUMMARY_THRESHOLD);
  assert.equal(WORKFLOW_PARAMS.modeThresholds.full.planning.summary, undefined);
  assert.equal(WORKFLOW_PARAMS.modeThresholds.full.guidance.summary.turnsThreshold, FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD);
  assert.equal(WORKFLOW_PARAMS.modeThresholds.full.guidance.analysis.turnsThreshold, FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD);
  assert.equal(
    WORKFLOW_PARAMS.modeThresholds.programming.guidance.analysis.turnsThreshold,
    PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  );
  assert.equal(WORKFLOW_PARAMS.modeThresholds.text.guidance.analysis.turnsThreshold, TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD);
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    scenario: "full",
    counters: {
      summaryTurns: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD + 1,
      planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };

  await guidanceHandler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.logs.guidance.some((item = {}) => item?.event === "summary_scheduled_by_turn_threshold"), true);
  agentContext.payload.harness.state.pending.summary = false;
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });

  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateTurns, 0);
});

test("guidance summary and planning plan-update thresholds use programming-mode overrides", async () => {
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeProgrammingThresholds = createPlanningAgentContext({
    scenario: "programming",
    counters: { summaryTurns: PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD - 1, planUpdateTurns: 3 },
  });
  await guidanceHandler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: beforeProgrammingThresholds },
    meta: {},
  });
  assert.equal(beforeProgrammingThresholds.payload.harness.state.pending.summary, false);
  assert.equal(beforeProgrammingThresholds.payload.harness.state.pending.planRevision, false);

  const atProgrammingThresholds = createPlanningAgentContext({
    scenario: "programming",
    counters: {
      summaryTurns: PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD + 1,
      planUpdateTurns: PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  await guidanceHandler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: atProgrammingThresholds },
    meta: {},
  });
  assert.equal(atProgrammingThresholds.payload.harness.logs.guidance.some((item = {}) => item?.event === "summary_scheduled_by_turn_threshold"), true);
  atProgrammingThresholds.payload.harness.state.pending.summary = false;
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: atProgrammingThresholds },
    meta: {},
  });
  assert.equal(atProgrammingThresholds.payload.harness.state.pending.summary, false);
  assert.equal(atProgrammingThresholds.payload.harness.state.pending.planRevision, true);
  assert.equal(atProgrammingThresholds.payload.harness.state.counters.planUpdateTurns, 0);
});

test("phase acceptance threshold uses programming-mode override", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeProgrammingPhaseAcceptance = createPlanningAgentContext({
    scenario: "programming",
    counters: {
      llmTurns: 0,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  beforeProgrammingPhaseAcceptance.payload.harness.state.flags = {
    planningCaptured: true,
  };
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      agentContext: beforeProgrammingPhaseAcceptance,
    },
    meta: {},
  });
  assert.equal(beforeProgrammingPhaseAcceptance.payload.harness.state.pending.phaseAcceptance, false);

  const atProgrammingPhaseAcceptance = createPlanningAgentContext({
    scenario: "programming",
    counters: {
      llmTurns: 0,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  atProgrammingPhaseAcceptance.payload.harness.state.flags = {
    planningCaptured: true,
  };
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      agentContext: atProgrammingPhaseAcceptance,
    },
    meta: {},
  });
  assert.equal(atProgrammingPhaseAcceptance.payload.harness.state.pending.phaseAcceptance, true);
  assert.equal(atProgrammingPhaseAcceptance.payload.harness.state.counters.phaseAcceptanceTurns, 0);
  const acceptanceLog = atProgrammingPhaseAcceptance.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "phase_acceptance_scheduled_by_turn_threshold",
  );
  assert.equal(acceptanceLog?.detail?.triggerTurns, PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD);
  assert.equal(acceptanceLog?.detail?.thresholdMode, "programming");
});


test("guidance summary and planning plan-update thresholds use text-mode overrides", async () => {
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeTextThresholds = createPlanningAgentContext({
    scenario: "text",
    counters: {
      summaryTurns: TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateTurns: TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 2,
    },
  });
  await guidanceHandler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: beforeTextThresholds },
    meta: {},
  });
  assert.equal(beforeTextThresholds.payload.harness.state.pending.summary, false);
  assert.equal(beforeTextThresholds.payload.harness.state.pending.planRevision, false);

  const atTextThresholds = createPlanningAgentContext({
    scenario: "文本",
    counters: {
      summaryTurns: TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD + 1,
      planUpdateTurns: TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  await guidanceHandler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: atTextThresholds },
    meta: {},
  });
  assert.equal(atTextThresholds.payload.harness.logs.guidance.some((item = {}) => item?.event === "summary_scheduled_by_turn_threshold"), true);
  atTextThresholds.payload.harness.state.pending.summary = false;
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: atTextThresholds },
    meta: {},
  });
  assert.equal(atTextThresholds.payload.harness.state.pending.summary, false);
  assert.equal(atTextThresholds.payload.harness.state.pending.planRevision, true);
  assert.equal(atTextThresholds.payload.harness.state.counters.planUpdateTurns, 0);
});

test("phase acceptance threshold uses text-mode override", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const atTextPhaseAcceptance = createPlanningAgentContext({
    scenario: "text",
    counters: {
      llmTurns: 0,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  atTextPhaseAcceptance.payload.harness.state.flags = {
    planningCaptured: true,
  };
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      agentContext: atTextPhaseAcceptance,
    },
    meta: {},
  });
  assert.equal(atTextPhaseAcceptance.payload.harness.state.pending.phaseAcceptance, true);
  assert.equal(atTextPhaseAcceptance.payload.harness.state.counters.phaseAcceptanceTurns, 0);
  const acceptanceLog = atTextPhaseAcceptance.payload.harness.logs.acceptance.find(
    (item = {}) => item?.event === "phase_acceptance_scheduled_by_turn_threshold",
  );
  assert.equal(acceptanceLog?.detail?.triggerTurns, TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD);
  assert.equal(acceptanceLog?.detail?.thresholdMode, "text");
});

test("planning plan-update threshold keeps pressure while pending plan-update blocks scheduling", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1 },
  });
  agentContext.payload.harness.state.pending.planRevision = true;
  agentContext.payload.harness.state.pending.planRevisionContext = {
    targetMainStepIndexes: [],
  };

  const blockedCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: blockedCtx, meta: {} });
  assert.equal(
    agentContext.payload.harness.state.counters.planUpdateTurns,
    FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  );

  agentContext.payload.harness.state.pending.planRevision = false;
  agentContext.payload.harness.state.pending.planRevisionContext = null;
  const unblockedCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: unblockedCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateTurns, 0);
});

