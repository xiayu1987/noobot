/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  exists,
  fs,
  os,
  path,
  readJsonl,
  registerNoobotPlugin,
  test,
  waitForFile,
} from "./helpers/harness-planning-helper.js";

test("harness planning captures checklist and forces acceptance at final output", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
  };
  const messages = [{ role: "user", content: "开始任务" }];

  await hookManager.emit("before_llm_call", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    messages,
    agentContext,
  });
  const planningPromptMessage = messages.find((item = {}) =>
    /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  assert.equal(String(planningPromptMessage?.role || ""), "user");
  assert.match(String(planningPromptMessage?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    ai: {
      content: "1. 解析附件\n2. 等待子任务结果",
    },
    agentContext,
  });

  assert.equal(Array.isArray(agentContext.payload.harness.taskChecklist), true);
  assert.equal(agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, true);
  assert.equal(Array.isArray(agentContext.payload.harness.planningRawOutputs), true);
  assert.equal(agentContext.payload.harness.planningRawOutputs.length >= 1, true);
  assert.match(
    String(agentContext.payload.harness.lastPlanningRawOutput?.content || ""),
    /解析附件/,
  );

  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    result,
    agentContext,
  });
  assert.match(String(result.output), /^done/);
  assert.doesNotMatch(String(result.output), /Harness-验收|NOOBOT_HARNESS_COLLAPSE|acceptanceReport|完整计划清单/);
  assert.equal(Array.isArray(agentContext.payload.harness.acceptanceReports), true);
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
});

test("harness planning retries injection when first response has no checklist", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
    execution: { controllers: { runtime: { systemRuntime: { config: {} } } } },
  };

  const firstMessages = [{ role: "user", content: "执行任务" }];
  await hookManager.emit("before_llm_call", { messages: firstMessages, agentContext });
  await hookManager.emit("after_llm_call", {
    ai: { content: "先读取上下文后再规划。" },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(agentContext.payload.harness.state.flags.planningPromptInjected, false);
  assert.equal(agentContext.execution.controllers.runtime.systemRuntime.config.forceTool, undefined);

  const secondMessages = [{ role: "user", content: "继续" }];
  await hookManager.emit("before_llm_call", { messages: secondMessages, agentContext });
  assert.equal(
    secondMessages.some((item = {}) => /harness-planning-bootstrap/.test(String(item?.content || ""))),
    true,
  );

  await hookManager.emit("after_llm_call", {
    ai: { content: "1. 解析附件\n2. 执行核心任务" },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, true);
});

test("harness planning does not mutate runtime forceTool config", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const runtimeConfig = { forceTool: true };
  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
    execution: { controllers: { runtime: { systemRuntime: { config: runtimeConfig } } } },
  };

  await hookManager.emit("before_llm_call", {
    messages: [{ role: "user", content: "执行任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    ai: { content: "" },
    agentContext,
  });

  assert.equal(runtimeConfig.forceTool, true);

  await hookManager.emit("before_llm_call", {
    messages: [{ role: "user", content: "继续" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    ai: { content: "1. 执行核心任务" },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(runtimeConfig.forceTool, true);

  await hookManager.emit("before_final_output", {
    result: { output: "done" },
    agentContext,
  });
  assert.equal(runtimeConfig.forceTool, true);
});

test("harness planning blocks tool-call turn without assistant text and schedules retry", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
  };

  await hookManager.emit("before_llm_call", {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    ai: { content: "", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }] },
    modelResponse: { finish_reason: "tool_calls" },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(agentContext.payload.harness.state.counters.planningCaptureAttempts || 0, 1);
  assert.equal(agentContext.payload.harness.state.flags.planningPromptInjected, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some(
      (item) => item.event === "planning_capture_blocked_for_tool_call_turn",
    ),
    true,
  );
});
