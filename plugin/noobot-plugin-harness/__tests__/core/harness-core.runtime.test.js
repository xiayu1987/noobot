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
import { normalizeHookContextProtocol } from "../src/core/context.js";
import { injectPrompt, resolvePolicyPromptSelection } from "../src/tracing/buffer-manager.js";
import { buildDefaultPolicyPrompt } from "../src/tracing/policy-prompt-matrix.js";
import {
  applyDynamicPolicyPromptFromText,
  buildDynamicPolicyPromptProtocolInstruction,
} from "../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../src/capabilities/handlers/shared/constants.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

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

test("harness plugin emits hook summary via client emitter by default", async () => {
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

  assert.equal(channelEvents.some((item) => item.event === "harness.hook_start"), false);
  assert.equal(channelEvents.some((item) => item.event === "harness.capability_runtime_done"), true);
  assert.equal(channelEvents.some((item) => item.event === "harness.hook_end"), false);
  const summary = channelEvents.find((item) => item.event === "harness.hook_summary");
  assert.ok(summary);
  assert.equal(summary.data?.point, "before_turn");
  assert.equal(summary.data?.status, "ok");
  assert.equal(typeof summary.data?.durationMs, "number");
  assert.equal(summary.data?.fsmRejected, false);
});

test("harness plugin keeps hook start/end via client emitter in verbose mode", async () => {
  const hookManager = createAgentHookManager();
  const channelEvents = [];
  registerNoobotPlugin(
    { hookManager },
    { trace: false, promptPolicy: false, hookRuntimeEventsMode: "verbose" },
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
  const end = channelEvents.find((item) => item.event === "harness.hook_end");
  assert.ok(end);
  assert.equal(end.data?.point, "before_turn");
  assert.equal(end.data?.status, "ok");
  assert.equal(typeof end.data?.durationMs, "number");
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

