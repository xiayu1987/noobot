/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestModelResponse } from "../helpers/public-runtime-fixtures.js";
import {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  registerHarnessCore,
  test,
} from "../helpers/harness-planning-helper.js";

test("harness planning accepts numbered plain-text plan output", async () => {
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
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: "1. 解析附件\n2. 执行核心任务\n3. 启动子任务" },
    calls: [],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, true);
  assert.match(String(agentContext.bindings.extensions.harness.planText || ""), /1\. 解析附件/);
});

test("harness planning ignores wrapped non-plan payload even when non-empty", async () => {
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
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: {
      text: JSON.stringify({
        toolName: "execute_script",
        ok: true,
        stdout: JSON.stringify({
          totalGoal: "完成任务",
          taskChecklist: [
            {
              index: 1,
              task: "解析附件",
              owner: "任务负责者1",
              input: "附件",
              output: "解析结果",
              files: { create: [], modify: [], delete: [] },
            },
            {
              index: 2,
              task: "执行核心任务",
              owner: "任务负责者1",
              input: "需求",
              output: "执行结果",
              files: { create: [], modify: [], delete: [] },
            },
          ],
        }),
      }),
    },
    calls: [],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, false);
  assert.equal(String(agentContext.bindings.extensions.harness.planText || "").trim(), "");
});

test("harness planning rejects malformed non-plan json text", async () => {
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

  await hookManager.emit("agent.before_llm_call", {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    modelResponse: { text: '{"taskChecklist":[{index:1,task:"解析附件"}]}' },
    calls: [],
    agentContext,
  });

  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, false);
  assert.equal(String(agentContext.bindings.extensions.harness.planText || "").trim(), "");
});

test("harness planning uses plan text flow without json repair", async () => {
  const hookManager = createAgentHookManager();
  const purposes = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async ({ purpose }) => {
        purposes.push(purpose);
        if (purpose === "planning_json_repair") return createTestModelResponse("{}");
        return createTestModelResponse("1. 解析附件\n2. 执行核心任务");
      },
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      bindings: {
        runtime: { systemRuntime: { config: {} } },
        tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
        extensions: { harness: {} },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", ctx);

  assert.equal(purposes.includes("planning"), true);
  assert.equal(purposes.includes("planning_json_repair"), false);
  assert.equal("taskChecklistSource" in ctx.agentContext.bindings.extensions.harness, false);
  assert.equal(
    String(ctx.agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    true,
  );
});

test("harness planning requires parseable main plan payload", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return createTestModelResponse(
          '{"taskChecklist":[{"index":1,"task":"执行核心任务","owner":"任务负责者1"}]}',
        );
      },
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      bindings: {
        tools: [{ name: "execute_script", invoke: async () => ({ ok: true }) }],
        extensions: { harness: {} },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", ctx);
  assert.equal(invocations.length >= 1, true);
  assertFlatCapabilityMessages(invocations[0].messages);

  assert.equal(ctx.agentContext.bindings.extensions.harness.state.flags.planningCaptured, false);
  assert.equal("taskChecklist" in ctx.agentContext.bindings.extensions.harness, false);
  assert.equal(
    String(ctx.agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    false,
  );
});
