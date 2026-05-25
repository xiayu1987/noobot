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
  assert.equal(roles.includes("user"), true);
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(String(last.role || ""), "user");
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
  const planningPrompt = String(messages.at(-1)?.content || "");
  const toolsPrompt = messages.find((item = {}) =>
    /harness-planning-tools/.test(String(item?.content || "")),
  );
  const toolsPromptText = String(toolsPrompt?.content || "");
  assert.equal(String(messages.at(-1)?.role || ""), "user");
  assert.match(planningPrompt, /harness-planning-bootstrap/);
  assert.match(toolsPromptText, /可用工具（name\/description）/);
  assert.match(toolsPromptText, /"name": "read_file"/);
  assert.match(toolsPromptText, /"description": "读取文件内容"/);
  assert.match(toolsPromptText, /"name": "web_to_data"/);
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
  assert.match(String(messages.at(-1)?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    ai: {
      content:
        "{\"totalGoal\":\"完成任务\",\"taskChecklist\":[{\"index\":1,\"task\":\"解析附件\",\"owner\":\"任务负责者1\",\"input\":\"附件\",\"output\":\"解析结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}},{\"index\":2,\"task\":\"等待子任务结果\",\"owner\":\"任务负责者1\",\"input\":\"子任务句柄\",\"output\":\"子任务结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}}]}",
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
    /taskChecklist/,
  );

  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    result,
    agentContext,
  });
  assert.match(String(result.output), /Harness-Forced-Acceptance/);
  assert.match(String(result.output), /"mode": "forced"/);
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

  const agentContext = {
    payload: {
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      messages: { system: [], history: [] },
      harness: {},
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
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_refinement"),
    true,
  );
  assert.equal(Array.isArray(agentContext.payload.harness.planRefinementRecords), true);
  assert.equal(agentContext.payload.harness.planRefinementRecords.length >= 1, true);
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

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(agentContext.payload.harness.state.flags.planningPromptInjected, true);
  assert.equal(agentContext.execution.controllers.runtime.systemRuntime.config.forceTool, undefined);

  const secondMessages = [{ role: "user", content: "继续" }];
  await hookManager.emit("before_llm_call", { messages: secondMessages, agentContext });
  assert.doesNotMatch(String(secondMessages.at(-1)?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    ai: { content: "{\"totalGoal\":\"完成任务\",\"taskChecklist\":[{\"index\":1,\"task\":\"解析附件\",\"input\":\"附件\",\"output\":\"解析结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}},{\"index\":2,\"task\":\"执行核心任务\",\"input\":\"需求\",\"output\":\"执行结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}}]}" },
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
    ai: { content: "{\"totalGoal\":\"完成任务\",\"taskChecklist\":[{\"index\":1,\"task\":\"执行核心任务\",\"input\":\"需求\",\"output\":\"执行结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}}]}" },
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

test("harness planning keeps wrapped payload text when response is non-empty", async () => {
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

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.match(String(agentContext.payload.harness.planText || ""), /toolName/);
});

test("harness planning accepts malformed json text when response is non-empty", async () => {
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

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, true);
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
        return { content: '{"taskChecklist":[{bad json}]' };
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

  assert.deepEqual(purposes, ["planning"]);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
  assert.equal(String(ctx.agentContext.payload.harness.planText || "").trim().length > 0, true);
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

test("harness planning only checks non-empty plan text payload", async () => {
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

  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(Array.isArray(ctx.agentContext.payload.harness.taskChecklist), true);
  assert.equal(ctx.agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(String(ctx.agentContext.payload.harness.planText || "").trim().length > 0, true);
});
