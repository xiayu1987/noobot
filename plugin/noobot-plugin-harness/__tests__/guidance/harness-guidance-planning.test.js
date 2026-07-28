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

test("harness summary triggers complete revised plan and acceptance uses latest checklist", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return { content: "已完成：完成初始检查\n小结完成" };
        }
        if (payload.purpose === "planning_refinement") {
          return {
            content: JSON.stringify({
              totalGoal: "完成 harness 计划闭环",
              taskOwner: "primary_task_owner",
              nextPhase: { objective: "实现验收闭环", checklistIndexes: [2] },
              taskChecklist: [
                {
                  index: 1,
                  task: "完成初始检查",
                  owner: "primary_task_owner",
                  input: "用户请求",
                  output: "检查结果",
                  files: { create: [], modify: ["src/a.js"], delete: [] },
                },
                {
                  index: 2,
                  task: "实现验收闭环",
                  owner: "primary_task_owner",
                  input: "阶段小结和当前计划",
                  output: "最终计划清单验收结果",
                  files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
                },
              ],
            }),
          };
        }
        if (payload.purpose === "planning_revision") {
          return {
            content: JSON.stringify({
              totalGoal: "完成 harness 计划闭环",
              taskOwner: "primary_task_owner",
              nextPhase: { objective: "实现验收闭环", checklistIndexes: [2] },
              taskChecklist: [
                {
                  index: 1,
                  task: "完成初始检查",
                  owner: "primary_task_owner",
                  input: "用户请求",
                  output: "检查结果",
                  files: { create: [], modify: ["src/a.js"], delete: [] },
                },
                {
                  index: 2,
                  task: "实现验收闭环",
                  owner: "primary_task_owner",
                  input: "阶段小结和当前计划",
                  output: "最终计划清单验收结果",
                  files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
                },
              ],
            }),
          };
        }
        return { content: "{}" };
      },
    },
  );

  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-summary-opdir-"));
  const messages = [{ role: "user", content: "继续" }];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "完成初始检查", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, planUpdateTurns: -100, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId: "summary-user",
          globalConfig: { tools: { execute_script: { sandboxMode: false } } },
          systemRuntime: { userId: "summary-user", sessionId: "summary-session" },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
  const summaryRelayMessage = messages.find((item = {}) =>
    /\[来自harness外部模型输出\/summary\]/.test(String(item?.content || "")),
  );
  const summaryRelayText = String(summaryRelayMessage?.content || "");
  assert.match(summaryRelayText, /已完成：完成初始检查/);
  assert.match(summaryRelayText, /\[Harness operation dir\] runtime\/ops_workdir/);
  assert.equal(
    summaryRelayText.includes(`Use (non-sandbox): ${basePath}/runtime/ops_workdir`),
    true,
  );
  assert.equal(
    summaryRelayText.indexOf("[Harness operation dir]") > summaryRelayText.indexOf("已完成：完成初始检查"),
    true,
  );
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, false);

  const result = { output: "done" };
  await hookManager.emit("before_final_output", { agentContext, result });

  assert.equal(agentContext.payload.harness.lastAcceptanceReport.finalPlanChecklist.length >= 1, true);
  assert.equal(Number(agentContext.payload.harness.lastAcceptanceReport.plan.revisionCount || 0), 0);
});

test("planning_revision reuses summary model messages in separate_model flow", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      resolveModelMessages: ({ purpose = "", messages = [] } = {}) => {
        if (purpose === "summary") {
          return (Array.isArray(messages) ? messages : []).filter((item = {}) =>
            String(item?.content || "").includes("history"),
          );
        }
        if (purpose === "planning_revision") {
          return [{ role: "user", content: "REVISION-ONLY" }];
        }
        return Array.isArray(messages) ? messages : [];
      },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        if (payload.purpose === "planning_refinement") {
          return {
            content: JSON.stringify({
              totalGoal: "完成计划细化",
              taskOwner: "primary_task_owner",
              taskChecklist: [
                {
                  index: 1,
                  task: "细化计划",
                  owner: "primary_task_owner",
                  input: "阶段小结和历史执行",
                  output: "细化后的执行清单",
                  files: { create: [], modify: ["src/capabilities/handlers/guidance.js"], delete: [] },
                },
              ],
            }),
          };
        }
        if (payload.purpose === "planning_revision") {
          return {
            content: JSON.stringify({
              totalGoal: "完成计划修复",
              taskOwner: "primary_task_owner",
              taskChecklist: [
                {
                  index: 1,
                  task: "修复计划",
                  owner: "primary_task_owner",
                  input: "阶段小结和历史执行",
                  output: "更新后的计划清单",
                  files: { create: [], modify: ["src/capabilities/handlers/guidance.js"], delete: [] },
                },
              ],
            }),
          };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
    { role: "user", content: "non-history" },
  ];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText: "1. 初始计划",
        taskChecklist: [{ index: 1, task: "初始计划", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
  assert.equal(invocations.every((item) => item.promptVersion === "v1"), true);
  assert.equal(invocations.every((item) => item.envelopeType === "structured_v1"), true);
  const summaryMessages = invocations[0].messages;
  assertFlatCapabilityMessages(summaryMessages);
});

test("planning_refinement is scheduled independently after revision main-plan change", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        if (payload.purpose === "planning_revision") {
          return { content: "1. 修复后的主计划\n2. 新增主任务" };
        }
        if (payload.purpose === "planning_refinement") {
          return { content: "ADD 1.1 细化修复后的主计划" };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
  ];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText: "1. 初始计划",
        taskChecklist: [{ index: 1, task: "初始计划", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, planUpdateTurns: -100, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
});

test("harness summary without completion marker still triggers planning revision", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return { content: "已完成：完成初始检查" };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [{ role: "user", content: "继续" }];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "完成初始检查", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
  assert.equal(
    agentContext.payload.harness.logs.guidance.some((item) => item.event === "summary_completion_marker_missing"),
    false,
  );
  assert.equal(agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_revised_after_summary"), false);
});

test("guidance handler inject mode can schedule and capture planning revision without invoker", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        totalGoal: "初始目标",
        taskChecklist: [
          {
            index: 1,
            task: "完成初始检查",
            owner: "primary_task_owner",
            input: "用户请求",
            output: "检查结果",
            files: { create: [], modify: [], delete: [] },
          },
        ],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
    },
  };

  const firstCtx = {
    messages: [{ role: "user", content: "继续" }],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: firstCtx, meta });
  assert.equal(
    firstCtx.messages.some((msg) => String(msg.content || "").includes("harness-guidance-summary")),
    true,
  );

  const summaryCtx = {
    messages: firstCtx.messages,
    ai: { content: "已完成：完成初始检查\n小结完成" },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: summaryCtx, meta });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_revision_scheduled_by_inject"),
    false,
  );

  const secondCtx = {
    messages: [{ role: "user", content: "继续执行" }],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: secondCtx, meta });
  assert.equal(
    secondCtx.messages.some((msg) => String(msg.content || "").includes("harness-planning-revision")),
    false,
  );

  const revisionCtx = {
    messages: secondCtx.messages,
    ai: {
      content: JSON.stringify({
        totalGoal: "完成 inject 模式计划闭环",
        taskOwner: "primary_task_owner",
        nextPhase: { objective: "完成最终验收", checklistIndexes: [2] },
        taskChecklist: [
          {
            index: 1,
            task: "完成初始检查",
            owner: "primary_task_owner",
            input: "用户请求",
            output: "检查结果",
            files: { create: [], modify: ["src/a.js"], delete: [] },
          },
          {
            index: 2,
            task: "完成最终验收",
            owner: "primary_task_owner",
            input: "修正后的计划清单",
            output: "验收报告",
            files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
          },
        ],
      }),
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: revisionCtx, meta });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_refinement_converged_no_target_main_step"),
    false,
  );
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_revised_after_summary"),
    false,
  );
});
