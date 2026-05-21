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
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("harness planning disables blocked tools and injects request_task_acceptance tool", async () => {
  const hookManager = createHookManager();
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
  assert.equal(names.includes("request_help"), false);
  assert.equal(names.includes("read_file"), true);
  assert.equal(names.includes("request_task_acceptance"), true);
});

test("harness planning skips auxiliary scope llm hooks", async () => {
  const hookManager = createHookManager();
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
  const hookManager = createHookManager();
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
  assert.equal(String(messages.at(-1)?.role || ""), "user");
  assert.match(planningPrompt, /当前可用工具（名称与说明）如下/);
  assert.match(planningPrompt, /"name": "read_file"/);
  assert.match(planningPrompt, /"description": "读取文件内容"/);
  assert.match(planningPrompt, /"name": "web_to_data"/);
});

test("harness planning captures checklist and forces acceptance at final output", async () => {
  const hookManager = createHookManager();
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
  assert.equal(agentContext.payload.harness.taskChecklist.length, 2);
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

test("harness planning retries injection when first response has no checklist", async () => {
  const hookManager = createHookManager();
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
  assert.match(String(secondMessages.at(-1)?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    ai: { content: "{\"totalGoal\":\"完成任务\",\"taskChecklist\":[{\"index\":1,\"task\":\"解析附件\",\"input\":\"附件\",\"output\":\"解析结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}},{\"index\":2,\"task\":\"执行核心任务\",\"input\":\"需求\",\"output\":\"执行结果\",\"files\":{\"create\":[],\"modify\":[],\"delete\":[]}}]}" },
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(agentContext.payload.harness.taskChecklist.length, 2);
});

test("harness planning does not mutate runtime forceTool config", async () => {
  const hookManager = createHookManager();
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

test("harness planning skips capture on tool-call turn without assistant text", async () => {
  const hookManager = createHookManager();
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
  assert.equal(agentContext.payload.harness.state.counters.planningCaptureAttempts || 0, 0);
});

test("harness planning rejects numbered plain-text checklist output without complete plan payload", async () => {
  const hookManager = createHookManager();
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

  assert.equal(agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_incomplete_rejected"),
    true,
  );
});

test("harness planning can parse checklist wrapped in tool result payload", async () => {
  const hookManager = createHookManager();
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

  assert.equal(agentContext.payload.harness.taskChecklist.length, 2);
  assert.equal(agentContext.payload.harness.taskChecklist[0].task, "解析附件");
});

test("harness planning still retries when malformed json appears but no repair invoker is configured", async () => {
  const hookManager = createHookManager();
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
  assert.equal(agentContext.payload.harness.state.flags.planningPromptInjected, false);
});

test("harness planning falls back to default checklist when json repair is unusable", async () => {
  const hookManager = createHookManager();
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

  assert.deepEqual(purposes, ["planning", "planning_json_repair"]);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "default");
  assert.equal(ctx.agentContext.payload.harness.taskChecklist.length > 0, true);
  assert.equal(
    ctx.agentContext.payload.harness.logs.planning.some(
      (item) => item.event === "planning_default_checklist_applied",
    ),
    true,
  );
});

test("harness writes capability model traces to dedicated jsonl artifact", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
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
  const hookManager = createHookManager();
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
});

test("harness planning rejects incomplete checklist payload without totalGoal or io-file fields", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => ({
        content: '{"taskChecklist":[{"index":1,"task":"执行核心任务","owner":"任务负责者1"}]}',
      }),
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

  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, false);
  assert.equal(Array.isArray(ctx.agentContext.payload.harness.taskChecklist), true);
  assert.equal(ctx.agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(
    ctx.agentContext.payload.harness.logs.planning.some(
      (item) => item.event === "planning_checklist_incomplete_rejected",
    ),
    true,
  );
});
