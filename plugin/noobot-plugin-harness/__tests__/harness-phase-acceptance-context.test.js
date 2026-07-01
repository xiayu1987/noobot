/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentHookManager } from "../../../agent/src/system-core/hook/index.js";
import { ModelMessageRuntimeHelpers } from "../../../agent/src/system-core/bot-manage/session/model-message-runtime-helpers.js";
import { registerNoobotPlugin } from "../src/index.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { markGuidanceSummarizedMessages } from "../src/capabilities/handlers/guidance/signal-tracker.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

function assertFlatCapabilityMessages(messages = []) {
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 1, true);
  const roles = messages.map((item = {}) => String(item?.role || "").trim());
  assert.equal(roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)), true);
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(["system", "user", "assistant", "tool"].includes(String(last.role || "")), true);
}


test("phase acceptance injects context, revised plan checklist, then phase request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const ctx = {
    messages: [{ role: "user", content: "阶段上下文：已完成核心实现" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  const before = await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: { harness: { planningGuidanceMode: "inject" } },
  });

  assert.equal(before.changed, true);
  const planContextIndex = ctx.messages.findIndex((item = {}) =>
    /harness-acceptance-main-plan/.test(String(item?.content || "")),
  );
  const requestIndex = ctx.messages.findIndex((item = {}) =>
    /harness-phase-acceptance-request/.test(String(item?.content || "")),
  );
  const responsibilityIndex = ctx.messages.findIndex((item = {}) =>
    /请根据上下文进行「阶段验收」，按文本协议返回（如果有）。/.test(String(item?.content || "")),
  );
  assert.equal(ctx.messages[planContextIndex].role, "system");
  assert.match(String(ctx.messages[planContextIndex].content), /计划清单上下文|Plan checklist context/);
  assert.match(String(ctx.messages[planContextIndex].content), /核心实现/);
  assert.equal(ctx.messages[planContextIndex].injectedMessage, true);
  assert.equal(ctx.messages[planContextIndex].injectedBy, "harness-plugin");
  assert.equal(ctx.messages[requestIndex].role, "user");
  assert.match(String(ctx.messages[requestIndex].content), /acceptance_patch_v1/);
  assert.match(String(ctx.messages[requestIndex].content), /ADD A\[验收ID\] plan=计划ID status=\[pass\|warn\|fail\]/);
  assert.match(String(ctx.messages[requestIndex].content), /evidence=\[简短证据\]/);
  assert.equal(ctx.messages[requestIndex].injectedMessage, true);
  assert.equal(ctx.messages[requestIndex].injectedBy, "harness-plugin");
  assert.equal(
    planContextIndex > -1 && requestIndex > planContextIndex && responsibilityIndex > requestIndex,
    true,
  );
  assert.equal(ctx.agentContext.payload.harness.state.pending.phaseAcceptance, false);
  assert.equal(ctx.agentContext.payload.harness.state.flags.phaseAcceptanceCapturePending, true);

  const after = await handler({
    capability: "acceptance",
    point: "after_llm_call",
    ctx: { ...ctx, ai: { content: "阶段验收：pass" } },
    meta: { harness: { planningGuidanceMode: "inject" } },
  });
  assert.equal(after.changed, true);
  assert.equal(ctx.agentContext.payload.harness.phaseAcceptanceReports.length, 1);
  assert.match(ctx.agentContext.payload.harness.phaseAcceptanceReports[0].content, /pass/);
});


test("phase acceptance separate model receives context, summaries, revised plan, phase checklists, then phase request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const ctx = {
    messages: [{ role: "user", content: "阶段上下文：继续审查" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n1.1 子任务A\n2. 验证交付",
          summaryText: "1. 旧小结：已完成基础结构审查\n2. 旧小结：正在补齐验收流程",
          summaryFullText: [
            "[SUMMARY_OVERVIEW]",
            "1. 最新小结概要：阶段验收只应看到这一条",
            "[SUMMARY_DETAIL]",
            "## 详细明细",
            "- 详细内容不应作为小结清单传入阶段验收",
            "[SUMMARY_END]",
          ].join("\n"),
          phaseAcceptanceReports: [
            { acceptedAt: "2026-05-27T00:00:00.000Z", content: "阶段验收清单一：warn" },
          ],
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1.1 status=pass risk=low evidence=[ok] [阶段通过]" };
        },
      },
    },
  });

  assert.equal(invocations.length, 1);
  const messages = invocations[0].messages;
  assert.equal(Array.isArray(messages), true);
  const summaryIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-summary-reports") ? index : -1)
    .filter((index) => index >= 0);
  const planIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-main-plan"));
  const phaseIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-phase-acceptance-reports") ? index : -1)
    .filter((index) => index >= 0);
  const requestIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-phase-acceptance-request"));
  assert.equal(summaryIndexes.length, 1);
  assert.equal(messages[summaryIndexes[0]].role, "system");
  assert.match(String(messages[summaryIndexes[0]].content || ""), /最新小结概要/);
  assert.doesNotMatch(String(messages[summaryIndexes[0]].content || ""), /旧小结/);
  assert.match(String(messages[summaryIndexes[0]].content || ""), /\[SUMMARY_DETAIL\]/);
  assert.match(String(messages[summaryIndexes[0]].content || ""), /详细内容不应作为小结清单/);
  assert.equal(messages[planIndex].role, "system");
  assert.equal(messages[phaseIndexes[0]].role, "system");
  assert.equal(messages[requestIndex].role, "system");
  assert.equal(
    summaryIndexes[0] >= 0 &&
      planIndex > summaryIndexes[0] &&
      phaseIndexes[0] > planIndex &&
      requestIndex > phaseIndexes[0],
    true,
  );
});


test("model-context rules 2: phase acceptance separate model uses six ordered context segments", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const runtimeHelpers = new ModelMessageRuntimeHelpers();
  const baseResolveModelMessages = runtimeHelpers.createResolveModelMessages();
  const invocations = [];
  const resolverCalls = [];
  const ctx = {
    dialogProcessId: "dlg_current",
    messages: [
      { role: "user", content: "当前阶段继续", dialogProcessId: "dlg_current" },
      {
        role: "assistant",
        content: "",
        dialogProcessId: "dlg_current",
        tool_calls: [{ id: "call-ctx", function: { name: "execute_script", arguments: "{\"cmd\":\"pwd\"}" } }],
      },
      {
        role: "tool",
        content: "{\"ok\":true,\"stdout\":\"/workspace\"}",
        tool_call_id: "call-ctx",
        dialogProcessId: "dlg_current",
      },
    ],
    messageBlocks: {
      system: [
        { role: "system", content: "agent-system", dialogProcessId: "dlg_current" },
      ],
      history: [
        { role: "user", content: "history-user-first", dialogProcessId: "dlg_old" },
        { role: "user", content: "history-user-second", dialogProcessId: "dlg_old" },
        { role: "assistant", content: "history-assistant-old", dialogProcessId: "dlg_old" },
        { role: "assistant", content: "history-assistant-latest", dialogProcessId: "dlg_old" },
      ],
      incremental: [
        { role: "user", content: "当前阶段继续", dialogProcessId: "dlg_current" },
        {
          role: "assistant",
          content: "",
          dialogProcessId: "dlg_current",
          tool_calls: [{ id: "call-ctx", function: { name: "execute_script", arguments: "{\"cmd\":\"pwd\"}" } }],
        },
        {
          role: "tool",
          content: "{\"ok\":true,\"stdout\":\"/workspace\"}",
          tool_call_id: "call-ctx",
          dialogProcessId: "dlg_current",
        },
      ],
    },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          summaryFullText: [
            "[SUMMARY_OVERVIEW]",
            "1. 最后一次完整小结：用于阶段验收",
            "[SUMMARY_DETAIL]",
            "- 明细不应被拆成历史多次小结",
            "[SUMMARY_END]",
          ].join("\n"),
          phaseAcceptanceReports: [
            { acceptedAt: "2026-06-01T00:00:00.000Z", content: "上一阶段验收：warn" },
          ],
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        resolveModelMessages: (payload = {}) => {
          resolverCalls.push(payload);
          return baseResolveModelMessages(payload);
        },
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1 status=pass risk=low evidence=[ok] [阶段通过]" };
        },
      },
    },
  });

  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0]?.purpose, "phase_acceptance");
  assert.equal(invocations.length, 1);
  const messages = invocations[0].messages || [];
  const indexOf = (pattern) => messages.findIndex((item = {}) => pattern.test(String(item.content || "")));
  const agentSystemIndex = indexOf(/agent-system/);
  const historyUserIndex = indexOf(/history-user-first/);
  const historyAssistantIndex = indexOf(/history-assistant-latest/);
  const toolCallSemanticIndex = indexOf(/语义执行 execute_script脚本/);
  const toolResultIndex = messages.findIndex((item = {}) => String(item.content || "").includes('"stdout":"/workspace"'));
  const summaryIndex = indexOf(/harness-summary-reports/);
  const planIndex = indexOf(/harness-acceptance-main-plan/);
  const phaseReportIndex = indexOf(/harness-phase-acceptance-reports/);
  const requestIndex = indexOf(/harness-phase-acceptance-request/);
  const responsibilityIndex = indexOf(/请根据上下文进行「阶段验收」，按文本协议返回（如果有）。/);

  assert.equal(messages[agentSystemIndex]?.role, "system");
  assert.equal(messages[historyUserIndex]?.role, "user");
  assert.equal(messages[historyAssistantIndex]?.role, "assistant");
  assert.equal(messages[toolCallSemanticIndex]?.role, "user");
  assert.equal(messages[toolResultIndex]?.role, "assistant");
  assert.equal(messages[summaryIndex]?.role, "system");
  assert.equal(messages[planIndex]?.role, "system");
  assert.equal(messages[phaseReportIndex]?.role, "system");
  assert.equal(messages[requestIndex]?.role, "system");
  assert.equal(messages[responsibilityIndex]?.role, "user");
  assert.equal(agentSystemIndex < summaryIndex, true);
  assert.equal(summaryIndex < planIndex, true);
  assert.equal(planIndex < phaseReportIndex, true);
  assert.equal(phaseReportIndex < requestIndex, true);
  assert.equal(requestIndex < historyUserIndex, true);
  assert.equal(historyUserIndex < historyAssistantIndex, true);
  assert.equal(historyAssistantIndex < toolCallSemanticIndex, true);
  assert.equal(toolCallSemanticIndex < toolResultIndex, true);
  assert.equal(toolResultIndex < responsibilityIndex, true);
  assert.match(String(messages[summaryIndex]?.content || ""), /最后一次完整小结：用于阶段验收/);
  assert.match(String(messages[phaseReportIndex]?.content || ""), /上一阶段验收：warn/);
});


test("phase acceptance separate model drops historical summary relays and passes only latest complete summary context", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const resolveModelMessages = new ModelMessageRuntimeHelpers().createResolveModelMessages();
  const invocations = [];
  const ctx = {
    messages: [
      { role: "user", content: "阶段上下文：继续验收当前阶段" },
      { role: "assistant", content: "继续处理当前阶段" },
    ],
    messageBlocks: {
      system: [],
      history: [
        { role: "user", content: "阶段历史真实用户", dialogProcessId: "dlg_old" },
        {
          role: "user",
          content: "[harness:summary]\n旧小结完整-1：不应再次传给阶段验收模型",
          injectedMessage: true,
          injectedBy: "harness-plugin",
          injectedMessageType: "separate_model_relay:summary",
          dialogProcessId: "dlg_old",
        },
        {
          role: "user",
          content: "[harness:summary]\n旧小结完整-2：也不应再次传给阶段验收模型",
          injectedMessage: true,
          injectedBy: "harness-plugin",
          injectedMessageType: "separate_model_relay:summary",
          dialogProcessId: "dlg_old",
        },
        {
          role: "user",
          content: "[来自harness外部模型输出/summary]\n旧小结完整-3：历史持久化前缀消息也不应传给阶段验收模型",
          dialogProcessId: "dlg_old",
        },
        { role: "assistant", content: "阶段历史最终回答", dialogProcessId: "dlg_old" },
      ],
      incremental: [
        { role: "user", content: "阶段上下文：继续验收当前阶段", dialogProcessId: "dlg_current" },
        { role: "assistant", content: "继续处理当前阶段", dialogProcessId: "dlg_current" },
      ],
    },
    dialogProcessId: "dlg_current",
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          summaryText: "旧合并小结：不应作为阶段验收小结上下文",
          summaryFullText: [
            "[SUMMARY_OVERVIEW]",
            "1. 最后一次完整小结 item-1：只应作为同一份小结传入",
            "2. 最后一次完整小结 item-2：不能拆成第二份 summary report",
            "3. 最后一次完整小结 item-3：不能拆成第三份 summary report",
            "[SUMMARY_DETAIL]",
            "- 最后一次完整小结的明细",
            "[SUMMARY_END]",
          ].join("\n"),
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        resolveModelMessages,
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1 status=pass risk=low evidence=[ok] [阶段通过]" };
        },
      },
    },
  });

  assert.equal(invocations.length, 1);
  const joined = invocations[0].messages
    .map((item = {}) => String(item.content || ""))
    .join("\n\n");
  assert.match(joined, /最后一次完整小结 item-1：只应作为同一份小结传入/);
  assert.match(joined, /最后一次完整小结 item-2：不能拆成第二份 summary report/);
  assert.match(joined, /最后一次完整小结 item-3：不能拆成第三份 summary report/);
  assert.doesNotMatch(joined, /旧小结完整-1/);
  assert.doesNotMatch(joined, /旧小结完整-2/);
  assert.doesNotMatch(joined, /旧小结完整-3/);
  assert.doesNotMatch(joined, /旧合并小结/);
  assert.equal(
    invocations[0].messages.filter((item = {}) =>
      String(item.content || "").includes("harness-summary-reports"),
    ).length,
    1,
  );
});


test("phase acceptance separate model uses messageBlocks incremental when ctx.messages is history-only", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const resolveModelMessages = new ModelMessageRuntimeHelpers().createResolveModelMessages();
  const invocations = [];
  const ctx = {
    messages: [
      { role: "user", content: "history-only-visible-in-ctx.messages", dialogProcessId: "dlg_old" },
    ],
    messageBlocks: {
      system: [],
      history: [
        { role: "user", content: "history-from-message-block", dialogProcessId: "dlg_old" },
        { role: "assistant", content: "history-assistant-from-message-block", dialogProcessId: "dlg_old" },
      ],
      incremental: [
        { role: "user", content: "current-incremental-context", dialogProcessId: "dlg_current" },
        { role: "assistant", content: "current-incremental-result", dialogProcessId: "dlg_current" },
      ],
    },
    dialogProcessId: "dlg_current",
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        resolveModelMessages,
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1 status=pass risk=low evidence=[ok] [阶段通过]" };
        },
      },
    },
  });

  assert.equal(invocations.length, 1);
  const joined = invocations[0].messages
    .map((item = {}) => String(item.content || ""))
    .join("\n\n");
  assert.match(joined, /history-from-message-block/);
  assert.match(joined, /current-incremental-context/);
  assert.match(joined, /current-incremental-result/);
  assert.doesNotMatch(joined, /history-only-visible-in-ctx\.messages/);
});


