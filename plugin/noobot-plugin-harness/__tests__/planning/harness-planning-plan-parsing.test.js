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

test("harness planning accepts numbered plain-text plan output", async () => {
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
    ai: {
      content: "1. 解析附件\n2. 执行核心任务\n3. 启动子任务",
    },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.match(String(agentContext.payload.harness.planText || ""), /1\. 解析附件/);
});

test("harness planning ignores wrapped non-plan payload even when non-empty", async () => {
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
    ai: {
      content: JSON.stringify({
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
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(String(agentContext.payload.harness.planText || "").trim(), "");
});

test("harness planning rejects malformed non-plan json text", async () => {
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

  await hookManager.emit("before_llm_call", {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    ai: { content: "{\"taskChecklist\":[{index:1,task:\"解析附件\"}]}" },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(String(agentContext.payload.harness.planText || "").trim(), "");
});

test("harness planning uses plan text flow without json repair", async () => {
  const hookManager = createAgentHookManager();
  const purposes = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async ({ purpose }) => {
        purposes.push(purpose);
        if (purpose === "planning_json_repair") return { content: "{}" };
        return { content: "1. 解析附件\n2. 执行核心任务" };
      },
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
      execution: { controllers: { runtime: { systemRuntime: { config: {} } } } },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  assert.equal(purposes.includes("planning"), true);
  assert.equal(purposes.includes("planning_json_repair"), false);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
  assert.equal(String(ctx.agentContext.payload.harness.planText || "").trim().length > 0, true);
});

test("harness planning requires parseable main plan payload", async () => {
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
        return {
          content: '{"taskChecklist":[{"index":1,"task":"执行核心任务","owner":"任务负责者1"}]}',
        };
      },
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "execute_script", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);
  assert.equal(invocations.length >= 1, true);
  assertFlatCapabilityMessages(invocations[0].messages);

  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(Array.isArray(ctx.agentContext.payload.harness.taskChecklist), true);
  assert.equal(ctx.agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(String(ctx.agentContext.payload.harness.planText || "").trim().length > 0, false);
});
