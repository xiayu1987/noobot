/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestModelResponse } from "../helpers/public-runtime-fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createGuidanceHandler,
  createAgentContext,
} from "../helpers/guidance-plan-update-threshold-helper.js";

test("separate_model summary uses the canonical checkpoint protocol", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let markedCalled = 0;
  const agentContext = createAgentContext({
    pending: {
      summary: true,
    },
  });
  agentContext.execution = {
    dialogProcessId: "dp-1",
    controllers: { runtime: { systemRuntime: { turnScopeId: "turn-1" } } },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => createTestModelResponse("小结完成"),
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
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
      },
      {
        role: "tool",
        content: '{"toolName":"execute_script","ok":true}',
        tool_call_id: "c1",
        toolName: "execute_script",
      },
    ],
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
  assert.equal(markedCalled, 0);
  assert.equal(ctx.modelContext.messageBlocks.incremental[0].summarized, undefined);
  assert.equal(ctx.modelContext.messageBlocks.incremental[1].summarized, undefined);
  assert.deepEqual(
    new Set(
      agentContext.execution.controllers.runtime.systemRuntime.mainFlowControlInstructions[0]
        .summarizedMessageIds,
    ),
    new Set(
      ctx.modelContext.messageBlocks.incremental
        .slice(0, 2)
        .map((message) => message.additional_kwargs.noobotMessageId),
    ),
  );
});

test("failed separate-model summary remains pending until a checkpoint succeeds", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({ pending: { summary: true } });
  agentContext.execution = {
    dialogProcessId: "dp-1",
    controllers: { runtime: { systemRuntime: { turnScopeId: "turn-1" } } },
  };
  const ctx = {
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
      },
      {
        role: "tool",
        content: '{"ok":true}',
        tool_call_id: "c1",
        toolName: "execute_script",
      },
    ],
    agentContext,
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => {
        const error = new Error("capability model timeout (20ms)");
        error.code = "CAPABILITY_MODEL_TIMEOUT";
        throw error;
      },
    },
  };

  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  assert.equal(agentContext.payload.harness.state.pending.summary, true);
  assert.ok(Array.isArray(agentContext.payload.harness.state.pending.summaryCheckpointMessageIds));
  assert.equal(
    agentContext.payload.harness.logs.guidance.some(
      (entry = {}) => entry.event === "guidance_separate_model_call_failed",
    ),
    true,
  );
});

test("separate_model summary request includes previous summary after complete plan checklist", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedMessages = [];
  const agentContext = createAgentContext({
    planText: "1. 当前完整计划\n1.1 子计划A",
    pending: { summary: true },
  });
  agentContext.payload.harness.summaryText =
    "1. [plan=1][status=done] 上一轮概要\n2. [plan=1.1][status=done] 上一轮概要二";
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
        return createTestModelResponse("1. [plan=1][status=done] 新小结");
      },
    },
  };

  const ctx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-plan-checklist-context -->"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex > checklistIndex, true);
  assert.equal(capturedMessages[checklistIndex]?.role, "user");
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "user");
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  const previousSummaryMessages = capturedMessages.filter((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(previousSummaryMessages.length, 1);
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /1\. \[plan=1\]\[status=done\] 上一轮概要/,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /2\. \[plan=1\.1\]\[status=done\] 上一轮概要二/,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /3\. \[plan=1\.2\]\[status=warn\] 上一轮概要三/,
  );
  assert.equal(
    capturedMessages.some(
      (item = {}) =>
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
        return createTestModelResponse("1. [plan=1][status=done] 新小结");
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
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-plan-checklist-context -->"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "user");
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
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
        if (payload.purpose === "summary") return createTestModelResponse("小结完成");
        return createTestModelResponse("");
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "agent.before_llm_call",
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
