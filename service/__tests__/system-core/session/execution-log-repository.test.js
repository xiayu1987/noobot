import test from "node:test";
import assert from "node:assert/strict";

import { ExecutionLogRepository } from "../../../system-core/tracking/execution-log/execution-log-repository.js";

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

test("appendLog keeps only latest dialogProcessId logs", async () => {
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
  assert.equal(bundle.logs.length, 1);
  assert.equal(bundle.logs[0].dialogProcessId, "d2");
  assert.equal(bundle.logs[0].event, "start");
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
  assert.equal(bundle.logs[0].dialogProcessId, "d1");
  assert.equal(bundle.logs[1].dialogProcessId, "d1");
});
