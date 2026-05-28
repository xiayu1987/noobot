/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";
import { canAttemptPlanRevision } from "../src/capabilities/handlers/guidance/revision-engine.js";
import {
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  LLM_SUMMARY_THRESHOLD,
  MAX_PLAN_UPDATE_ATTEMPTS,
  PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
} from "../src/core/thresholds.js";

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
          pending: { summary: false, guidance: null, planUpdate: false, ...pending },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
}

function createPlanningAgentContext({ counters = {} } = {}) {
  return {
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      harness: {
        state: {
          counters: { llmTurns: 0, planUpdateAttempts: 0, ...counters },
          pending: { summary: false, guidance: null, planUpdate: false },
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
      planUpdate: true,
      planUpdateStage: "revision",
      planUpdateContext: { summaryText: "请先修复再细化", targetMainStepIndexes: [] },
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
  assert.equal(agentContext.payload.harness.state.pending.planUpdate, false);

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
      planUpdate: true,
      planUpdateStage: "revision",
      planUpdateContext: { summaryText: "请先修复再细化", targetMainStepIndexes: [] },
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
  assert.equal(agentContext.payload.harness.state.pending.planUpdate, false);
  assert.equal(
    ctx.messages.some((msg = {}) => String(msg?.content || "").includes("harness-planning-revision")),
    false,
  );
});

test("inject mode: overflow summary keeps higher priority than revision", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      planUpdate: true,
      planUpdateStage: "revision",
      planUpdateContext: { summaryText: "请先修复再细化", targetMainStepIndexes: [] },
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
      planUpdate: true,
      planUpdateStage: "revision",
      planUpdateContext: { summaryText: "", targetMainStepIndexes: [] },
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
  assert.equal(agentContext.payload.harness.state.pending.planUpdate, false);
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

test("revision and refinement share the same MAX_PLAN_UPDATE_ATTEMPTS budget", () => {
  const state = {
    counters: {
      planUpdateAttempts: 0,
    },
  };
  for (let index = 0; index < MAX_PLAN_UPDATE_ATTEMPTS; index += 1) {
    const stage = index % 2 === 0 ? "revision" : "refinement";
    assert.equal(canAttemptPlanRevision({}, state, { increment: true, stage }), true);
  }
  assert.equal(state.counters.planUpdateAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(canAttemptPlanRevision({}, state, { increment: false, stage: "refinement" }), false);
});

test("planning summary threshold by turns is independent from plan update attempts", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: { llmTurns: LLM_SUMMARY_THRESHOLD, planUpdateAttempts: 0 },
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

test("phase acceptance is deferred (not lost) when same-turn plan update has higher priority", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      llmTurns: 0,
      planUpdateTurns: PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
      phaseAcceptanceTurns: PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD - 1,
    },
  });
  agentContext.payload.harness.state.flags = {
    ...agentContext.payload.harness.state.flags,
    planningCaptured: true,
  };

  const firstCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: firstCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planUpdate, true);
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, false);
  assert.equal(
    agentContext.payload.harness.state.counters.phaseAcceptanceTurns,
    PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  );

  agentContext.payload.harness.state.pending.planUpdate = false;
  const secondCtx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx: secondCtx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.phaseAcceptance, true);
  assert.equal(agentContext.payload.harness.state.counters.phaseAcceptanceTurns, 0);
});

test("separate_model summary -> revision -> refinement consumes two shared plan update attempts", async () => {
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
        if (payload.purpose === "planning_revision") return { content: "UPDATE 1 修复后的主任务" };
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
    ["summary", "planning_revision", "planning_refinement"],
  );
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 2);
});

test("inject refinement-only flow also consumes shared plan update attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: {
      planUpdate: true,
      planUpdateStage: "refinement",
      planUpdateContext: { summaryText: "针对 1 细化", targetMainStepIndexes: [1] },
    },
    counters: { planUpdateAttempts: 0 },
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
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 1);
});

test("separate_model skips planning_revision when shared plan update attempts already reached max", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: { summary: true },
    counters: {
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

test("separate_model skips refinement when revision reaches shared max attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
    counters: {
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS - 1,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        if (payload.purpose === "planning_revision") return { content: "UPDATE 1 修复后的主任务" };
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
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary", "planning_revision"]);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item = {}) => item.event === "planning_refinement_skipped_by_max_attempts"),
    true,
  );
});

test("separate_model skips refinement when revision did not change main plans", async () => {
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
        if (payload.purpose === "planning_revision") return { content: "{}" };
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
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary", "planning_revision"]);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item = {}) => item.event === "planning_refinement_skipped_no_main_plan_change"),
    true,
  );
});
