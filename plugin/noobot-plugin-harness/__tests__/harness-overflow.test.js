/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { WORKFLOW_PARAMS } from "../src/core/workflow-params.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";

const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;

test("planning handler prunes oldest tool-call pair after second char-overflow summary round", async () => {
  const planningHandler = createPlanningHandler({
    shouldProcessPrimaryToolHooks: () => true,
  });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      harness: {},
    },
  };
  const messages = [
    { role: "user", content: "x".repeat(LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD - 5) },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "tc1", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "tc1", content: "y".repeat(20), toolName: "read_file" },
  ];

  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.equal(agentContext.payload.harness.state.flags.summaryByCharsPrompted, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);

  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  assert.equal(messages[1].summarized, true);
  assert.equal(messages[2].summarized, true);
  assert.equal(
    agentContext.payload.harness.state.flags.overflowForceAcceptancePending,
    false,
  );
});

test("overflow after harness summary requests agent main-flow final no-tools instead of local forced acceptance", async () => {
  const planningHandler = createPlanningHandler({
    shouldProcessPrimaryToolHooks: () => true,
  });
  const acceptanceHandler = createAcceptanceHandler({
    shouldProcessPrimaryToolHooks: () => true,
  });
  const agentContext = {
    execution: {
      controllers: {
        runtime: {
          systemRuntime: {},
        },
      },
    },
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      harness: {},
    },
  };
  const messages = [
    { role: "user", content: "x".repeat(LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD + 1) },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "tc2", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "tc2", content: "y".repeat(20), toolName: "read_file" },
  ];

  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  await planningHandler({
    capability: "planning",
    point: "before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  assert.equal(agentContext.payload.harness.state.flags.overflowForceAcceptancePending, false);
  assert.equal(agentContext.payload.harness.state.flags.mainFlowFinalNoToolsPending, true);
  assert.equal(
    agentContext.execution.controllers.runtime.systemRuntime.mainFlowControlInstruction?.action,
    "final_no_tools_turn",
  );
  assert.equal(
    agentContext.execution.controllers.runtime.systemRuntime.mainFlowControlInstruction?.reason,
    "context_overflow_after_summary",
  );
  assert.equal(
    agentContext.execution.controllers.runtime.systemRuntime.mainFlowControlInstruction?.source,
    "harness_summary_overflow",
  );

  const beforeToolCallsCtx = {
    agentContext,
    calls: [{ name: "read_file", args: { path: "a.txt" } }],
  };
  await acceptanceHandler({
    capability: "acceptance",
    point: "before_tool_calls",
    ctx: beforeToolCallsCtx,
    meta: {},
  });
  assert.equal(beforeToolCallsCtx.calls.length, 1);
  assert.equal(beforeToolCallsCtx.calls[0].name, "read_file");
  assert.deepEqual(beforeToolCallsCtx.calls[0].args, { path: "a.txt" });
  const acceptanceLogs = agentContext.payload.harness.logs.acceptance;
  const beforeToolCallsExecutionLog = acceptanceLogs.find((item = {}) =>
    item?.event === "workflow_execution_result" && item?.detail?.point === "before_tool_calls"
  );
  assert.equal(
    beforeToolCallsExecutionLog?.detail?.requestedAction,
    "acceptance_tool_guard_before_tool_calls",
  );

  const beforeToolCallCtx = {
    agentContext,
    call: { name: "read_file", args: { path: "b.txt" } },
  };
  await acceptanceHandler({
    capability: "acceptance",
    point: "before_tool_call",
    ctx: beforeToolCallCtx,
    meta: {},
  });
  assert.equal(beforeToolCallCtx.call.name, "read_file");
  assert.deepEqual(beforeToolCallCtx.call.args, { path: "b.txt" });
  const beforeToolCallExecutionLog = acceptanceLogs.find((item = {}) =>
    item?.event === "workflow_execution_result" && item?.detail?.point === "before_tool_call"
  );
  assert.equal(
    beforeToolCallExecutionLog?.detail?.requestedAction,
    "acceptance_tool_guard_before_tool_call",
  );

  const beforeLlmCallCtx = {
    agentContext,
    messages: [{ role: "user", content: "继续处理" }],
  };
  await acceptanceHandler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx: beforeLlmCallCtx,
    meta: {},
  });
  assert.equal(beforeLlmCallCtx.messages.at(-1)?.role, "user");
  assert.equal(beforeLlmCallCtx.messages.at(-1)?.injectedMessage, undefined);
  const beforeLlmCallExecutionLog = acceptanceLogs.find((item = {}) =>
    item?.event === "workflow_execution_result" && item?.detail?.point === "before_llm_call"
  );
  assert.equal(
    beforeLlmCallExecutionLog?.detail?.requestedAction,
    "none",
  );
});
