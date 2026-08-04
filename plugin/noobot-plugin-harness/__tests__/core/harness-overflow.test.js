/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { WORKFLOW_PARAMS } from "../../src/core/workflow-params.js";
import { createGuidanceHandler } from "../helpers/context-aware-handler-fixtures.js";

const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;

async function finishGuidanceSummaryRound(guidanceHandler, { messages, agentContext, content = "SUMMARY_DONE" } = {}) {
  await guidanceHandler({
    capability: "guidance",
    point: "agent.after_llm_call",
    ctx: {
      messages,
      ai: { content },
      agentContext,
    },
    meta: {},
  });
}

async function runGuidanceSummaryRound(guidanceHandler, { messages, agentContext, content = "SUMMARY_DONE" } = {}) {
  await guidanceHandler({
    capability: "guidance",
    point: "agent.before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  await finishGuidanceSummaryRound(guidanceHandler, { messages, agentContext, content });
}

test("guidance summary capture leaves tool-call pair unchanged until checkpoint commit", async () => {
  const guidanceHandler = createGuidanceHandler({
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

  await guidanceHandler({
    capability: "guidance",
    point: "agent.before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(agentContext.payload.harness.state.flags.summaryByCharsPrompted, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);

  await finishGuidanceSummaryRound(guidanceHandler, { messages, agentContext });
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);
  assert.equal(
    agentContext.payload.harness.state.flags.overflowForceAcceptancePending,
    false,
  );
});

test("overflow after harness summary schedules the harness summary flow again without marking messages", async () => {
  const guidanceHandler = createGuidanceHandler({
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

  await runGuidanceSummaryRound(guidanceHandler, { messages, agentContext });
  await guidanceHandler({
    capability: "guidance",
    point: "agent.before_llm_call",
    ctx: { messages, agentContext },
    meta: {},
  });
  assert.equal(agentContext.payload.harness.state.flags.overflowForceAcceptancePending, false);
  assert.equal(agentContext.payload.harness.state.flags.mainFlowFinalNoToolsPending, false);
  assert.equal(agentContext.payload.harness.state.pending.summary, false);
  assert.equal(agentContext.payload.harness.state.flags.guidanceSummaryMarkPending, true);
  assert.equal(agentContext.execution.controllers.runtime.systemRuntime.mainFlowControlInstruction, undefined);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);
});
