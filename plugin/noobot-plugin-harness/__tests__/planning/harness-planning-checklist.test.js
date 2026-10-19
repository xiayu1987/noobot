/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assert,
  createAgentHookManager,
  registerHarnessCore,
  test,
} from "../helpers/harness-planning-helper.js";

test("harness planning captures checklist and forces acceptance at final output", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );

  const agentContext = {
    bindings: {
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  const messagesCtx = {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext,
  };
  await hookManager.emit("agent.before_llm_call", messagesCtx);
  const messages = messagesCtx.modelContext.messageBlocks.incremental;
  const planningPromptMessage = messages.find((item = {}) =>
    /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  assert.equal(String(planningPromptMessage?.role || ""), "user");
  assert.match(String(planningPromptMessage?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("agent.after_llm_call", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    modelResponse: { text: "1. 解析附件\n2. 等待子任务结果" },
    calls: [],
    agentContext,
  });

  assert.equal("taskChecklist" in agentContext.bindings.extensions.harness, false);
  assert.equal(
    String(agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    true,
  );
  assert.equal(Array.isArray(agentContext.bindings.extensions.harness.planningRawOutputs), true);
  assert.equal(agentContext.bindings.extensions.harness.planningRawOutputs.length >= 1, true);
  assert.match(
    String(agentContext.bindings.extensions.harness.lastPlanningRawOutput?.content || ""),
    /解析附件/,
  );

  const result = { output: "done" };
  await hookManager.emit("agent.before_final_output", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    result,
    agentContext,
  });
  assert.match(String(result.output), /^done/);
  assert.doesNotMatch(
    String(result.output),
    /Harness-验收|NOOBOT_HARNESS_COLLAPSE|acceptanceReport|完整计划清单/,
  );
  assert.equal(Array.isArray(agentContext.bindings.extensions.harness.acceptanceReports), true);
  assert.equal(agentContext.bindings.extensions.harness.acceptanceReports.length, 1);
});

test("harness planning retries injection when first response has no checklist", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );
  const agentContext = {
    bindings: {
      runtime: { systemRuntime: { config: {} } },
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  const firstMessages = [{ role: "user", content: "执行任务" }];
  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: { system: [], history: [], incremental: firstMessages },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "先读取上下文后再规划。" },
    calls: [],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, false);
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningPromptInjected, false);
  assert.equal(agentContext.bindings.runtime.systemRuntime.config.forceTool, undefined);

  const secondMessagesCtx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await hookManager.emit("agent.before_llm_call", secondMessagesCtx);
  const secondMessages = secondMessagesCtx.modelContext.messageBlocks.incremental;
  assert.equal(
    secondMessages.some((item = {}) =>
      /harness-planning-bootstrap/.test(String(item?.content || "")),
    ),
    true,
  );

  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "1. 解析附件\n2. 执行核心任务" },
    calls: [],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, true);
  assert.equal(
    String(agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    true,
  );
});

test("harness planning does not mutate runtime forceTool config", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );
  const runtimeConfig = { forceTool: true };
  const agentContext = {
    bindings: {
      runtime: { systemRuntime: { config: runtimeConfig } },
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "执行任务" }],
    },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "" },
    calls: [],
    agentContext,
  });

  assert.equal(runtimeConfig.forceTool, true);

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "1. 执行核心任务" },
    calls: [],
    agentContext,
  });
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, true);
  assert.equal(runtimeConfig.forceTool, true);

  await hookManager.emit("agent.before_final_output", {
    result: { output: "done" },
    agentContext,
  });
  assert.equal(runtimeConfig.forceTool, true);
});

test("harness planning blocks tool-call turn without assistant text and schedules retry", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );
  const agentContext = {
    bindings: {
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "" },
    calls: [{ id: "c1", name: "read_file", args: {} }],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, false);
  assert.equal(
    agentContext.bindings.extensions.harness.state.counters.planningCaptureAttempts || 0,
    1,
  );
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningPromptInjected, false);
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_capture_blocked_for_tool_call_turn",
    ),
    true,
  );
});
