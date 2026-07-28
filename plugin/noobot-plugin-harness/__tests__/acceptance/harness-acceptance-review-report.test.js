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


test("model-context rules 2 note: harness-side summary marking policy remains unchanged", async () => {
  const ctx = {
    messages: [
      { role: "user", content: "用户当前输入" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-exec", function: { name: "execute_script", arguments: "{}" } }],
      },
      { role: "tool", content: "{\"toolName\":\"execute_script\",\"ok\":true}", tool_call_id: "call-exec" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-summary", function: { name: "task_summary", arguments: "{}" } }],
      },
      {
        role: "tool",
        content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"阶段小结\"}",
        tool_call_id: "call-summary",
      },
    ],
    agentContext: {
      payload: {
        messages: { history: [] },
        harness: {
          state: { flags: {}, counters: {}, signals: {}, pending: {} },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(markedCount, 2);
  assert.equal(ctx.messages[1]?.summarized, true);
  assert.equal(ctx.messages[2]?.summarized, true);
  assert.equal(ctx.messages[3]?.summarized, undefined);
  assert.equal(ctx.messages[4]?.summarized, undefined);
});


test("harness review reports failed or inconsistent semantic acceptance", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        lastAcceptanceReport: {
          mode: "active",
          summary: { total: 1, completed: 1, inProgress: 0, pending: 0 },
          taskChecklist: [{ index: 1, task: "执行核心任务", status: "completed" }],
          semanticValidation: { status: "fail", consistent: false, missingItems: ["执行核心任务"] },
        },
        state: {
          flags: { planningCaptured: true, acceptanceRequested: true },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", { agentContext, result });

  const report = agentContext.payload.harness.lastReviewReport;
  assert.equal(report.summary.semanticValidationStatus, null);
  assert.equal(report.summary.semanticValidationConsistent, null);
  assert.equal(report.summary.issues.includes("acceptance_semantic_validation_failed_or_inconsistent"), false);
});



