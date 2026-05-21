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

import { createHookManager } from "../../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin } from "../src/index.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("harness review generates review report at final output", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "owner" }],
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u12",
    sessionId: "s12",
    dialogProcessId: "dp12",
    result,
    agentContext,
  });

  assert.match(String(result.output), /Harness-Review/);
  assert.equal(Array.isArray(agentContext.payload.harness.reviewReports), true);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.point, "before_final_output");
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    true,
  );
});

test("harness before_final_output capability runtime runs once", async () => {
  const hookManager = createHookManager();
  let count = 0;
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point, ctx }) => {
          if (point === "before_final_output") {
            count += 1;
            ctx.result.output = `${ctx.result.output}|acceptance-${count}`;
          }
          return { capability: "acceptance", point, status: "active", changed: true };
        },
        review: async ({ point }) => ({ capability: "review", point, status: "active", changed: false }),
      },
    },
  );

  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u13",
    sessionId: "s13",
    dialogProcessId: "dp13",
    result,
    agentContext: { payload: { messages: { system: [], history: [] }, harness: {} } },
  });

  assert.equal(count, 1);
  assert.match(result.output, /\|acceptance-1$/);
  assert.equal((result.output.match(/acceptance-1/g) || []).length, 1);
});

test("harness finalResponseGuard false skips final policy injection but keeps review", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: true, finalResponseGuard: false });

  const result = { output: "done" };
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  await hookManager.emit("before_final_output", {
    userId: "u14",
    sessionId: "s14",
    dialogProcessId: "dp14",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /noobot-harness-final-response/);
  assert.match(String(result.output), /Harness-Review/);
});

test("harness promptPolicy false still traces before_llm_call", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, promptPolicy: false, trace: true });

  await hookManager.emit("before_llm_call", {
    executionScope: "primary",
    userId: "u15",
    sessionId: "s15",
    dialogProcessId: "dp15",
    messages: [{ role: "user", content: "hello" }],
  });

  const eventsFile = path.join(basePath, "runtime", "harness", "runs", "dp15", "events.jsonl");
  assert.equal(await waitForFile(eventsFile), true);
  const events = (await fs.readFile(eventsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.point === "before_llm_call"), true);
});

test("harness review records reports on error and abort hooks", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };

  await hookManager.emit("on_error", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    error: new Error("boom"),
    agentContext,
  });
  await hookManager.emit("on_abort", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    agentContext,
  });

  assert.equal(agentContext.payload.harness.reviewReports.length, 2);
  assert.equal(agentContext.payload.harness.reviewReports[0].status, "error");
  assert.equal(agentContext.payload.harness.reviewReports[1].status, "abort");
  assert.equal(agentContext.payload.harness.logs.review.length, 2);
});

test("harness full engineering capability flow plans, guides, accepts and reviews", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [] },
      harness: {},
    },
  };
  const messages = [{ role: "user", content: "请处理附件并验收" }];

  await hookManager.emit("before_turn", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    agentContext,
  });

  assert.equal(
    agentContext.payload.tools.registry.some((tool) => tool?.name === "request_task_acceptance"),
    true,
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  assert.match(String(messages.at(-1)?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    ai: {
      content:
        '{"totalGoal":"完成任务","taskChecklist":[{"index":1,"task":"解析附件","owner":"owner","input":"附件","output":"解析结果","files":{"create":[],"modify":[],"delete":[]}},{"index":2,"task":"执行核心任务","owner":"owner","input":"需求","output":"执行结果","files":{"create":[],"modify":[],"delete":[]}}]}',
    },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);

  for (let i = 0; i < 3; i += 1) {
    await hookManager.emit("after_tool_call", {
      userId: "flow-user",
      sessionId: "flow-session",
      dialogProcessId: "flow-dp",
      toolName: "call_service",
      call: { name: "call_service" },
      success: false,
      agentContext,
    });
  }
  assert.equal(
    agentContext.payload.harness.state.pending.guidance,
    "consecutive_failures",
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  assert.match(String(messages[0]?.content || ""), /harness-guidance/);
  assert.equal(agentContext.payload.harness.state.pending.guidance, null);

  await hookManager.emit("after_tool_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    toolName: "doc_to_data",
    call: { name: "doc_to_data" },
    success: true,
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.signals.parsedAttachment, true);

  const acceptanceTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_task_acceptance",
  );
  const acceptanceResult = await acceptanceTool.func({ mode: "active" });
  assert.equal(acceptanceResult.ok, true);
  assert.equal(agentContext.payload.harness.state.flags.acceptanceRequested, true);

  const result = { output: "任务完成" };
  await hookManager.emit("before_final_output", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Forced-Acceptance/);
  assert.match(String(result.output), /Harness-Review/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.summary.planningCaptured, true);
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    false,
  );
});

test("harness review attachToFinalOutput false keeps report internal", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    { trace: false, promptPolicy: false, review: { attachToFinalOutput: false } },
  );

  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u17",
    sessionId: "s17",
    dialogProcessId: "dp17",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Review/);
  assert.match(String(result.output), /Harness-Forced-Acceptance/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.review.length, 1);
});

test("harness forced acceptance is owned by acceptance and appended once", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
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
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u18",
    sessionId: "s18",
    dialogProcessId: "dp18",
    result,
    agentContext,
  });

  assert.equal((String(result.output).match(/Harness-Forced-Acceptance/g) || []).length, 1);
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "forced_acceptance_triggered"), true);
  assert.equal(agentContext.payload.harness.logs.planning.some((log) => log.event === "forced_acceptance_triggered"), false);
});

test("harness acceptance semantic validation uses separate model when enabled", async () => {
  const hookManager = createHookManager();
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
      messages: { system: [], history: [] },
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

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].purpose, "acceptance_semantic_validation");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.match(String(result.output), /"semanticValidation"/);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_completed"), true);
});

test("harness active request_task_acceptance semantic validation receives agent ctx via tool config", async () => {
  const hookManager = createHookManager();
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
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].purpose, "acceptance_semantic_validation");
  assert.equal(result.report.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
});

test("harness acceptance semantic validation failure does not block active acceptance", async () => {
  const hookManager = createHookManager();
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
  assert.equal(result.report.semanticValidation, undefined);
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

test("harness review reports failed or inconsistent semantic acceptance", async () => {
  const hookManager = createHookManager();
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
  assert.equal(report.summary.semanticValidationStatus, "fail");
  assert.equal(report.summary.semanticValidationConsistent, false);
  assert.equal(report.summary.issues.includes("acceptance_semantic_validation_failed_or_inconsistent"), true);
  assert.match(String(result.output), /acceptance_semantic_validation_failed_or_inconsistent/);
});


test("harness summary triggers complete revised plan and acceptance uses latest checklist", async () => {
  const hookManager = createHookManager();
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

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary", "planning_revision"]);
  assert.equal(agentContext.payload.harness.totalGoal, "完成 harness 计划闭环");
  assert.equal(agentContext.payload.harness.taskChecklist.length, 2);
  assert.equal(agentContext.payload.harness.taskChecklist[1].input, "阶段小结和当前计划");
  assert.deepEqual(agentContext.payload.harness.taskChecklist[1].files.create, ["reports/acceptance.json"]);
  assert.equal(agentContext.payload.harness.nextPhase.objective, "实现验收闭环");
  assert.match(String(messages.map((item) => item.content).join("\n")), /下一阶段计划清单/);

  const result = { output: "done" };
  await hookManager.emit("before_final_output", { agentContext, result });

  assert.equal(agentContext.payload.harness.lastAcceptanceReport.finalPlanChecklist.length, 2);
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.plan.totalGoal, "完成 harness 计划闭环");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.plan.revisionCount >= 1, true);
});

test("planning_revision reuses summary model messages in separate_model flow", async () => {
  const hookManager = createHookManager();
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

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary", "planning_revision"]);
  const summaryMessages = invocations[0].messages;
  const revisionMessages = invocations[1].messages;
  const revisionBaseMessages = revisionMessages.slice(0, -1);
  assert.deepEqual(revisionBaseMessages, summaryMessages);
  assert.equal(
    revisionMessages.some((item = {}) => String(item?.content || "").includes("REVISION-ONLY")),
    false,
  );
});

test("harness summary without completion marker does not trigger planning revision", async () => {
  const hookManager = createHookManager();
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
    true,
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
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_revision_scheduled_by_inject"),
    true,
  );

  const secondCtx = {
    messages: [{ role: "user", content: "继续执行" }],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: secondCtx, meta });
  assert.equal(
    secondCtx.messages.some((msg) => String(msg.content || "").includes("harness-planning-revision")),
    true,
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
  assert.equal(agentContext.payload.harness.totalGoal, "完成 inject 模式计划闭环");
  assert.equal(agentContext.payload.harness.taskChecklist.length, 2);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_revised_after_summary"),
    true,
  );
});
