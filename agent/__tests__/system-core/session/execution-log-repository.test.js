import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionLogRepository } from "../../../src/system-core/tracking/execution-log/execution-log-repository.js";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-execution-log-repository-"));
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function createInMemorySessionRepository() {
  const store = new Map();
  const keyOf = (userId = "", sessionId = "", parentSessionId = "") =>
    `${userId}::${parentSessionId}::${sessionId}`;
  return {
    async getExecutionBundle(userId, sessionId, parentSessionId = "") {
      const key = keyOf(userId, sessionId, parentSessionId);
      if (!store.has(key)) {
        store.set(key, { logs: [], updatedAt: "" });
      }
      return store.get(key);
    },
    async saveExecutionBundle(userId, sessionId, bundle, parentSessionId = "") {
      const key = keyOf(userId, sessionId, parentSessionId);
      store.set(key, bundle);
    },
  };
}

test("appendLog preserves logs and dialogProcessId for each dialog", async () => {
  const sessionRepository = createInMemorySessionRepository();
  const repo = new ExecutionLogRepository({
    sessionRepository,
    now: () => "2026-05-13T00:00:00.000Z",
  });

  await repo.appendLog("u1", "s1", {
    dialogProcessId: "d1",
    event: "start",
  });
  await repo.appendLog("u1", "s1", {
    dialogProcessId: "d1",
    event: "tool_called",
  });
  await repo.appendLog("u1", "s1", {
    dialogProcessId: "d2",
    event: "start",
  });

  const bundle = await repo.getBundle("u1", "s1");
  assert.equal(bundle.logs.length, 3);
  assert.equal(bundle.dialogProcessId, "d2");
  assert.equal(bundle.logs[0].event, "start");
  assert.equal(bundle.logs[0].dialogProcessId, "d1");
  assert.equal(bundle.logs[1].dialogProcessId, "d1");
  assert.equal(bundle.logs[2].event, "start");
  assert.equal(bundle.logs[2].dialogProcessId, "d2");
});

test("appendLog without dialogProcessId stays in current latest dialog", async () => {
  const sessionRepository = createInMemorySessionRepository();
  const repo = new ExecutionLogRepository({
    sessionRepository,
    now: () => "2026-05-13T00:00:00.000Z",
  });

  await repo.appendLog("u1", "s1", {
    dialogProcessId: "d1",
    event: "start",
  });
  await repo.appendLog("u1", "s1", {
    event: "heartbeat",
  });

  const bundle = await repo.getBundle("u1", "s1");
  assert.equal(bundle.logs.length, 2);
  assert.equal(bundle.dialogProcessId, "d1");
  assert.equal(bundle.logs[0].dialogProcessId, "d1");
  assert.equal(bundle.logs[1].dialogProcessId, "d1");
});

test("appendLog mirrors session execution logs to runtime-events session events", async () => {
  const workspaceRoot = await makeTempDir();
  const sessionRepository = createInMemorySessionRepository();
  const repo = new ExecutionLogRepository({
    sessionRepository,
    now: () => "2026-05-13T00:00:00.000Z",
    workspaceRoot,
  });

  await repo.appendLog("u1", "s1", {
    dialogProcessId: "d1",
    event: "tool_call_start",
    category: "tool",
    type: "tool_call",
    data: { tool: "read_file" },
    ts: "2026-05-13T00:00:01.000Z",
  }, "p1");

  const runtimeEventFile = path.join(workspaceRoot, "u1", "runtime", "session", "s1", "events", "interaction.jsonl");
  const records = await readJsonLines(runtimeEventFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "agent");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "interaction");
  assert.equal(records[0].event, "tool_call_start");
  assert.equal(records[0].sessionId, "s1");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].dialogProcessId, "d1");
  assert.equal(records[0].data.executionCategory, "tool");
  assert.equal(records[0].data.type, "tool_call");
  assert.equal(records[0].data.tool, "read_file");
});
