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
import { registerNoobotPlugin } from "../src/index.js";
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
    /职责约束：你当前仅负责「规划」/.test(String(item?.content || "")),
  );

  assert.equal(planningIndex >= 0, true);
  assert.equal(policyIndex, -1);
  assert.equal(responsibilityIndex > planningIndex, true);
  assert.equal(messages[responsibilityIndex].role, "user");
  assert.doesNotMatch(String(messages[planningIndex].content || ""), /Dynamic test scenario policy/);
  assert.doesNotMatch(String(messages[responsibilityIndex].content || ""), /Dynamic test scenario policy/);
});

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
  assert.match(String(result.output), /Harness-验收/);
  assert.match(String(result.output), /#### 完整计划清单/);
  assert.match(String(result.output), /1\. \[pending\] 解析附件/);
  assert.match(String(result.output), /#### 汇总/);
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

test("harness writes capability model traces to dedicated jsonl artifact", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({
        content: '{"taskOwner":"Noobot","taskChecklist":[{"index":1,"task":"检查上下文","owner":"Noobot"}]}',
        output: '{"taskOwner":"Noobot","taskChecklist":[{"index":1,"task":"检查上下文","owner":"Noobot"}]}',
        finishedReason: "no_tool_call",
        turn: 1,
        traces: [
          {
            turn: 1,
            purpose: "planning",
            domain: "planning",
            locale: "zh-CN",
            toolCalls: [{ name: "call_service", id: "c1", status: "executed" }],
          },
        ],
      }),
    },
  );

  const ctx = {
    executionScope: "primary",
    userId: "u7",
    sessionId: "s7",
    dialogProcessId: "dp7",
    caller: "user",
    messages: [{ role: "user", content: "hello" }],
    agentContext: {
      payload: { messages: { system: [], history: [] } },
      execution: { controllers: { runtime: { basePath } } },
    },
  };
  await hookManager.emit("before_llm_call", ctx);

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp7");
  const traceFile = path.join(runDir, "capability-traces.jsonl");
  assert.equal(await waitForFile(traceFile), true);
  const [line] = (await fs.readFile(traceFile, "utf8")).trim().split("\n");
  const record = JSON.parse(line);
  assert.equal(record.event, "capability_model_trace");
  assert.equal(record.detail.purpose, "planning");
  assert.equal(record.detail.traces[0].toolCalls[0].status, "executed");

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.paths.capabilityTraces, traceFile);
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
  const constraintPrompt = invocations[0].messages.find((item = {}) =>
    String(item?.role || "") === "system" &&
    /规划输入上下文摘要（精简）如下/.test(String(item?.content || "")));
  assert.match(String(constraintPrompt?.content || ""), /"latestUserGoal": "开始任务"/);
  const taskPrompt = invocations[0].messages.find((item = {}) =>
    String(item?.role || "") === "system" &&
    /harness-planning-bootstrap/.test(String(item?.content || "")));
  assert.match(String(taskPrompt?.content || ""), /\[CURRENT_TASK_GOAL\]/);
  assert.match(String(taskPrompt?.content || ""), /\[PLAN\]/);
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
