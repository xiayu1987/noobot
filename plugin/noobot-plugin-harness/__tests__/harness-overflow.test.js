/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";

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
    { role: "user", content: "x".repeat(149995) },
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

test("acceptance handler rewrites calls to forced acceptance when overflow remains after pruning", async () => {
  const planningHandler = createPlanningHandler({
    shouldProcessPrimaryToolHooks: () => true,
  });
  const acceptanceHandler = createAcceptanceHandler({
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
    { role: "user", content: "x".repeat(200000) },
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
  assert.equal(agentContext.payload.harness.state.flags.overflowForceAcceptancePending, true);

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
  assert.equal(beforeToolCallsCtx.calls[0].name, "request_task_acceptance");
  assert.deepEqual(beforeToolCallsCtx.calls[0].args, { mode: "forced" });
  const acceptanceLogs = agentContext.payload.harness.logs.acceptance;
  const beforeToolCallsExecutionLog = acceptanceLogs.find((item = {}) =>
    item?.event === "workflow_execution_result" && item?.detail?.point === "before_tool_calls"
  );
  assert.equal(
    beforeToolCallsExecutionLog?.detail?.requestedAction,
    "forced_acceptance_before_tool_calls_rewrite",
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
  assert.equal(beforeToolCallCtx.call.name, "request_task_acceptance");
  assert.deepEqual(beforeToolCallCtx.call.args, { mode: "forced" });
  const beforeToolCallExecutionLog = acceptanceLogs.find((item = {}) =>
    item?.event === "workflow_execution_result" && item?.detail?.point === "before_tool_call"
  );
  assert.equal(
    beforeToolCallExecutionLog?.detail?.requestedAction,
    "forced_acceptance_before_tool_call_rewrite",
  );
});
