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


test("harness acceptance semantic validation uses separate model when enabled", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  const runtimeHelpers = new ModelMessageRuntimeHelpers();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      resolveModelMessages: runtimeHelpers.createResolveModelMessages(),
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: JSON.stringify({
            status: "pass",
            consistent: true,
            missingItems: [],
            unsupportedClaims: [],
            checklistCoverage: [
              { index: 1, task: "执行核心任务", covered: true, evidence: "final output", risk: "low" },
            ],
            suggestions: [],
          }),
        };
      },
    },
  );

  const agentContext = {
    payload: {
      messages: {
        system: [{ role: "system", content: "系统上下文：必须保留" }],
        history: [
          { role: "user", content: "用户原始需求：执行核心任务", frontendUserMessage: true, dialogProcessId: "dp-history" },
          { role: "assistant", content: "执行过程上下文：已完成核心任务", dialogProcessId: "dp-history" },
        ],
      },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { parsedAttachment: false, subtaskStarted: false, subtaskWaited: false, successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done: 执行核心任务" };

  await hookManager.emit("before_final_output", {
    userId: "u19",
    sessionId: "s19",
    dialogProcessId: "dp19",
    result,
    agentContext,
  });

  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance_before_final");
  assert.match(invocations[0].messages.map((item = {}) => String(item.content || "")).join("\n"), /用户原始需求：执行核心任务/);
  assert.match(invocations[0].messages.map((item = {}) => String(item.content || "")).join("\n"), /执行过程上下文：已完成核心任务/);
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(invocations[1].promptVersion, "v1");
  assert.equal(invocations[1].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[1].messages);
  assert.equal(Array.isArray(agentContext.payload.harness.phaseAcceptanceReports), true);
  assert.equal(agentContext.payload.harness.phaseAcceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.doesNotMatch(String(result.output), /"semanticValidation"|acceptanceReport|完整计划清单/);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_completed"), true);
});


test("acceptance semantic validation relays via unified ctx.messages protocol", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const modelMessages = [{ role: "assistant", content: "任务完成", type: "message" }];
  const ctx = {
    userId: "relay-u",
    sessionId: "relay-s",
    dialogProcessId: "relay-dp",
    messages: modelMessages,
    result: {
      output: "任务完成",
      modelMessages,
      turnMessages: [{ role: "assistant", content: "任务完成", type: "message" }],
    },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核对输出",
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {},
            signals: {},
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
      execution: {
        controllers: {
          runtime: {
            systemRuntime: { userId: "relay-u", sessionId: "relay-s" },
          },
        },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async ({ purpose }) => {
        if (purpose === "acceptance_semantic_validation") {
          return { content: "ADD 1 验收通过，输出与计划一致" };
        }
        return { content: "" };
      },
    },
  };

  const res = await handler({ capability: "acceptance", point: "before_final_output", ctx, meta });
  assert.equal(res.status, "active");
  assert.equal(Array.isArray(ctx.messages), true);
  assert.equal(
    ctx.messages.some(
      (item = {}) =>
        item.injectedMessage === true &&
        String(item.injectedBy || "") === "harness-plugin" &&
        String(item.role || "") === "user" &&
        String(item.content || "").includes("acceptance_semantic_validation"),
    ),
    true,
  );
});


test("harness acceptance semantic validation failure does not block active acceptance", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async () => {
        throw new Error("semantic model unavailable");
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke(
    { mode: "active" },
    { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } },
  );
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  assert.equal(result.ok, true);
  assert.equal(result.phaseAcceptanceTriggered, false);
  assert.equal(result.report.semanticValidation, undefined);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "phase_acceptance_failed"), true);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_failed"), true);
});


test("acceptance handler inject mode schedules and captures semantic validation without invoker", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [
          {
            index: 1,
            task: "执行核心任务",
            owner: "primary_task_owner",
            input: "需求",
            output: "结果",
            files: { create: [], modify: ["src/a.js"], delete: [] },
          },
        ],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
      acceptance: { semanticValidation: true },
    },
  };

  const finalCtx = { agentContext, result: { output: "done" } };
  await handler({ capability: "acceptance", point: "before_final_output", ctx: finalCtx, meta });
  assert.equal(
    agentContext.payload.harness.logs.acceptance.some(
      (item) => item.event === "acceptance_semantic_validation_scheduled_by_inject",
    ),
    true,
  );

  const injectCtx = { agentContext, messages: [{ role: "user", content: "continue" }] };
  await handler({ capability: "acceptance", point: "before_llm_call", ctx: injectCtx, meta });
  assert.equal(
    injectCtx.messages.some((item) =>
      String(item?.content || "").includes("harness-acceptance-semantic-validation"),
    ),
    true,
  );

  const captureCtx = {
    agentContext,
    ai: {
      content: JSON.stringify({
        status: "pass",
        consistent: true,
        missingItems: [],
        unsupportedClaims: [],
        checklistCoverage: [{ index: 1, task: "执行核心任务", covered: true, evidence: "done", risk: "low" }],
        suggestions: [],
      }),
    },
  };
  await handler({ capability: "acceptance", point: "after_llm_call", ctx: captureCtx, meta });
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.equal(
    agentContext.payload.harness.logs.acceptance.some(
      (item) => item.event === "acceptance_semantic_validation_completed_inject",
    ),
    true,
  );
});


