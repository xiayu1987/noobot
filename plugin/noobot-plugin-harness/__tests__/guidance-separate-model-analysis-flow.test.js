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
  assert.match(
    String(tailMessages[0]?.content || ""),
    /不要自己执行|do not execute/i,
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
