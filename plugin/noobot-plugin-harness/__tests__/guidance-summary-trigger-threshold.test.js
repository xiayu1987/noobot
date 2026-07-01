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

