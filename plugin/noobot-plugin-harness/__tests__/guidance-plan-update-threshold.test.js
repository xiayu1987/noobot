/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";
import { canAttemptPlanRevision } from "../src/capabilities/handlers/planning/revision-engine.js";
import { runPlanUpdateAfterSummary } from "../src/capabilities/handlers/guidance/model-runner.js";
import { WORKFLOW_PARAMS } from "../src/core/workflow-params.js";

const LLM_SUMMARY_THRESHOLD = WORKFLOW_PARAMS.planning.summary.turnsThreshold;
const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.planning.summary.messageCharsThreshold;
const MAX_PLAN_UPDATE_ATTEMPTS = WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts;
const FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.planning.summary.turnsThreshold;
const PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.planning.summary.turnsThreshold;
const FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.planning.planUpdate.triggerTurnsThreshold;
const PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.planning.planUpdate.triggerTurnsThreshold;
const FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.acceptance.phase.triggerTurnsThreshold;
const PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.acceptance.phase.triggerTurnsThreshold;

function createAgentContext({
  planText = "1. 主任务\n",
  pending = {},
  counters = {},
} = {}) {
  return {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText,
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0, ...counters },
          signals: { successfulToolCount: 1 },
          pending: {
            summary: false,
            guidance: null,
            planRevision: false,
            planRevisionContext: null,
            planRefinement: false,
            planRefinementContext: null,
            ...pending,
          },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
}

function createPlanningAgentContext({ counters = {}, scenario = "full" } = {}) {
  return {
    execution: {
      controllers: {
        runtime: {
          runConfig: { scenario },
        },
      },
    },
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      harness: {
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
        state: {
          counters: { llmTurns: 0, planUpdateAttempts: 0, ...counters },
          pending: {
            summary: false,
            guidance: null,
            planRevision: false,
            planRevisionContext: null,
            planRefinement: false,
            planRefinementContext: null,
          },
        },
      },
    },
  };
}

test("inject mode: when turn-summary and revision are both pending, revision prompt is injected first", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  const meta = { harness: { planningGuidanceMode: "inject", capabilityModelInvoker: null } };

  const firstCtx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: firstCtx, meta });
  const decisionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_priority_decision",
  );
  const executionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(Boolean(decisionLog), true);
  assert.equal(Boolean(executionLog), true);
  assert.equal(decisionLog?.detail?.chosenAction, "plan_update_revision");
  assert.equal(decisionLog?.detail?.mode, "inject");
  assert.equal(executionLog?.detail?.requestedAction, "plan_update_revision_inject");
  assert.equal(executionLog?.detail?.executedPrimary, true);
  assert.equal(executionLog?.detail?.mode, "inject");
  assert.equal(Number.isFinite(Number(executionLog?.detail?.durationMs)), true);
  assert.equal(executionLog?.detail?.retryCount, 0);
  assert.equal(
    firstCtx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-guidance-summary")),
    false,
  );
  assert.equal(
    firstCtx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    true,
  );
  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);

  const secondCtx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: secondCtx, meta });
  assert.equal(
    secondCtx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-guidance-summary")),
    true,
  );
});

test("separate_model mode: when turn-summary and revision are both pending, planning_revision runs before summary", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "小结完成" };
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });
  assert.equal(invocations.length >= 1, true);
  assert.equal(invocations[0]?.purpose, "planning_revision");
  assert.equal(invocations.some((item = {}) => item.purpose === "planning_revision"), true);
  assert.equal(invocations.some((item = {}) => item.purpose === "summary"), true);
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    false,
  );
});

test("separate_model summary uses checkpointed summary scope when marking messages", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let markedCalled = 0;
  const agentContext = createAgentContext({
    pending: {
      summary: true,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({ content: "小结完成" }),
      markMessagesSummarized: ({ messages = [], summaryScope = {} } = {}) => {
        markedCalled += 1;
        assert.equal(Array.isArray(messages), true);
        assert.equal(messages.length, 2);
        assert.equal(summaryScope?.maxMessages, 2);
        assert.equal(summaryScope?.limitToProvidedMessagesOnly, true);
        for (const item of messages) {
          item.summarized = true;
        }
        return messages.length;
      },
    },
  };

  const ctx = {
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
      { role: "tool", content: '{"toolName":"execute_script","ok":true}', tool_call_id: "c1", toolName: "execute_script" },
    ],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });
  assert.equal(markedCalled >= 1, true);
});

test("separate_model summary request includes previous summary after complete plan checklist", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedMessages = [];
  const agentContext = createAgentContext({
    planText: "1. 当前完整计划\n1.1 子计划A",
    pending: { summary: true },
  });
  agentContext.payload.harness.summaryText = "1. [plan=1][status=done] 上一轮概要\n2. [plan=1.1][status=done] 上一轮概要二";
  agentContext.payload.harness.summaryFullText = [
    "[SUMMARY_OVERVIEW]",
    "1. [plan=1][status=done] 上一轮概要",
    "2. [plan=1.1][status=done] 上一轮概要二",
    "3. [plan=1.2][status=warn] 上一轮概要三",
    "[SUMMARY_DETAIL]",
    "- 上一轮详细证据",
    "[SUMMARY_END]",
  ].join("\n");
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "summary") capturedMessages = payload.messages || [];
        return { content: "1. [plan=1][status=done] 新小结" };
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("当前完整计划"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("上一轮详细证据"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex > checklistIndex, true);
  assert.equal(capturedMessages[checklistIndex]?.role, "system");
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "system");
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  const previousSummaryMessages = capturedMessages.filter((item = {}) =>
    String(item?.content || "").includes("harness-previous-summary-context"),
  );
  assert.equal(previousSummaryMessages.length, 1);
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
  assert.match(String(capturedMessages[previousSummaryIndex]?.content || ""), /1\. \[plan=1\]\[status=done\] 上一轮概要/);
  assert.match(String(capturedMessages[previousSummaryIndex]?.content || ""), /2\. \[plan=1\.1\]\[status=done\] 上一轮概要二/);
  assert.match(String(capturedMessages[previousSummaryIndex]?.content || ""), /3\. \[plan=1\.2\]\[status=warn\] 上一轮概要三/);
  assert.equal(
    capturedMessages.some((item = {}) =>
      String(item?.content || "").includes("基于上一轮小结") ||
      String(item?.content || "").includes("previous summary"),
    ),
    true,
  );
});

test("separate_model summary request extracts previous summary relay into standalone system message", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedMessages = [];
  const agentContext = createAgentContext({
    planText: "1. 当前完整计划\n1.1 子计划A",
    pending: { summary: true },
  });
  agentContext.payload.harness.summaryText = "";
  agentContext.payload.harness.summaryFullText = "";
  const previousSummaryRelay = [
    "[来自harness外部模型输出/summary]",
    "[SUMMARY_OVERVIEW]",
    "1. [plan=1][status=done] 上一轮概要",
    "[SUMMARY_DETAIL]",
    "- 仅存在于历史 relay 中的上一轮详细证据",
    "[SUMMARY_END]",
  ].join("\n");
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "summary") capturedMessages = payload.messages || [];
        return { content: "1. [plan=1][status=done] 新小结" };
      },
    },
  };

  const ctx = {
    messages: [
      { role: "user", content: "继续" },
      {
        role: "user",
        content: previousSummaryRelay,
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "separate_model_relay:summary",
      },
    ],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("当前完整计划"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").includes("仅存在于历史 relay 中的上一轮详细证据") &&
      String(item?.content || "").includes("上一次小结"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "system");
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
});

test("inject mode: overflow summary keeps higher priority than revision", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  agentContext.payload.harness.state.flags.summaryByCharsPrompted = true;
  const meta = { harness: { planningGuidanceMode: "inject", capabilityModelInvoker: null } };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-guidance-summary")),
    true,
  );
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    false,
  );
});

test("separate_model mode: pending revision runs by separate model without prompt injection", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_revision") return { content: "" };
        return { content: "" };
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });
  assert.equal(invocations.some((item = {}) => item.purpose === "planning_revision"), true);
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    false,
  );
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
});

test("workflow_execution_result captures errorCode when separate_model guidance fails", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      guidance: "consecutive_failures",
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => {
        throw new Error("model down");
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  const executionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(Boolean(executionLog), true);
  assert.equal(executionLog?.detail?.mode, "separate_model");
  assert.equal(executionLog?.detail?.chosenAction, "guidance");
  assert.equal(executionLog?.detail?.errorCode, "GUIDANCE_SEPARATE_MODEL_CALL_FAILED");
});

test("revision and refinement have independent MAX_PLAN_UPDATE_ATTEMPTS budgets", () => {
  const state = {
    counters: {
      planRevisionAttempts: 0,
      planRefinementAttempts: 0,
    },
  };
  for (let index = 0; index < MAX_PLAN_UPDATE_ATTEMPTS; index += 1) {
    assert.equal(canAttemptPlanRevision({}, state, { increment: true, stage: "revision" }), true);
  }
  assert.equal(state.counters.planRevisionAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(canAttemptPlanRevision({}, state, { increment: false, stage: "revision" }), false);
  assert.equal(canAttemptPlanRevision({}, state, { increment: false, stage: "refinement" }), true);
});



test("planning thresholds use full-mode defaults from modeThresholds", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    scenario: "full",
    counters: {
      llmTurns: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD,
      planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };

  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });

  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateTurns, 0);
});

test("planning thresholds use programming-mode overrides: configured summary and plan-update", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const beforeProgrammingThresholds = createPlanningAgentContext({
    scenario: "programming",
    counters: { llmTurns: PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD - 2, planUpdateTurns: 3 },
  });
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: beforeProgrammingThresholds },
    meta: {},
  });
  assert.equal(beforeProgrammingThresholds.payload.harness.state.pending.summary, false);
  assert.equal(beforeProgrammingThresholds.payload.harness.state.pending.planRevision, false);

  const atProgrammingThresholds = createPlanningAgentContext({
    scenario: "programming",
    counters: {
      llmTurns: PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD,
      planUpdateTurns: PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续任务" }], agentContext: atProgrammingThresholds },
    meta: {},
  });
  assert.equal(atProgrammingThresholds.payload.harness.state.pending.summary, true);
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

test("unified attempts no longer block revision scheduling in planning handler", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateTurns, 0);
});

test("separate_model summary no longer auto-triggers revision", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        return { content: "" };
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["summary"],
  );
  assert.equal(agentContext.payload.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 0);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
});

test("inject refinement-only flow consumes refinement attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: {
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [1] },
    },
    counters: { planRevisionAttempts: 0, planRefinementAttempts: 0, planUpdateAttempts: 0 },
  });
  const meta = { harness: { planningGuidanceMode: "inject", capabilityModelInvoker: null } };

  const beforeCtx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: beforeCtx, meta });
  const afterCtx = {
    messages: beforeCtx.messages,
    ai: { content: "ADD 1.1 细化步骤A" },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: afterCtx, meta });
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, 1);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 1);
});

test("separate_model refinement-only flow runs planning_refinement directly", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: {
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [1] },
    },
    counters: { planRevisionAttempts: 0, planRefinementAttempts: 0, planUpdateAttempts: 0 },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_refinement") return { content: "ADD 1.1 细化步骤A" };
        return { content: "" };
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });

  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["planning_refinement"],
  );
  assert.equal(agentContext.payload.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, 1);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
});

test("runPlanUpdateAfterSummary does not start revision when refinement is already pending", async () => {
  const invocations = [];
  const ctx = {
    agentContext: createAgentContext({
      pending: {
        planRefinement: true,
        planRefinementContext: { targetMainStepIndexes: [1] },
      },
    }),
    messages: [{ role: "user", content: "继续" }],
  };
  const meta = {
    harness: {
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "" };
      },
    },
  };
  const changed = await runPlanUpdateAfterSummary(ctx, meta, "小结完成");
  assert.equal(changed, false);
  assert.deepEqual(invocations.map((item = {}) => item.purpose), []);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
});

test("separate_model skips planning_revision when revision attempts already reached max", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: { summary: true },
    counters: {
      planRevisionAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
      planRefinementAttempts: 0,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "小结完成" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
});

test("separate_model summary does not consume refinement attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
    counters: {
      planRevisionAttempts: 0,
      planRefinementAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        return { content: "" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
  assert.equal(agentContext.payload.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(agentContext.payload.harness.logs.planning.length >= 0, true);
});

test("planning summary threshold by turns is independent from plan update attempts", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { llmTurns: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD, planUpdateAttempts: 0 },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 0);
  const planningLogs = agentContext.payload.harness.logs.planning;
  assert.equal(
    planningLogs.some((item = {}) => item?.event === "workflow_priority_decision"),
    true,
  );
  assert.equal(
    planningLogs.some((item = {}) => item?.event === "workflow_execution_result"),
    true,
  );
});

test("planning summary threshold by chars is independent from plan update attempts", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext();
  const ctx = {
    messages: [{ role: "user", content: "x".repeat(LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD + 1) }],
    agentContext,
  };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 0);
});

test("planning schedules summary after a single model tool burst reaches summary threshold when enabled", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { llmTurns: 1, planUpdateAttempts: 0 },
  });
  const calls = Array.from({ length: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD }, (_item, index) => ({
    id: `call_${index}`,
    name: `tool_${index}`,
    args: {},
  }));

  await planningHandler({
    capability: "planning",
    point: "after_tool_calls",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      calls,
      agentContext,
    },
    meta: { harness: { summaryOnToolBurstThreshold: true } },
  });

  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.flags.summaryByCharsPrompted, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some(
      (item = {}) => item?.event === "summary_scheduled_by_tool_burst_threshold",
    ),
    true,
  );

  const nextCtx = {
    messages: [
      { role: "assistant", content: "", tool_calls: calls },
      ...calls.map((call) => ({
        role: "tool",
        tool_call_id: call.id,
        toolName: call.name,
        content: `{"toolName":"${call.name}","ok":true}`,
      })),
    ],
    agentContext,
  };
  await guidanceHandler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: nextCtx,
    meta: { harness: { planningGuidanceMode: "inject", capabilityModelInvoker: null } },
  });

  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(
    nextCtx.messages.some((msg = {}) =>
      String(msg?.content || "").includes("harness-guidance-summary"),
    ),
    true,
  );
});


test("planning does not schedule tool-burst summary by default", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { llmTurns: 1, planUpdateAttempts: 0 },
  });
  const calls = Array.from({ length: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD }, (_item, index) => ({
    id: `call_default_off_${index}`,
    name: `tool_${index}`,
    args: {},
  }));

  await planningHandler({
    capability: "planning",
    point: "after_tool_calls",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      calls,
      agentContext,
    },
    meta: {},
  });

  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some(
      (item = {}) => item?.event === "summary_scheduled_by_tool_burst_threshold",
    ),
    false,
  );
});

test("planning does not schedule tool-burst summary when summary is already pending or task_summary is returned", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const alreadyPendingContext = createPlanningAgentContext({
    counters: { llmTurns: LLM_SUMMARY_THRESHOLD },
  });
  alreadyPendingContext.payload.harness.state.pending.summary = true;
  const burstCalls = Array.from({ length: LLM_SUMMARY_THRESHOLD }, (_item, index) => ({
    id: `call_pending_${index}`,
    name: `tool_${index}`,
    args: {},
  }));

  await planningHandler({
    capability: "planning",
    point: "after_tool_calls",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      calls: burstCalls,
      agentContext: alreadyPendingContext,
    },
    meta: { harness: { summaryOnToolBurstThreshold: true } },
  });
  assert.equal(
    alreadyPendingContext.payload.harness.logs.planning.some(
      (item = {}) => item?.event === "summary_scheduled_by_tool_burst_threshold",
    ),
    false,
  );

  const taskSummaryContext = createPlanningAgentContext({
    counters: { llmTurns: 1 },
  });
  await planningHandler({
    capability: "planning",
    point: "after_tool_calls",
    ctx: {
      messages: [{ role: "user", content: "继续任务" }],
      calls: [
        { id: "summary_call", name: "task_summary", args: {} },
        ...burstCalls.slice(1),
      ],
      agentContext: taskSummaryContext,
    },
    meta: { harness: { summaryOnToolBurstThreshold: true } },
  });
  assert.equal(taskSummaryContext.payload.harness.state.pending.summary, false);
  assert.equal(
    taskSummaryContext.payload.harness.logs.planning.some(
      (item = {}) => item?.event === "summary_scheduled_by_tool_burst_threshold",
    ),
    false,
  );
});

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
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: firstCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, false);
  assert.equal(
    agentContext.payload.harness.state.counters.phaseAcceptanceTurns,
    FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  );

  agentContext.payload.harness.state.pending.planRevision = false;
  agentContext.payload.harness.state.pending.planRevisionContext = null;
  const secondCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: secondCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, true);
  assert.equal(agentContext.payload.harness.state.counters.phaseAcceptanceTurns, 0);
});


test("separate_model does not auto-run refinement when revision has no main-plan diff", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        return { content: "" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["summary"],
  );
});
