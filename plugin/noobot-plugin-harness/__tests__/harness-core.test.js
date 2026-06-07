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
import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("ensureHarnessBucket fast-path keeps initialized references stable", async () => {
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: { llmTurns: 9 },
            flags: { planningCaptured: true },
            signals: { successfulToolCount: 3 },
            pending: { guidance: null, summary: false },
          },
          taskChecklist: [{ index: 1, task: "t1" }],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          lastPlanningRawOutput: null,
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
          __harnessBucketVersion: 1,
        },
      },
    },
  };
  ctx.agentContext.payload.harness.state.__harnessBucketVersion = 1;

  const first = ensureHarnessBucket(ctx);
  assert.ok(first);
  const refs = {
    bucket: first.bucket,
    state: first.state,
    counters: first.state.counters,
    flags: first.state.flags,
    signals: first.state.signals,
    pending: first.state.pending,
    logs: first.bucket.logs,
    taskChecklist: first.bucket.taskChecklist,
  };

  const second = ensureHarnessBucket(ctx);
  assert.ok(second);
  assert.equal(second.bucket, refs.bucket);
  assert.equal(second.state, refs.state);
  assert.equal(second.state.counters, refs.counters);
  assert.equal(second.state.flags, refs.flags);
  assert.equal(second.state.signals, refs.signals);
  assert.equal(second.state.pending, refs.pending);
  assert.equal(second.bucket.logs, refs.logs);
  assert.equal(second.bucket.taskChecklist, refs.taskChecklist);
  assert.equal(second.state.counters.llmTurns, 9);
  assert.equal(second.state.flags.planningCaptured, true);
  assert.equal(second.state.signals.successfulToolCount, 3);
});

test("harness plugin writes manifest, events and context snapshot", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
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

test("harness plugin emits hook progress via client channel when available", async () => {
  const hookManager = createAgentHookManager();
  const channelEvents = [];
  registerNoobotPlugin(
    { hookManager },
    { trace: false, promptPolicy: false },
  );

  await hookManager.emit("before_turn", {
    userId: "u-channel",
    sessionId: "s-channel",
    dialogProcessId: "dp-channel",
    emitHookClientEvent: (event = "", data = {}) => {
      channelEvents.push({ event, data });
    },
  });

  assert.equal(channelEvents.some((item) => item.event === "harness.hook_start"), true);
  assert.equal(channelEvents.some((item) => item.event === "harness.capability_runtime_done"), true);
  assert.equal(channelEvents.some((item) => item.event === "harness.hook_end"), true);
});

test("harness plugin deletes related run records on after_session_delete", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-cleanup-"));
  const runsDir = path.join(basePath, "runtime", "harness", "runs");
  const runA = path.join(runsDir, "run-a");
  const runB = path.join(runsDir, "run-b");
  await fs.mkdir(runA, { recursive: true });
  await fs.mkdir(runB, { recursive: true });
  await fs.writeFile(
    path.join(runA, "harness-run.json"),
    JSON.stringify({ sessionId: "s-delete", dialogProcessId: "run-a" }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(runB, "harness-run.json"),
    JSON.stringify({ sessionId: "s-keep", dialogProcessId: "run-b" }, null, 2),
    "utf8",
  );

  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, trace: false, promptPolicy: false });
  await hookManager.emit("after_session_delete", {
    userId: "u-cleanup",
    sessionId: "s-delete",
    deletedSessionIds: ["s-delete"],
    basePath,
  });

  assert.equal(await exists(runA), false);
  assert.equal(await exists(runB), true);
});

test("harness plugin deletes workflow child run records by manifest.parentSessionId on after_session_delete", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-cleanup-parent-"));
  const runsDir = path.join(basePath, "runtime", "harness", "runs");
  const runChild = path.join(runsDir, "wf_node_demo_1");
  const runKeep = path.join(runsDir, "wf_node_demo_2");
  await fs.mkdir(runChild, { recursive: true });
  await fs.mkdir(runKeep, { recursive: true });
  await fs.writeFile(
    path.join(runChild, "harness-run.json"),
    JSON.stringify(
      {
        sessionId: "child-session-1",
        parentSessionId: "root-session-delete",
        dialogProcessId: "wf_node_demo_1",
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(runKeep, "harness-run.json"),
    JSON.stringify(
      {
        sessionId: "child-session-2",
        parentSessionId: "root-session-keep",
        dialogProcessId: "wf_node_demo_2",
      },
      null,
      2,
    ),
    "utf8",
  );

  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, trace: false, promptPolicy: false });
  await hookManager.emit("after_session_delete", {
    userId: "u-cleanup-parent",
    sessionId: "root-session-delete",
    deletedSessionIds: ["root-session-delete"],
    basePath,
  });

  assert.equal(await exists(runChild), false);
  assert.equal(await exists(runKeep), true);
});

test("harness plugin rejects illegal FSM transitions and audits state commits", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
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
    const hookManager = createAgentHookManager();
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
  const hookManager = createAgentHookManager();
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
  const hookManager = createAgentHookManager();
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
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, trace: false });
  const messages = [{ role: "user", content: "hello" }];

  await hookManager.emit("before_llm_call", {
    userId: "u2",
    sessionId: "s2",
    dialogProcessId: "dp2",
    messages,
  });

  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /noobot-harness-policy/);
  assert.match(messages[0].content, /用户隔离/);
});

test("harness plugin exposes capability handler skeleton and hook mapping in manifest", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
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
  assert.equal(
    manifest?.capabilities?.hookMap?.acceptance?.includes("before_llm_call"),
    true,
  );
  assert.equal(
    manifest?.capabilities?.hookMap?.acceptance?.includes("after_llm_call"),
    true,
  );
});
