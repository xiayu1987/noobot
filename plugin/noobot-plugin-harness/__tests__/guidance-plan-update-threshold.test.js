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

const LLM_SUMMARY_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.turnsThreshold;
const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;
const MAX_PLAN_UPDATE_ATTEMPTS = WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts;
const FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.guidance.summary.turnsThreshold;
const FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.guidance.analysis.turnsThreshold;
const PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.guidance.summary.turnsThreshold;
const PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.guidance.analysis.turnsThreshold;
const FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.planning.planUpdate.triggerTurnsThreshold;
const PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.planning.planUpdate.triggerTurnsThreshold;
const FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.acceptance.phase.triggerTurnsThreshold;
const PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.acceptance.phase.triggerTurnsThreshold;
const TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.guidance.summary.turnsThreshold;
const TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.guidance.analysis.turnsThreshold;
const TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.planning.planUpdate.triggerTurnsThreshold;
const TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.acceptance.phase.triggerTurnsThreshold;

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

test("separate_model analysis uses aligned agent context then user request and user responsibility", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedPayload = null;
  const agentContext = createAgentContext({
    pending: {
      analysis: true,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      resolveModelMessages: ({ ctx: resolverCtx = {} } = {}) => [
        ...(resolverCtx.messageBlocks?.history || []),
        ...(resolverCtx.messageBlocks?.incremental || []),
      ],
      capabilityModelInvoker: async (payload = {}) => {
        capturedPayload = payload;
        return { content: "疑点：最近用户目标与执行焦点可能不一致。" };
      },
    },
  };

  const ctx = {
    messages: [{ role: "user", content: "旧ctx消息不应覆盖messageBlocks" }],
    messageBlocks: {
      history: [{ role: "user", content: "历史上下文" }],
      incremental: [{ role: "assistant", content: "当前增量" }],
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.equal(capturedPayload?.purpose, "guidance");
  assert.equal(capturedPayload?.pluginFlow, "analysis");
  assert.equal(capturedPayload?.chain, "auxiliary");
  assert.deepEqual(
    capturedPayload.messages.slice(0, 2).map((item = {}) => [item.role, item.content]),
    [
      ["system", "<!-- harness-plan-checklist-context -->\n【当前完整计划清单】\n1. 主任务"],
      ["user", "历史上下文"],
    ],
  );
  assert.equal(
    capturedPayload.messages.some((item = {}) => item.role === "assistant" && item.content === "当前增量"),
    true,
  );
  const tailMessages = capturedPayload.messages.slice(-2);
  assert.equal(tailMessages[0]?.role, "user");
  assert.match(
    String(tailMessages[0]?.content || ""),
    /根据当前执行结果|current execution result/i,
  );
  assert.equal(tailMessages[1]?.role, "user");
  assert.match(String(tailMessages[1]?.content || ""), /分析|analysis/i);
  assert.equal(agentContext.payload.harness.state.pending.analysis, false);
  assert.equal(
    ctx.messages.some((item = {}) =>
      String(item?.injectedMessageType || "").includes("guidance") &&
      item?.purpose === "guidance" &&
      item?.pluginFlow === "analysis" &&
      item?.chain === "auxiliary" &&
      String(item?.content || "").includes("疑点"),
    ),
    true,
  );
});

test("separate_model guidance pending triggers guidance invoker without analysis flow", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      guidance: "consecutive_failures",
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "建议先确认失败工具的输入参数。" };
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["guidance"]);
  assert.equal(invocations[0]?.pluginFlow, undefined);
  assert.equal(invocations[0]?.chain, undefined);
  assert.equal(agentContext.payload.harness.state.pending.guidance, null);
  assert.equal(agentContext.payload.harness.state.counters.consecutiveToolFailures, 0);
  assert.equal(agentContext.payload.harness.state.counters.totalToolFailures, 0);
  assert.equal(
    ctx.messages.some((item = {}) =>
      item?.purpose === "guidance" &&
      item?.pluginFlow === undefined &&
      String(item?.content || "").includes("建议先确认失败工具"),
    ),
    true,
  );
  const executionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(executionLog?.detail?.requestedAction, "guidance_separate_model");
  assert.equal(executionLog?.detail?.executedPrimary, true);
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

test("inject mode: revision keeps higher priority than overflow summary for cache-friendly flow", async () => {
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
    false,
  );
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    true,
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

test("separate_model simultaneous plan update follows up with summary before analysis", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      analysis: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  agentContext.payload.harness.state.flags.planRefinementEnabled = false;
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_revision") {
          return { content: "1. 主任务\n2. 补充执行" };
        }
        if (payload.pluginFlow === "analysis") {
          return { content: "疑点：计划更新后还有待确认项。" };
        }
        return { content: "小结完成" };
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.deepEqual(
    invocations.map((item = {}) => item.pluginFlow || item.purpose),
    ["planning_revision", "summary"],
  );
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.analysis, true);
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(
    ctx.messages.some((item = {}) => item?.pluginFlow === "analysis" && String(item?.content || "").includes("疑点")),
    false,
  );
  assert.equal(
    ctx.messages.some((item = {}) => item?.purpose === "summary" && String(item?.content || "").includes("小结完成")),
    true,
  );
  const executionLog = agentContext.payload.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(executionLog?.detail?.chosenAction, "plan_update_revision");
  assert.equal(executionLog?.detail?.requestedAction, "plan_update_revision_separate_model");
  assert.equal(executionLog?.detail?.executedPrimary, true);
  assert.equal(executionLog?.detail?.executedFollowup, true);
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


test("planning revision followup uses dynamic programming scenario over initial text scenario", async () => {
  const agentContext = createAgentContext({
    counters: { llmTurns: 16, planUpdateTurns: -100 },
  });
  agentContext.execution = {
    controllers: {
      runtime: {
        runConfig: { scenario: "text" },
        systemRuntime: { runConfig: { scenario: "text" } },
      },
    },
  };
  const ctx = {
    agentContext,
    messages: [{ role: "user", content: "继续修代码" }],
  };
  const revisedPlan = JSON.stringify({
    totalGoal: "修复代码",
    taskOwner: "primary_task_owner",
    taskChecklist: [
      {
        index: 1,
        task: "修改代码并验证",
        owner: "primary_task_owner",
        input: "当前仓库",
        output: "通过测试的代码修改",
        files: { create: [], modify: ["plugin/noobot-plugin-harness/src/index.js"], delete: [] },
      },
    ],
  });
  const meta = {
    harness: {
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "planning_refinement") return { content: "" };
        return {
          content: [
            revisedPlan,
            "[HARNESS_DYNAMIC_POLICY_PROMPT]",
            "scenario = programming",
            "reason = actual user intent is code change",
            "prompt:",
            "Dynamic policy: perform smallest-slice reversible code changes and verify after each step.",
            "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
          ].join("\n"),
        };
      },
    },
  };

  const changed = await runPlanUpdateAfterSummary(ctx, meta);
  assert.equal(changed, true);
  assert.equal(agentContext.payload.harness.dynamicPolicyPrompt?.scenario, "programming");

  const followupMessage = ctx.messages.find((item = {}) =>
    /next_phase_plan_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.match(followupText, /具体推进方式遵守系统场景策略/);
  assert.doesNotMatch(followupText, /\[HARNESS_SCENARIO_POLICY\]/);
  assert.doesNotMatch(followupText, /Dynamic policy: perform smallest-slice reversible code changes and verify after each step/);
  assert.doesNotMatch(followupText, /文本场景批次产出/);
  assert.doesNotMatch(followupText, /建议外部文本拿到就保真消费/);
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

test("guidance summary threshold by turns is independent from plan update attempts", async () => {
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { summaryTurns: FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD + 1, planUpdateAttempts: 0 },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await guidanceHandler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.logs.guidance.some((item = {}) => item?.event === "summary_scheduled_by_turn_threshold"), true);
  agentContext.payload.harness.state.pending.summary = false;
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
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

test("guidance summary threshold by chars is independent from plan update attempts", async () => {
  const guidanceHandler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext();
  const ctx = {
    messages: [{ role: "user", content: "x".repeat(LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD + 1) }],
    agentContext,
  };
  await guidanceHandler({ capability: "guidance", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.logs.guidance.some((item = {}) => item?.event === "summary_scheduled_by_char_threshold"), true);
  agentContext.payload.harness.state.pending.summary = false;
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 0);
});

test("guidance schedules summary after a single model tool burst reaches summary threshold when enabled", async () => {
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
  assert.equal(agentContext.payload.harness.state.pending.summary, false);

  await guidanceHandler({
    capability: "guidance",
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
    agentContext.payload.harness.logs.guidance.some(
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
