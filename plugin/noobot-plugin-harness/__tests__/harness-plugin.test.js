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

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function waitForFile(file, retries = 200, delayMs = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await exists(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return String(text || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("harness plugin writes manifest, events and context snapshot", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, promptPolicy: false });

  const agentContext = {
    environment: {
      os: { platform: "linux" },
      workspace: { basePath, cwd: "/project" },
      identity: { userId: "u1" },
    },
    execution: {
      dialogProcessId: "dp1",
      flags: { allowUserInteraction: true },
      models: { runtimeModel: "m1" },
      controllers: { runtime: { basePath, userId: "u1", systemRuntime: { sessionId: "s1", dialogProcessId: "dp1" } } },
    },
    session: { current: { id: "s1", attachments: [], connectors: {} }, parent: { id: "", caller: "user" } },
    payload: { messages: { system: [], history: [{ role: "user", content: "hi" }] } },
  };

  await hookManager.emit("after_context_build", {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    caller: "user",
    status: "success",
    agentContext,
  });
  await hookManager.emit("after_turn", {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    caller: "user",
    status: "success",
    agentContext,
  });

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp1");
  assert.equal(await exists(path.join(runDir, "harness-run.json")), true);
  assert.equal(await exists(path.join(runDir, "events.jsonl")), true);
  assert.equal(await exists(path.join(runDir, "context-snapshot.json")), true);

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.status, "success");
  assert.equal(manifest.dialogProcessId, "dp1");

  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, "context-snapshot.json"), "utf8"));
  assert.equal(snapshot.userId, "u1");
  assert.equal(snapshot.payload.historyMessageCount, 1);
});

test("harness plugin rejects illegal FSM transitions and audits state commits", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    { basePath, promptPolicy: false, manifestDebounceMs: 0 },
  );

  await hookManager.emit("before_tool_calls", {
    userId: "u-fsm",
    sessionId: "s-fsm",
    dialogProcessId: "dp-fsm",
  });
  await hookManager.emit("on_error", {
    userId: "u-fsm",
    sessionId: "s-fsm",
    dialogProcessId: "dp-fsm",
    error: new Error("forced"),
  });

  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp-fsm");
  await waitForFile(path.join(runDir, "state-commits.jsonl"));
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "failed");

  const commits = await readJsonl(path.join(runDir, "state-commits.jsonl"));
  assert.equal(commits.some((item) => item.type === "fsm_transition_rejected"), true);
  assert.equal(commits.some((item) => item.type === "fsm_transition" && item.to === "failed"), true);
});

test("harness plugin can resume FSM from manifest checkpoint", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp-resume");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "harness-run.json"),
    JSON.stringify(
      {
        status: "running",
        fsmStatus: "planning",
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  {
    const hookManager = createHookManager();
    registerNoobotPlugin(
      { hookManager },
      { basePath, promptPolicy: false, manifestDebounceMs: 0 },
    );
    await hookManager.emit("after_llm_call", {
      userId: "u-resume",
      sessionId: "s-resume",
      dialogProcessId: "dp-resume",
      agentContext: {
        payload: {
          harness: {
            taskChecklist: [{ index: 1, task: "t1" }],
          },
        },
      },
    });
  }

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "planned");
  assert.equal(manifest.fsm?.resumedFromCheckpoint, true);

  await waitForFile(path.join(runDir, "state-commits.jsonl"));
  const commits = await readJsonl(path.join(runDir, "state-commits.jsonl"));
  assert.equal(commits.some((item) => item.type === "fsm_resume"), true);
  assert.equal(commits.some((item) => item.type === "fsm_transition" && item.to === "planned"), true);
});

test("harness FSM transition matrix (table-driven)", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  const runId = "dp-fsm-matrix";
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      manifestDebounceMs: 0,
      jsonlBatchSize: 1,
      jsonlFlushIntervalMs: 0,
    },
  );
  const runDir = path.join(basePath, "runtime", "harness", "runs", runId);
  const manifestPath = path.join(runDir, "harness-run.json");
  const stateCommitsPath = path.join(runDir, "state-commits.jsonl");

  const cases = [
    {
      name: "idle -> planning",
      point: "before_turn",
      ctx: {},
      expectedState: "planning",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "planning -> planned",
      point: "after_llm_call",
      ctx: {
        agentContext: {
          payload: {
            harness: {
              taskChecklist: [{ index: 1, task: "拆解任务" }],
            },
          },
        },
      },
      expectedState: "planned",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "planned -> executing",
      point: "before_tool_calls",
      ctx: {},
      expectedState: "executing",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "executing -> verifying",
      point: "before_final_output",
      ctx: { result: { output: "ok" } },
      expectedState: "verifying",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "verifying -> done",
      point: "after_turn",
      ctx: {},
      expectedState: "done",
      expectedAccepted: true,
      expectedCommitType: "fsm_transition",
    },
    {
      name: "done -X-> executing should be rejected",
      point: "before_tool_calls",
      ctx: {},
      expectedState: "done",
      expectedAccepted: false,
      expectedCommitType: "fsm_transition_rejected",
      expectedAttemptedTo: "executing",
    },
  ];

  let seenCommits = 0;
  for (const item of cases) {
    await hookManager.emit(item.point, {
      userId: "u-fsm-matrix",
      sessionId: "s-fsm-matrix",
      dialogProcessId: runId,
      ...item.ctx,
    });

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.fsmStatus, item.expectedState, item.name);

    await waitForFile(stateCommitsPath);
    const commits = await readJsonl(stateCommitsPath);
    assert.equal(commits.length > seenCommits, true, `${item.name}: no new state commit`);
    const last = commits[commits.length - 1];
    seenCommits = commits.length;

    assert.equal(last.type, item.expectedCommitType, item.name);
    assert.equal(last.accepted, item.expectedAccepted, item.name);
    if (item.expectedAccepted) {
      assert.equal(last.to, item.expectedState, item.name);
    } else {
      assert.equal(last.from, "done", item.name);
      assert.equal(last.to, item.expectedAttemptedTo, item.name);
    }
  }
});

test("harness FSM remains planning when checklist is absent", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      manifestDebounceMs: 0,
      jsonlBatchSize: 1,
      jsonlFlushIntervalMs: 0,
    },
  );
  const runId = "dp-fsm-stay";
  const runDir = path.join(basePath, "runtime", "harness", "runs", runId);

  await hookManager.emit("before_turn", {
    userId: "u-fsm-stay",
    sessionId: "s-fsm-stay",
    dialogProcessId: runId,
  });
  await hookManager.emit("after_llm_call", {
    userId: "u-fsm-stay",
    sessionId: "s-fsm-stay",
    dialogProcessId: runId,
    ai: { content: "先读取上下文" },
    agentContext: {
      payload: {
        harness: {
          taskChecklist: [],
        },
      },
    },
  });

  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(manifest.fsmStatus, "planning");
  const commits = await readJsonl(path.join(runDir, "state-commits.jsonl"));
  assert.equal(commits.some((item) => item.type === "fsm_transition" && item.to === "planned"), false);
});

test("harness plugin injects prompt into before_llm_call messages", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, trace: false });
  const messages = [{ role: "user", content: "hello" }];

  await hookManager.emit("before_llm_call", {
    userId: "u2",
    sessionId: "s2",
    dialogProcessId: "dp2",
    messages,
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /noobot-harness-policy/);
  assert.match(messages[0].content, /用户隔离/);
});

test("harness plugin exposes capability handler skeleton and hook mapping in manifest", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  const calls = [];
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      capabilityHandlers: {
        planning: async ({ point }) => {
          calls.push(point);
          return { capability: "planning", status: "planned" };
        },
      },
    },
  );

  await hookManager.emit("before_turn", {
    userId: "u3",
    sessionId: "s3",
    dialogProcessId: "dp3",
    caller: "user",
    status: "start",
  });
  await hookManager.emit("after_turn", {
    userId: "u3",
    sessionId: "s3",
    dialogProcessId: "dp3",
    caller: "user",
    status: "success",
  });

  assert.equal(calls.includes("before_turn"), true);
  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp3");
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(Array.isArray(manifest?.capabilities?.domains), true);
  assert.equal(typeof manifest?.capabilities?.hookMap, "object");
});

test("harness capability hook can take over tool calls", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "before_tool_calls") return null;
          return {
            capability: "acceptance",
            status: "active",
            toolTakeover: {
              allowToolNames: ["wait"],
              forceCall: { name: "wait", args: { seconds: 1 } },
              mode: "replace",
            },
          };
        },
      },
    },
  );

  const ctx = {
    userId: "u4",
    sessionId: "s4",
    dialogProcessId: "dp4",
    phase: "tool_calls",
    status: "start",
    calls: [
      { name: "web_search", args: { q: "abc" } },
      { name: "request_help", args: {} },
    ],
  };

  await hookManager.emit("before_tool_calls", ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0]?.name, "wait");
  assert.equal(ctx.calls[0]?.args?.seconds, 1);
});

test("harness capability hook can force inject system message in mid hooks", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "before_tool_calls") return null;
          return {
            systemMessageTakeover: {
              id: "harness-mid-hook-guard",
              content: "中途工具阶段触发：请先执行安全检查再继续。",
              mode: "prepend",
              target: "agent_system",
            },
          };
        },
      },
    },
  );

  const ctx = {
    userId: "u5",
    sessionId: "s5",
    dialogProcessId: "dp5",
    calls: [{ name: "wait", args: { seconds: 1 } }],
    agentContext: {
      payload: {
        messages: {
          system: [{ role: "system", content: "existing system message" }],
        },
      },
    },
  };

  await hookManager.emit("before_tool_calls", ctx);
  assert.equal(ctx.agentContext.payload.messages.system.length, 2);
  assert.match(
    String(ctx.agentContext.payload.messages.system[0]?.content || ""),
    /harness-mid-hook-guard/,
  );
});

test("harness capability hook can take over and remove agent internal forced messages", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "before_llm_call") return null;
          return {
            messageTakeover: {
              removeInternalMessageTypes: ["tool_choice_required_retry_prompt"],
              id: "harness-replace-retry-prompt",
              content: "工具重试提示由 harness 接管。",
              mode: "prepend",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const ctx = {
    userId: "u6",
    sessionId: "s6",
    dialogProcessId: "dp6",
    messages: [
      {
        role: "user",
        content: "internal retry prompt",
        additional_kwargs: {
          noobotInternalMessageType: "tool_choice_required_retry_prompt",
        },
      },
      { role: "user", content: "real user message" },
    ],
  };

  await hookManager.emit("before_llm_call", ctx);
  assert.equal(ctx.messages.length, 2);
  assert.match(String(ctx.messages[0]?.content || ""), /harness-replace-retry-prompt/);
  assert.equal(
    ctx.messages.some(
      (msg) => msg?.additional_kwargs?.noobotInternalMessageType === "tool_choice_required_retry_prompt",
    ),
    false,
  );
});


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
  assert.doesNotMatch(String(messages[0]?.content || ""), /harness-planning-bootstrap/);
  const names = ctx.agentContext.payload.tools.registry.map((tool) => tool.name);
  assert.equal(names.includes("request_task_acceptance"), false);
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
  assert.match(String(messages[0]?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "u11",
    sessionId: "s11",
    dialogProcessId: "dp11",
    ai: {
      content:
        "{\"taskChecklist\":[{\"index\":1,\"task\":\"解析附件\",\"owner\":\"任务负责者1\"},{\"index\":2,\"task\":\"等待子任务结果\",\"owner\":\"任务负责者1\"}]}",
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
  assert.match(String(secondMessages[0]?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    ai: { content: "{\"taskChecklist\":[{\"index\":1,\"task\":\"解析附件\"},{\"index\":2,\"task\":\"执行核心任务\"}]}" },
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
    ai: { content: "{\"taskChecklist\":[{\"index\":1,\"task\":\"执行核心任务\"}]}" },
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

test("harness planning can parse numbered plain-text checklist output", async () => {
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

  assert.equal(agentContext.payload.harness.taskChecklist.length, 3);
  assert.equal(agentContext.payload.harness.taskChecklist[0].task, "解析附件");
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
          taskChecklist: [
            { index: 1, task: "解析附件", owner: "任务负责者1" },
            { index: 2, task: "执行核心任务", owner: "任务负责者1" },
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
});


test("harness review generates review report at final output", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "owner" }],
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u12",
    sessionId: "s12",
    dialogProcessId: "dp12",
    result,
    agentContext,
  });

  assert.match(String(result.output), /Harness-Review/);
  assert.equal(Array.isArray(agentContext.payload.harness.reviewReports), true);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.point, "before_final_output");
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    true,
  );
});


test("harness before_final_output capability runtime runs once", async () => {
  const hookManager = createHookManager();
  let count = 0;
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point, ctx }) => {
          if (point === "before_final_output") {
            count += 1;
            ctx.result.output = `${ctx.result.output}|acceptance-${count}`;
          }
          return { capability: "acceptance", point, status: "active", changed: true };
        },
        review: async ({ point }) => ({ capability: "review", point, status: "active", changed: false }),
      },
    },
  );

  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u13",
    sessionId: "s13",
    dialogProcessId: "dp13",
    result,
    agentContext: { payload: { messages: { system: [], history: [] }, harness: {} } },
  });

  assert.equal(count, 1);
  assert.match(result.output, /\|acceptance-1$/);
  assert.equal((result.output.match(/acceptance-1/g) || []).length, 1);
});

test("harness finalResponseGuard false skips final policy injection but keeps review", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: true, finalResponseGuard: false });

  const result = { output: "done" };
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  await hookManager.emit("before_final_output", {
    userId: "u14",
    sessionId: "s14",
    dialogProcessId: "dp14",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /noobot-harness-final-response/);
  assert.match(String(result.output), /Harness-Review/);
});

test("harness promptPolicy false still traces before_llm_call", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, promptPolicy: false, trace: true });

  await hookManager.emit("before_llm_call", {
    executionScope: "primary",
    userId: "u15",
    sessionId: "s15",
    dialogProcessId: "dp15",
    messages: [{ role: "user", content: "hello" }],
  });

  const eventsFile = path.join(basePath, "runtime", "harness", "runs", "dp15", "events.jsonl");
  assert.equal(await waitForFile(eventsFile), true);
  const events = (await fs.readFile(eventsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.point === "before_llm_call"), true);
});

test("harness review records reports on error and abort hooks", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };

  await hookManager.emit("on_error", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    error: new Error("boom"),
    agentContext,
  });
  await hookManager.emit("on_abort", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    agentContext,
  });

  assert.equal(agentContext.payload.harness.reviewReports.length, 2);
  assert.equal(agentContext.payload.harness.reviewReports[0].status, "error");
  assert.equal(agentContext.payload.harness.reviewReports[1].status, "abort");
  assert.equal(agentContext.payload.harness.logs.review.length, 2);
});

test("harness full engineering capability flow plans, guides, accepts and reviews", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [] },
      harness: {},
    },
  };
  const messages = [{ role: "user", content: "请处理附件并验收" }];

  await hookManager.emit("before_turn", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    agentContext,
  });

  assert.equal(
    agentContext.payload.tools.registry.some((tool) => tool?.name === "request_task_acceptance"),
    true,
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  assert.match(String(messages[0]?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    ai: {
      content:
        '{"taskChecklist":[{"index":1,"task":"解析附件","owner":"owner"},{"index":2,"task":"执行核心任务","owner":"owner"}]}',
    },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);

  for (let i = 0; i < 3; i += 1) {
    await hookManager.emit("after_tool_call", {
      userId: "flow-user",
      sessionId: "flow-session",
      dialogProcessId: "flow-dp",
      toolName: "call_service",
      call: { name: "call_service" },
      success: false,
      agentContext,
    });
  }
  assert.equal(
    agentContext.payload.harness.state.pending.guidance,
    "consecutive_failures",
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  assert.match(String(messages[0]?.content || ""), /harness-guidance/);
  assert.equal(agentContext.payload.harness.state.pending.guidance, null);

  await hookManager.emit("after_tool_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    toolName: "doc_to_data",
    call: { name: "doc_to_data" },
    success: true,
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.signals.parsedAttachment, true);

  const acceptanceTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_task_acceptance",
  );
  const acceptanceResult = await acceptanceTool.func({ mode: "active" });
  assert.equal(acceptanceResult.ok, true);
  assert.equal(agentContext.payload.harness.state.flags.acceptanceRequested, true);

  const result = { output: "任务完成" };
  await hookManager.emit("before_final_output", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Forced-Acceptance/);
  assert.match(String(result.output), /Harness-Review/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.summary.planningCaptured, true);
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    false,
  );
});

test("harness review attachToFinalOutput false keeps report internal", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    { trace: false, promptPolicy: false, review: { attachToFinalOutput: false } },
  );

  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u17",
    sessionId: "s17",
    dialogProcessId: "dp17",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Review/);
  assert.match(String(result.output), /Harness-Forced-Acceptance/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.review.length, 1);
});


test("harness forced acceptance is owned by acceptance and appended once", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { parsedAttachment: false, subtaskStarted: false, subtaskWaited: false, successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u18",
    sessionId: "s18",
    dialogProcessId: "dp18",
    result,
    agentContext,
  });

  assert.equal((String(result.output).match(/Harness-Forced-Acceptance/g) || []).length, 1);
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "forced_acceptance_triggered"), true);
  assert.equal(agentContext.payload.harness.logs.planning.some((log) => log.event === "forced_acceptance_triggered"), false);
});

test("harness acceptance semantic validation uses separate model when enabled", async () => {
  const hookManager = createHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: JSON.stringify({
            status: "pass",
            consistent: true,
            missingItems: [],
            unsupportedClaims: [],
            checklistCoverage: [
              { index: 1, task: "执行核心任务", covered: true, evidence: "final output", risk: "low" },
            ],
            suggestions: [],
          }),
        };
      },
    },
  );

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { parsedAttachment: false, subtaskStarted: false, subtaskWaited: false, successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done: 执行核心任务" };

  await hookManager.emit("before_final_output", {
    userId: "u19",
    sessionId: "s19",
    dialogProcessId: "dp19",
    result,
    agentContext,
  });

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].purpose, "acceptance_semantic_validation");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.match(String(result.output), /"semanticValidation"/);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_completed"), true);
});

test("harness active request_task_acceptance semantic validation receives agent ctx via tool config", async () => {
  const hookManager = createHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return { content: JSON.stringify({ status: "pass", consistent: true, checklistCoverage: [], missingItems: [], unsupportedClaims: [], suggestions: [] }) };
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke({ mode: "active" }, { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } });
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].purpose, "acceptance_semantic_validation");
  assert.equal(result.report.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
});

test("harness acceptance semantic validation failure does not block active acceptance", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async () => {
        throw new Error("semantic model unavailable");
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke(
    { mode: "active" },
    { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } },
  );
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  assert.equal(result.ok, true);
  assert.equal(result.report.semanticValidation, undefined);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_failed"), true);
});

test("harness review reports failed or inconsistent semantic acceptance", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        lastAcceptanceReport: {
          mode: "active",
          summary: { total: 1, completed: 1, inProgress: 0, pending: 0 },
          taskChecklist: [{ index: 1, task: "执行核心任务", status: "completed" }],
          semanticValidation: { status: "fail", consistent: false, missingItems: ["执行核心任务"] },
        },
        state: {
          flags: { planningCaptured: true, acceptanceRequested: true },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", { agentContext, result });

  const report = agentContext.payload.harness.lastReviewReport;
  assert.equal(report.summary.semanticValidationStatus, "fail");
  assert.equal(report.summary.semanticValidationConsistent, false);
  assert.equal(report.summary.issues.includes("acceptance_semantic_validation_failed_or_inconsistent"), true);
  assert.match(String(result.output), /acceptance_semantic_validation_failed_or_inconsistent/);
});
