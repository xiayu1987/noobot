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


test("final acceptance separate model receives revised plan, all phase checklists, then final request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const ctx = {
    messages: [{ role: "assistant", content: "最终输出：done" }],
    result: { output: "最终输出：done" },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          phaseAcceptanceReports: [
            { acceptedAt: "2026-05-27T00:00:00.000Z", content: "阶段验收清单一：pass" },
            { acceptedAt: "2026-05-27T00:10:00.000Z", content: "阶段验收清单二：warn" },
          ],
          taskChecklist: [{ index: 1, task: "核心实现" }],
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {},
            signals: { successfulToolCount: 1 },
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_final_output",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        acceptance: { semanticValidation: true },
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1 status=pass 总体验收通过" };
        },
      },
    },
  });

  assert.equal(invocations.length, 2);
  const semanticInvocation = invocations.find((item = {}) => item.purpose === "acceptance_semantic_validation");
  assert.equal(Boolean(semanticInvocation), true);
  const messages = semanticInvocation.messages;
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 4, true);
  const planIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-main-plan"));
  const phaseIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-phase-acceptance-reports") ? index : -1)
    .filter((index) => index >= 0);
  const requestIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-semantic-validation"));
  const protocolIndex = messages.findIndex((item = {}) => String(item.content || "").includes("acceptance_patch_v1"));
  assert.equal(messages[protocolIndex].role, "system");
  assert.equal(messages[planIndex].role, "user");
  assert.equal(phaseIndexes.length >= 2, true);
  assert.equal(messages[phaseIndexes[0]].role, "user");
  assert.equal(messages[phaseIndexes[1]].role, "user");
  assert.equal(messages[requestIndex].role, "user");
  assert.doesNotMatch(String(messages[requestIndex].content || ""), /acceptance_patch_v1/);
  assert.equal(
    planIndex > -1 &&
      phaseIndexes[0] > planIndex &&
      phaseIndexes[1] > phaseIndexes[0] &&
      requestIndex > phaseIndexes[1],
    true,
  );
  assert.match(String(messages[phaseIndexes[0]].content), /阶段验收清单一/);
  assert.match(String(messages[phaseIndexes[1]].content), /阶段验收清单二/);
  assert.match(String(messages[protocolIndex].content), /acceptance_patch_v1/);
  assert.match(String(messages[protocolIndex].content), /ADD A\[验收ID\] plan=计划ID status=\[pass\|warn\|fail\]/);
  assert.match(String(messages[protocolIndex].content), /risk=\[low\|medium\|high\]/);
});


test("harness active request_task_acceptance semantic validation receives agent ctx via tool config", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return { content: JSON.stringify({ status: "pass", consistent: true, checklistCoverage: [], missingItems: [], unsupportedClaims: [], suggestions: [] }) };
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
  const raw = await tool.invoke({ mode: "active" }, { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } });
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance");
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(invocations[1].promptVersion, "v1");
  assert.equal(invocations[1].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[1].messages);
  assert.equal(result.phaseAcceptanceTriggered, true);
  assert.equal(result.report.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
});


test("harness active request_task_acceptance falls back to closure meta when configurable meta lacks harness", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: JSON.stringify({
            status: "pass",
            consistent: true,
            checklistCoverage: [],
            missingItems: [],
            unsupportedClaims: [],
            suggestions: [],
          }),
        };
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
    {
      configurable: {
        noobotHookContext: { agentContext, result: { output: "done" } },
        noobotHookMeta: { systemRuntime: { userId: "u1", sessionId: "s1" } },
      },
    },
  );
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance");
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(result.phaseAcceptanceTriggered, true);
  assert.equal(result.report.semanticValidation.status, "pass");
});
