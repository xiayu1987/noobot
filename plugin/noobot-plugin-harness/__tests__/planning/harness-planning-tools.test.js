/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTestHookContext,
  createTestModelResponse,
} from "../helpers/public-runtime-fixtures.js";
import {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  fs,
  os,
  path,
  registerHarnessCore,
  test,
} from "../helpers/harness-planning-helper.js";

test("harness planning disables blocked tools (except help) and injects request_task_acceptance tool", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );

  const ctx = {
    userId: "u10",
    sessionId: "s10",
    dialogProcessId: "dp10",
    agentContext: {
      bindings: {
        tools: [
          { name: "task_summary", invoke: async () => ({ ok: true }) },
          { name: "help", invoke: async () => ({ ok: true }) },
          { name: "read_file", invoke: async () => ({ ok: true }) },
        ],
      },
    },
  };

  await hookManager.emit("agent.before_turn", ctx);
  const names = ctx.agentContext.bindings.tools.map((tool) => tool.name);
  assert.equal(names.includes("task_summary"), false);
  assert.equal(names.includes("help"), true);
  assert.equal(names.includes("read_file"), true);
  assert.equal(names.includes("request_task_acceptance"), true);
});

test("harness planning skips auxiliary scope llm hooks", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    { planningGuidanceMode: "inject", trace: false, promptPolicy: false },
  );

  const messages = [{ role: "user", content: "auxiliary planning call" }];
  const ctx = {
    executionScope: "auxiliary",
    messageBlocks: { system: [], history: [], incremental: messages },
    agentContext: {
      bindings: {
        tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
        extensions: { harness: {} },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", ctx);
  assert.equal(
    messages.some((item = {}) => /harness-planning-bootstrap/.test(String(item?.content || ""))),
    false,
  );
  const names = ctx.agentContext.bindings.tools.map((tool) => tool.name);
  assert.equal(names.includes("request_task_acceptance"), false);
});

test("harness planning injects refinement tool and tool call runs plugin-side refinement directly", async () => {
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
        if (payload.purpose === "planning_refinement") {
          return createTestModelResponse(
            invocations.filter((item = {}) => item.purpose === "planning_refinement").length === 1
              ? "ADD 1.1 细化步骤一"
              : "ADD 2.1 细化步骤二",
          );
        }
        return createTestModelResponse("1. 解析附件\n2. 执行核心任务");
      },
    },
  );

  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-refinement-opdir-"));
  const agentContext = {
    bindings: {
      runtime: {
        basePath,
        userId: "u11-r",
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
        systemRuntime: { userId: "u11-r", sessionId: "s11-r" },
      },
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    modelResponse: { text: "1. 解析附件\n2. 执行核心任务" },
    calls: [],
    agentContext,
  });
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, true);

  const currentHookContext = {
    userId: "u11-r",
    sessionId: "s11-r",
    dialogProcessId: "dp11-r",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "继续处理" }],
    },
    agentContext,
  };
  await hookManager.emit("agent.before_llm_call", currentHookContext);
  const refinementTool = agentContext.bindings.tools.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.ok(refinementTool, "request_plan_refinement 工具应注入");

  const toolResult = await refinementTool.invoke(
    { summary: "阶段完成，细化下一步" },
    {
      signal: new AbortController().signal,
      configurable: { noobotHookContext: currentHookContext },
    },
  );
  assert.equal(toolResult?.ok, true);
  assert.equal(toolResult?.status, "completed");
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planRefinementRequested, true);
  assert.equal(
    agentContext.bindings.tools.some((tool) => tool?.name === "request_plan_refinement"),
    false,
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_refinement"),
    true,
  );
  assert.equal(Array.isArray(agentContext.bindings.extensions.harness.planRefinementRecords), true);
  assert.equal(agentContext.bindings.extensions.harness.planRefinementRecords.length >= 1, true);
  const followupMessage = currentHookContext.modelContext.messageBlocks.incremental.find(
    (item = {}) => /next_phase_plan_refinement_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.match(followupText, /\[Harness operation dir\] runtime\/ops_workdir/);
  assert.equal(followupText.includes(`Use (host): ${basePath}/runtime/ops_workdir`), true);
});

test("harness planning does not inject refinement tool by default in programming scenario", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => createTestModelResponse("1. 解析附件\n2. 执行核心任务"),
    },
  );

  const agentContext = {
    bindings: {
      runtime: {
        runConfig: { scenarioProfile: { key: "programming" } },
        systemRuntime: {
          userId: "u11-rp",
          sessionId: "s11-rp",
          runConfig: { scenarioProfile: { key: "programming" } },
        },
      },
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: { harness: {} },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext,
  });
  await hookManager.emit("agent.after_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    modelResponse: { text: "1. 解析附件\n2. 执行核心任务" },
    calls: [],
    agentContext,
  });
  assert.equal(agentContext.bindings.extensions.harness.state.flags.planningCaptured, true);
  assert.notEqual(agentContext.bindings.extensions.harness.state.pending.planRefinement, true);

  await hookManager.emit("agent.before_llm_call", {
    userId: "u11-rp",
    sessionId: "s11-rp",
    dialogProcessId: "dp11-rp",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "继续处理" }],
    },
    agentContext,
  });
  const refinementTool = agentContext.bindings.tools.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.equal(refinementTool, undefined);
});

test("harness exposes plan refinement before capture and the tool owns its not-ready state", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => createTestModelResponse("1. 执行核心任务"),
    },
  );
  const agentContext = {
    bindings: { tools: [], extensions: { harness: {} } },
  };

  await hookManager.emit("agent.before_llm_call", {
    userId: "u11-ready",
    sessionId: "s11-ready",
    dialogProcessId: "dp11-ready",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext,
  });
  const refinementTool = agentContext.bindings.tools.find(
    (tool) => tool?.name === "request_plan_refinement",
  );
  assert.ok(refinementTool);
  agentContext.bindings.extensions.harness.state.flags.planningCaptured = false;
  const result = await refinementTool.invoke(
    { targetMainStepIndexes: [1] },
    {
      signal: new AbortController().signal,
      configurable: { noobotHookContext: createTestHookContext({ agentContext }) },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "not_ready");
});

test("harness planning allows tool-call turn without assistant text when planning tools are allowed", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityToolAllowlistByPurpose: {
        planning: ["read_file"],
      },
    },
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
    0,
  );
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_capture_skipped_for_tool_call_turn",
    ),
    true,
  );
});

test("harness planning separate model uses resolved planning tool allowlist", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
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
        return createTestModelResponse("1. 执行核心任务");
      },
    },
  );

  const ctx = {
    userId: "u-planning-allowlist",
    sessionId: "s-planning-allowlist",
    dialogProcessId: "dp-planning-allowlist",
    caller: "user",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "开始任务" }],
    },
    agentContext: {
      bindings: {
        runtime: { systemRuntime: { config: {} } },
        tools: [{ name: "execute_script", invoke: async () => ({ ok: true }) }],
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", ctx);

  assert.equal(invocations.length >= 1, true);
  assert.deepEqual(invocations[0].toolAllowlist, []);
  assert.equal(invocations[0].model, "planner_model_alias");
  assert.equal(invocations[0].promptVersion, "v1");
  assert.equal(invocations[0].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[0].messages);
  const contextPrompt = invocations[0].messages.find(
    (item = {}) =>
      String(item?.role || "") === "user" &&
      /规划输入上下文摘要（精简）如下/.test(String(item?.content || "")),
  );
  assert.match(String(contextPrompt?.content || ""), /"latestUserGoal": "开始任务"/);
  const taskPrompt = invocations[0].messages.find(
    (item = {}) =>
      String(item?.role || "") === "system" &&
      /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  assert.match(String(taskPrompt?.content || ""), /\[CURRENT_TASK_GOAL\]/);
  assert.match(String(taskPrompt?.content || ""), /\[PLAN\]/);
});
