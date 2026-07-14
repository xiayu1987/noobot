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
      ["user", "历史上下文"],
      ["assistant", "当前增量"],
    ],
  );
  const planContextIndex = capturedPayload.messages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-plan-checklist-context -->"));
  assert.ok(planContextIndex > 1);
  assert.equal(capturedPayload.messages[planContextIndex]?.role, "user");
  const analysisRequest = capturedPayload.messages.find((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-guidance-analysis -->"));
  assert.equal(analysisRequest?.role, "user");
  assert.match(
    String(analysisRequest?.content || ""),
    /根据当前执行结果|current execution result/i,
  );
  assert.match(
    String(analysisRequest?.content || ""),
    /不要自己执行|do not execute/i,
  );
  const responsibilityMessage = capturedPayload.messages.at(-1);
  assert.equal(responsibilityMessage?.role, "user");
  assert.match(String(responsibilityMessage?.content || ""), /分析|analysis/i);
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

test("separate_model skips analysis when trailing assistant tool call has content", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({ pending: { analysis: true } });
  const ctx = {
    messages: [{
      role: "assistant",
      content: "先检查相关代码。",
      tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
    }],
    agentContext,
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "不应调用" };
      },
    },
  };

  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.equal(invocations.length, 0);
  assert.equal(agentContext.payload.harness.state.pending.analysis, true);

  // 追加 tool 结果后，末条带工具调用的 assistant 消息 content 仍非空 -> 仍跳过分析。
  ctx.messages.push({ role: "tool", content: "读取完成", tool_call_id: "call-1" });
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.equal(invocations.length, 0);
  assert.equal(agentContext.payload.harness.state.pending.analysis, true);

  // 仅当该 assistant 工具调用消息 content 为空时才触发分析。
  ctx.messages[0].content = "";
  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.equal(invocations.length, 1);
  assert.equal(agentContext.payload.harness.state.pending.analysis, false);
});

test("separate_model skips analysis for LangChain AIMessage tool call with content", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({ pending: { analysis: true } });
  const aiMessage = {
    content: "先检查真实运行状态。",
    tool_calls: [{ id: "call-langchain", function: { name: "read_file", arguments: "{}" } }],
    _getType: () => "ai",
  };
  const ctx = {
    messages: [
      aiMessage,
      { content: "读取完成", tool_call_id: "call-langchain", _getType: () => "tool" },
    ],
    agentContext,
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "不应调用" };
      },
    },
  };

  await handler({ capability: "guidance", point: "before_llm_call", ctx, meta });

  assert.equal(invocations.length, 0);
  assert.equal(agentContext.payload.harness.state.pending.analysis, true);
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
