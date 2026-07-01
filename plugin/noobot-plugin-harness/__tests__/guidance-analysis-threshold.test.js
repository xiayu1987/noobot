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
} from "./helpers/guidance-plan-update-threshold-helper.js";

test("guidance schedules analysis by full-mode turn threshold", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    counters: {
      llmTurns: 0,
      analysisTurns: FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });
  const ctx = {
    messages: [{ role: "user", content: "继续" }],
    agentContext,
  };

  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });

  assert.equal(agentContext.payload.harness.state.pending.analysis, true);
  assert.equal(agentContext.payload.harness.state.counters.analysisTurns, 0);
  const decisionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_priority_decision",
  );
  assert.equal(decisionLog?.detail?.pending?.analysis?.active, true);
  assert.equal(decisionLog?.detail?.triggeredActions?.includes("analysis"), true);
});

test("planning does not schedule guidance analysis", async () => {
  const handler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      analysisTurns: FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });
  const ctx = {
    messages: [{ role: "user", content: "继续" }],
    agentContext,
  };

  await handler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });

  assert.notEqual(agentContext.payload.harness.state.pending.analysis, true);
  assert.equal(agentContext.payload.harness.state.counters.analysisTurns, FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1);
});

test("planning counters consume skipped agent turns without owning analysis turns", async () => {
  const handler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      llmTurns: 1,
      lastPlanningCounterTurn: 1,
      analysisTurns: 1,
      planUpdateTurns: 1,
      phaseAcceptanceTurns: 1,
    },
  });

  await handler({
    capability: "planning",
    point: "before_llm_call",
    ctx: {
      turn: 4,
      messages: [{ role: "user", content: "继续" }],
      agentContext,
    },
    meta: {},
  });

  const counters = agentContext.payload.harness.state.counters;
  assert.equal(counters.llmTurns, 4);
  assert.equal(counters.analysisTurns, 1);
  assert.equal(counters.planUpdateTurns, 4);
  assert.equal(counters.phaseAcceptanceTurns, 4);
  assert.equal(counters.lastPlanningCounterTurn, 4);
});

test("guidance analysis counter consumes skipped turns and ignores same-turn reentry", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    counters: {
      analysisTurns: FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 2,
      lastGuidanceAnalysisCounterTurn: 1,
    },
  });

  const ctx = { turn: 2, messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });

  const counters = agentContext.payload.harness.state.counters;
  assert.equal(counters.analysisTurns, FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1);
  assert.equal(counters.lastGuidanceAnalysisCounterTurn, 2);
});

test("guidance analysis waits for captured main plan before scheduling", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    planText: "",
    counters: {
      analysisTurns: FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
      lastGuidanceAnalysisCounterTurn: 1,
    },
  });
  agentContext.payload.harness.state.flags.planningCaptured = false;

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      turn: 2,
      messages: [{ role: "user", content: "继续" }],
      agentContext,
    },
    meta: {},
  });

  const state = agentContext.payload.harness.state;
  assert.notEqual(state.pending.analysis, true);
  assert.equal(state.counters.analysisTurns, FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1);
  assert.equal(state.counters.lastGuidanceAnalysisCounterTurn, 1);
});

test("guidance analysis does not require captured main plan when planning is disabled", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    planText: "",
    counters: {
      analysisTurns: FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
      lastGuidanceAnalysisCounterTurn: 1,
    },
  });
  agentContext.payload.harness.state.flags.planningCaptured = false;

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      turn: 2,
      messages: [{ role: "user", content: "继续" }],
      agentContext,
    },
    meta: {
      harness: {
        capabilityProfile: {
          planning: { enabled: false },
          acceptance: { enabled: false },
        },
      },
    },
  });

  const state = agentContext.payload.harness.state;
  assert.equal(state.pending.analysis, true);
  assert.equal(state.counters.analysisTurns, 0);
  assert.equal(state.counters.lastGuidanceAnalysisCounterTurn, 2);
});

test("guidance schedules analysis by scenario-specific turn threshold", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeProgrammingThreshold = createAgentContext({
    counters: {
      analysisTurns: PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 2,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: beforeProgrammingThreshold,
    },
    meta: {},
  });
  assert.equal(beforeProgrammingThreshold.payload.harness.state.pending.analysis, false);
  assert.equal(
    beforeProgrammingThreshold.payload.harness.state.counters.analysisTurns,
    PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
  );

  const atProgrammingThreshold = createAgentContext({
    counters: {
      analysisTurns: PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: atProgrammingThreshold,
    },
    meta: {},
  });
  assert.equal(atProgrammingThreshold.payload.harness.state.pending.analysis, true);
  assert.equal(atProgrammingThreshold.payload.harness.state.counters.analysisTurns, 0);
});

test("guidance analysis runtime threshold overrides scenario workflow params", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeRuntimeThreshold = createAgentContext({
    counters: {
      analysisTurns: 2,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: beforeRuntimeThreshold,
    },
    meta: {
      harness: {
        guidance: { analysis: { turnsThreshold: 4 } },
      },
    },
  });

  assert.equal(beforeRuntimeThreshold.payload.harness.state.pending.analysis, false);
  assert.equal(beforeRuntimeThreshold.payload.harness.state.counters.analysisTurns, 3);

  const atRuntimeThreshold = createAgentContext({
    counters: {
      analysisTurns: 3,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: atRuntimeThreshold,
    },
    meta: {
      harness: {
        guidance: { analysis: { turnsThreshold: 4 } },
      },
    },
  });

  assert.equal(atRuntimeThreshold.payload.harness.state.pending.analysis, true);
  assert.equal(atRuntimeThreshold.payload.harness.state.counters.analysisTurns, 0);
});

test("guidance analysis runtime threshold uses persisted intensity mapping 10 to 1 turn", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    counters: {
      analysisTurns: 0,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext,
    },
    meta: {
      harness: {
        // UI analysis intensity 10 is persisted as turnsThreshold 1.
        guidance: { analysis: { turnsThreshold: 1 } },
      },
    },
  });

  assert.equal(agentContext.payload.harness.state.pending.analysis, true);
  assert.equal(agentContext.payload.harness.state.counters.analysisTurns, 0);
  const scheduledLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "guidance_analysis_scheduled_by_turn_threshold",
  );
  assert.equal(scheduledLog?.detail?.triggerTurns, 1);
  assert.equal(scheduledLog?.detail?.thresholdSource, "runtime");
});

test("guidance analysis runtime threshold uses persisted intensity mapping 9 to 2 turns", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeThreshold = createAgentContext({
    counters: {
      analysisTurns: 0,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: beforeThreshold,
    },
    meta: {
      harness: {
        // UI analysis intensity 9 is persisted as turnsThreshold 2.
        guidance: { analysis: { turnsThreshold: 2 } },
      },
    },
  });

  assert.equal(beforeThreshold.payload.harness.state.pending.analysis, false);
  assert.equal(beforeThreshold.payload.harness.state.counters.analysisTurns, 1);

  const atThreshold = createAgentContext({
    counters: {
      analysisTurns: 1,
      planUpdateTurns: 0,
      phaseAcceptanceTurns: 0,
    },
  });

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: {
      runConfig: { scenario: "programming" },
      messages: [{ role: "user", content: "继续" }],
      agentContext: atThreshold,
    },
    meta: {
      harness: {
        // UI analysis intensity 9 is persisted as turnsThreshold 2.
        guidance: { analysis: { turnsThreshold: 2 } },
      },
    },
  });

  assert.equal(atThreshold.payload.harness.state.pending.analysis, true);
  assert.equal(atThreshold.payload.harness.state.counters.analysisTurns, 0);
  const scheduledLog = atThreshold.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "guidance_analysis_scheduled_by_turn_threshold",
  );
  assert.equal(scheduledLog?.detail?.triggerTurns, 2);
  assert.equal(scheduledLog?.detail?.thresholdSource, "runtime");
});

