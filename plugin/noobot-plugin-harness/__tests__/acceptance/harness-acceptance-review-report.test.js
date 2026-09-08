/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createTestHookContext,
  createTestHookManager as createAgentHookManager,
} from "../helpers/public-runtime-fixtures.js";
import { registerHarnessCore } from "../../src/index.js";

import { markGuidanceSummarizedMessages } from "../../src/capabilities/handlers/guidance/signal-tracker.js";

test("harness summary selection does not mutate canonical messages before commit", async () => {
  const ctx = createTestHookContext(
    {
      agentContext: {
        payload: {
          harness: {
            state: { flags: {}, counters: {}, signals: {}, pending: {} },
            logs: { planning: [], guidance: [], acceptance: [], review: [] },
          },
        },
      },
    },
    {
      messages: [
        { role: "user", content: "用户当前输入" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-exec", function: { name: "execute_script", arguments: "{}" } }],
        },
        {
          role: "tool",
          content: '{"toolName":"execute_script","ok":true}',
          tool_call_id: "call-exec",
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-summary", function: { name: "task_summary", arguments: "{}" } }],
        },
        {
          role: "tool",
          content: '{"toolName":"task_summary","ok":true,"phaseSummary":"阶段小结"}',
          tool_call_id: "call-summary",
        },
      ],
    },
  );

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.ok(markedCount >= 2);
  assert.equal(ctx.modelContext.messages[1]?.summarized, undefined);
  assert.equal(ctx.modelContext.messages[2]?.summarized, undefined);
  assert.equal(ctx.modelContext.messages[3]?.summarized, undefined);
  assert.equal(ctx.modelContext.messages[4]?.summarized, undefined);
});

test("harness review reports failed or inconsistent semantic acceptance", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore({ hookManager }, { trace: false, promptPolicy: false });
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

  await hookManager.emit("agent.before_final_output", { agentContext, result });

  const report = agentContext.payload.harness.lastReviewReport;
  assert.equal(report.summary.semanticValidationStatus, null);
  assert.equal(report.summary.semanticValidationConsistent, null);
  assert.equal(
    report.summary.issues.includes("acceptance_semantic_validation_failed_or_inconsistent"),
    false,
  );
});
