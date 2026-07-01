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

test("harness planning prompt includes current tool names and descriptions", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const messages = [{ role: "user", content: "开始任务" }];
  const ctx = {
    messages,
    agentContext: {
      payload: {
        tools: {
          registry: [
            { name: "read_file", description: "读取文件内容", invoke: async () => ({ ok: true }) },
            { name: "web_to_data", description: "抓取网页并提取结构化信息", invoke: async () => ({ ok: true }) },
          ],
        },
        messages: { system: [], history: [] },
        harness: {},
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);
  const planningPromptMessage = messages.find((item = {}) =>
    /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  const planningPrompt = String(planningPromptMessage?.content || "");
  const toolsPrompt = messages.find((item = {}) =>
    /harness-planning-tools/.test(String(item?.content || "")),
  );
  const toolsPromptText = String(toolsPrompt?.content || "");
  assert.equal(String(planningPromptMessage?.role || ""), "user");
  assert.match(planningPrompt, /harness-planning-bootstrap/);
  assert.match(planningPrompt, /\[CURRENT_TASK_GOAL\]/);
  assert.match(planningPrompt, /\[PLAN\]/);
  assert.match(toolsPromptText, /可用工具（name\/description）/);
  assert.match(toolsPromptText, /"name": "read_file"/);
  assert.match(toolsPromptText, /"description": "读取文件内容"/);
  assert.match(toolsPromptText, /"name": "web_to_data"/);
});

test("harness initial planning keeps scenario policy out of text protocol and responsibility", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const messages = [{ role: "user", content: "整理这些文本资料" }];
  const ctx = {
    messages,
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: { dynamicPolicyPrompt: { prompt: "Dynamic test scenario policy" } },
      },
      execution: {
        controllers: {
          runtime: {
            runConfig: { scenario: "text" },
            systemRuntime: { config: {}, runConfig: { scenario: "text" } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const planningIndex = messages.findIndex((item = {}) =>
    /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  const policyIndex = messages.findIndex((item = {}) =>
    /Dynamic test scenario policy/.test(String(item?.content || "")),
  );
  const responsibilityIndex = messages.findIndex((item = {}) =>
    /请根据上下文进行「规划」，按文本协议返回（如果有）。/.test(String(item?.content || "")),
  );

  assert.equal(planningIndex >= 0, true);
  assert.equal(policyIndex, -1);
  assert.equal(responsibilityIndex > planningIndex, true);
  assert.equal(messages[responsibilityIndex].role, "user");
  assert.doesNotMatch(String(messages[planningIndex].content || ""), /Dynamic test scenario policy/);
  assert.doesNotMatch(String(messages[responsibilityIndex].content || ""), /Dynamic test scenario policy/);
});

test("harness planning followup uses text deliverable-batch policy in text scenario", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({ content: "1. 批量抽取资料\n2. 撰写阶段产物" }),
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "整理这些文本资料" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
      execution: {
        controllers: {
          runtime: {
            runConfig: { scenario: "text" },
            systemRuntime: { config: {}, runConfig: { scenario: "text" } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const followupMessage = ctx.messages.find((item = {}) =>
    /planning_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.match(followupText, /具体推进方式遵守系统场景策略/);
  assert.doesNotMatch(followupText, /\[HARNESS_SCENARIO_POLICY\]/);
  assert.doesNotMatch(followupText, /最小切片循环执行/);
});

test("harness planning captures dynamic policy prompt protocol from separate model", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({
        content: [
          "1. 消费资料并形成阶段产物",
          "2. 检查来源与格式",
          "[HARNESS_DYNAMIC_POLICY_PROMPT]",
          "scenario = text",
          "reason = use task-specific output policy",
          "prompt:",
          "Dynamic policy: produce deliverable text batches, preserve source paths, and avoid tiny execution slices.",
          "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
        ].join("\n"),
      }),
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "整理资料" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
      execution: {
        controllers: {
          runtime: {
            runConfig: { scenario: "text" },
            systemRuntime: { config: {}, runConfig: { scenario: "text" } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const dynamicPolicyPrompt = ctx.agentContext.payload.harness.dynamicPolicyPrompt || {};
  assert.equal(dynamicPolicyPrompt.scenario, "text");
  assert.match(
    String(dynamicPolicyPrompt.prompt || ""),
    /Dynamic policy: produce deliverable text batches/,
  );
});

test("harness planning followup uses dynamic programming scenario over initial text scenario", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({
        content: [
          "1. 检查仓库",
          "2. 修改代码并运行测试",
          "[HARNESS_DYNAMIC_POLICY_PROMPT]",
          "scenario = programming",
          "reason = actual user intent is code change",
          "prompt:",
          "Dynamic policy: perform smallest-slice reversible code changes and verify after each step.",
          "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
        ].join("\n"),
      }),
    },
  );

  const ctx = {
    messages: [{ role: "user", content: "修一下 harness 插件里的代码" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
      execution: {
        controllers: {
          runtime: {
            runConfig: { scenario: "text" },
            systemRuntime: { config: {}, runConfig: { scenario: "text" } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const dynamicPolicyPrompt = ctx.agentContext.payload.harness.dynamicPolicyPrompt || {};
  assert.equal(dynamicPolicyPrompt.scenario, "programming");

  const followupMessage = ctx.messages.find((item = {}) =>
    /planning_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.doesNotMatch(followupText, /文本场景策略/);
  assert.doesNotMatch(followupText, /Dynamic policy: perform smallest-slice reversible code changes and verify after each step/);
  assert.doesNotMatch(followupText, /建议外部文本拿到就保真消费/);
});

test("harness planning separate model keeps latest user goal in planning context summary", async () => {
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
          content:
            '{"totalGoal":"完成用户请求","taskOwner":"AI Agent","nextPhase":{"objective":"推进首步","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"分析用户目标","owner":"AI Agent","subOwners":[],"input":"用户诉求与上下文","output":"可执行任务分解","files":{"create":[],"modify":[],"delete":[]}}]}',
        };
      },
    },
  );

  const ctx = {
    messages: [],
    userMessage: "查找最适合组织的人",
    agentContext: {
      payload: {
        messages: {
          system: [],
          history: [
            { role: "user", content: "重新查找最适合AI开发的人" },
            { role: "assistant", content: "已给出AI开发TOP榜单" },
            { role: "user", content: "查找最适合组织的人" },
          ],
        },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);
  assert.equal(invocations.length >= 1, true);
  const allMessagesText = invocations[0].messages.map((item = {}) => String(item?.content || "")).join("\n");
  assert.match(allMessagesText, /查找最适合组织的人/);
  assert.doesNotMatch(allMessagesText, /重新查找最适合AI开发的人/);
});

test("harness planning operation directory uses sandbox view without losing host view", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const hostBasePath = "/host/user-a";
  const sandboxBasePath = "/workspace/user-a";
  const messages = [{ role: "user", content: "开始任务" }];
  const ctx = {
    messages,
    agentContext: {
      environment: {
        // Simulates the harness-side bug class: environment.workspace has
        // already been rewritten to sandbox view, while runtime.basePath still
        // keeps the non-sandbox host path.
        workspace: { basePath: sandboxBasePath },
        staticInfo: { defaultWorkdir: `${sandboxBasePath}/runtime/ops_workdir` },
      },
      payload: {
        tools: { registry: [{ name: "read_file", description: "读取文件", invoke: async () => ({ ok: true }) }] },
        messages: { system: [], history: [] },
        harness: {},
      },
      execution: {
        controllers: {
          runtime: {
            basePath: hostBasePath,
            userId: "user-a",
            globalConfig: {
              tools: {
                execute_script: {
                  sandbox_mode: true,
                  sandbox_provider: { default: "docker" },
                },
              },
            },
            sharedTools: {
              resolveSandboxPath: ({ hostPath = "", relativePath = "" } = {}) => {
                if (hostPath === `${hostBasePath}/runtime/ops_workdir`) {
                  return `${sandboxBasePath}/runtime/ops_workdir`;
                }
                return relativePath ? `${sandboxBasePath}/${relativePath}` : "";
              },
            },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const contextMessage = messages.find((item = {}) =>
    /"operationDirectory"/.test(String(item?.content || "")),
  );
  const contextText = String(contextMessage?.content || "");
  assert.match(contextText, /"operationDirectory"/);
  assert.match(contextText, /"relativePath": "runtime\/ops_workdir"/);
  assert.match(contextText, /"absolutePath": "\/workspace\/user-a\/runtime\/ops_workdir"/);
  assert.match(contextText, /"view": "sandbox"/);
  assert.doesNotMatch(contextText, /"nonSandboxView"/);
  assert.doesNotMatch(contextText, /\/host\/user-a\/runtime\/ops_workdir/);
});

test("harness separate-model plan relay includes operation directory for main agent", async () => {
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

  const basePath = "/host/user-b";
  const ctx = {
    userId: "user-b",
    sessionId: "s-user-b",
    messages: [{ role: "user", content: "开始任务" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
        harness: {},
      },
      execution: {
        controllers: {
          runtime: {
            basePath,
            userId: "user-b",
            systemRuntime: { userId: "user-b", sessionId: "s-user-b" },
            globalConfig: { tools: { execute_script: { sandboxMode: false } } },
          },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  const relayMessage = ctx.messages.find((item = {}) =>
    /Harness operation dir/.test(String(item?.content || "")),
  );
  const relayText = String(relayMessage?.content || "");
  assert.match(relayText, /\[Harness operation dir\] runtime\/ops_workdir/);
  assert.match(relayText, /Use \(non-sandbox\): \/host\/user-b\/runtime\/ops_workdir/);
  assert.doesNotMatch(relayText, /Sandbox:/);
  assert.match(relayText, /1\. 解析附件/);
  assert.equal(ctx.agentContext.payload.harness.operationDirectory.absolutePath, `${basePath}/runtime/ops_workdir`);
});
