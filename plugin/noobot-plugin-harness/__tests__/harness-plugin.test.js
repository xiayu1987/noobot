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
