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

test("harness planning disables blocked tools (except help) and injects request_task_acceptance tool", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const ctx = {
    userId: "u10",
    sessionId: "s10",
    dialogProcessId: "dp10",
    agentContext: {
      payload: {
        tools: {
          registry: [
            { name: "task_summary", invoke: async () => ({ ok: true }) },
            { name: "request_help", invoke: async () => ({ ok: true }) },
            { name: "read_file", invoke: async () => ({ ok: true }) },
          ],
        },
        messages: { system: [], history: [] },
      },
    },
  };

  await hookManager.emit("before_turn", ctx);
  const names = ctx.agentContext.payload.tools.registry.map((tool) => tool.name);
  assert.equal(names.includes("task_summary"), false);
  assert.equal(names.includes("request_help"), true);
  assert.equal(names.includes("read_file"), true);
  assert.equal(names.includes("request_task_acceptance"), true);
});

test("harness planning skips auxiliary scope llm hooks", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const messages = [{ role: "user", content: "auxiliary planning call" }];
  const ctx = {
    executionScope: "auxiliary",
    messages,
    agentContext: {
      payload: {
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        messages: { system: [], history: [] },
        harness: {},
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);
  assert.equal(messages.some((item = {}) => /harness-planning-bootstrap/.test(String(item?.content || ""))), false);
  const names = ctx.agentContext.payload.tools.registry.map((tool) => tool.name);
  assert.equal(names.includes("request_task_acceptance"), false);
});

test("harness planning injects refinement tool and tool call runs plugin-side refinement directly", async () => {
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
        if (payload.purpose === "planning_refinement") {
          return {
            content: "ADD 1.1 细化步骤一",
          };
        }
        return { content: "1. 解析附件\n2. 执行核心任务" };
      },
    },
  );

  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-refinement-opdir-"));
  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId: "u11-r",
          globalConfig: { tools: { execute_script: { sandboxMode: false } } },
          systemRuntime: { userId: "u11-r", sessionId: "s11-r" },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    ai: {
      content: "1. 解析附件\n2. 执行核心任务",
    },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);

  const messages = [{ role: "user", content: "继续处理" }];
  await hookManager.emit("before_llm_call", {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    messages,
    agentContext,
  });
  const refinementTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.ok(refinementTool, "request_plan_refinement 工具应注入");

  const toolResult = await refinementTool.invoke({ summary: "阶段完成，细化下一步" });
  assert.equal(toolResult?.ok, true);
  assert.equal(toolResult?.status, "completed");
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_refinement"),
    true,
  );
  assert.equal(Array.isArray(agentContext.payload.harness.planRefinementRecords), true);
  assert.equal(agentContext.payload.harness.planRefinementRecords.length >= 1, true);
  const followupMessage = messages.find((item = {}) =>
    /next_phase_plan_refinement_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.match(followupText, /\[Harness operation dir\] runtime\/ops_workdir/);
  assert.equal(followupText.includes(`Use (non-sandbox): ${basePath}/runtime/ops_workdir`), true);
});

test("harness planning does not inject refinement tool by default in programming scenario", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({ content: "1. 解析附件\n2. 执行核心任务" }),
    },
  );

  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
    execution: {
      controllers: {
        runtime: {
          runConfig: { scenarioProfile: { key: "programming", name: "编程" } },
          systemRuntime: {
            userId: "u11-rp",
            sessionId: "s11-rp",
            runConfig: { scenarioProfile: { key: "programming", name: "编程" } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    ai: { content: "1. 解析附件\n2. 执行核心任务" },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.notEqual(agentContext.payload.harness.state.pending.planRefinement, true);

  await hookManager.emit("before_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    messages: [{ role: "user", content: "继续处理" }],
    agentContext,
  });
  const refinementTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.equal(refinementTool, undefined);
});

test("harness request_plan_refinement falls back to closure meta when configurable meta lacks harness", async () => {
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
        if (payload.purpose === "planning_refinement") {
          return { content: "ADD 1.1 细化步骤一" };
        }
        return { content: "1. 解析附件\n2. 执行核心任务" };
      },
    },
  );

  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
    },
  };

  await hookManager.emit("before_llm_call", {
    userId: "u11-r2",
    sessionId: "s11-r2",
    dialogProcessId: "dp11-r2",
    messages: [{ role: "user", content: "开始任务" }],
    agentContext,
  });
  await hookManager.emit("after_llm_call", {
    userId: "u11-r2",
    sessionId: "s11-r2",
    dialogProcessId: "dp11-r2",
    ai: { content: "1. 解析附件\n2. 执行核心任务" },
    agentContext,
  });
  await hookManager.emit("before_llm_call", {
    userId: "u11-r2",
    sessionId: "s11-r2",
    dialogProcessId: "dp11-r2",
    messages: [{ role: "user", content: "继续处理" }],
    agentContext,
  });
  const refinementTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.ok(refinementTool, "request_plan_refinement 工具应注入");

  const toolResult = await refinementTool.invoke(
    { summary: "阶段完成，细化下一步" },
    {
      configurable: {
        noobotHookContext: { agentContext },
        noobotHookMeta: { systemRuntime: { userId: "u11-r2", sessionId: "s11-r2" } },
      },
    },
  );
  assert.equal(toolResult?.ok, true);
  assert.equal(toolResult?.status, "completed");
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_refinement"),
    true,
  );
});

test("harness planning allows tool-call turn without assistant text when planning tools are allowed", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityToolAllowlistByPurpose: {
        planning: ["read_file"],
      },
    },
  );
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
  assert.equal(agentContext.payload.harness.state.counters.planningCaptureAttempts || 0, 0);
  assert.equal(
    agentContext.payload.harness.logs.planning.some(
      (item) => item.event === "planning_capture_skipped_for_tool_call_turn",
    ),
    true,
  );
});

test("harness planning separate model uses resolved planning tool allowlist", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      stepModels: {
        planning: "planner_model_alias",
      },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: '{"taskChecklist":[{"index":1,"task":"执行核心任务","owner":"任务负责者1"}]}',
          output: '{"taskChecklist":[{"index":1,"task":"执行核心任务","owner":"任务负责者1"}]}',
          finishedReason: "no_tool_call",
          turn: 1,
          traces: [{ turn: 1, purpose: "planning", domain: "planning", locale: "zh-CN", toolCalls: [] }],
        };
      },
    },
  );

  const ctx = {
    userId: "u-planning-allowlist",
    sessionId: "s-planning-allowlist",
    dialogProcessId: "dp-planning-allowlist",
    caller: "user",
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "execute_script", invoke: async () => ({ ok: true }) }] },
      },
      execution: { controllers: { runtime: { systemRuntime: { config: {} } } } },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  assert.equal(invocations.length >= 1, true);
  assert.deepEqual(invocations[0].toolAllowlist, []);
  assert.equal(invocations[0].model, "planner_model_alias");
  assert.equal(invocations[0].promptVersion, "v1");
  assert.equal(invocations[0].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[0].messages);
  const contextPrompt = invocations[0].messages.find((item = {}) =>
    String(item?.role || "") === "user" &&
    /规划输入上下文摘要（精简）如下/.test(String(item?.content || "")));
  assert.match(String(contextPrompt?.content || ""), /"latestUserGoal": "开始任务"/);
  const taskPrompt = invocations[0].messages.find((item = {}) =>
    String(item?.role || "") === "system" &&
    /harness-planning-bootstrap/.test(String(item?.content || "")));
  assert.match(String(taskPrompt?.content || ""), /\[CURRENT_TASK_GOAL\]/);
  assert.match(String(taskPrompt?.content || ""), /\[PLAN\]/);
});
