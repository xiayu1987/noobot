import test from "node:test";
import assert from "node:assert/strict";

import { AsyncJobManager } from "../../../src/system-core/bot-manage/async-job-manager.js";

function createTestManager(overrides = {}) {
  const manager = Object.create(AsyncJobManager.prototype);
  Object.assign(manager, overrides);
  return manager;
}

test("_normalizeWaitAsyncTimeout enforces minimum and default", () => {
  const manager = createTestManager();

  assert.equal(manager._normalizeWaitAsyncTimeout(0), 120000);
  assert.equal(manager._normalizeWaitAsyncTimeout(1), 1000);
  assert.equal(manager._normalizeWaitAsyncTimeout(-10), 1000);
  assert.equal(manager._normalizeWaitAsyncTimeout(undefined), 120000);
  assert.equal(manager._normalizeWaitAsyncTimeout(5000), 5000);
});

test("_buildAsyncDonePayload normalizes fields", () => {
  const manager = createTestManager();

  const payload = manager._buildAsyncDonePayload({
    ok: 0,
    status: "failed",
    sessionId: "s1",
    parentSessionId: "p1",
    startedAt: "t1",
    endedAt: "t2",
    result: null,
    error: new Error("boom"),
  });

  assert.deepEqual(payload, {
    ok: false,
    status: "failed",
    sessionId: "s1",
    parentSessionId: "p1",
    startedAt: "t1",
    endedAt: "t2",
    result: null,
    error: "Error: boom",
  });
});

test("_buildWaitAsyncFallbackResult returns not_found when session does not exist", async () => {
  const manager = createTestManager({
    session: {
      async getSessionBundle() {
        return { exists: false };
      },
      async getExecutionBundle() {
        throw new Error("should not be called when bundle does not exist");
      },
    },
  });

  const result = await manager._buildWaitAsyncFallbackResult({
    userId: "u1",
    parentSessionId: "p1",
    sessionId: "s1",
  });

  assert.deepEqual(result, {
    ok: false,
    status: "not_found",
    sessionId: "s1",
    parentSessionId: "p1",
  });
});

test("_buildWaitAsyncFallbackResult returns completed payload with assistant answer", async () => {
  const manager = createTestManager({
    session: {
      async getSessionBundle() {
        return {
          exists: true,
          sessions: [
            {
              sessionId: "s1",
              messages: [
                { role: "user", type: "message", content: "hi" },
                { role: "assistant", type: "tool_call", content: "tool..." },
                {
                  role: "assistant",
                  type: "message",
                  content: "final answer",
                  dialogProcessId: "dp-123",
                },
              ],
            },
          ],
        };
      },
      async getExecutionBundle() {
        return { logs: [{ event: "done" }] };
      },
    },
  });

  const result = await manager._buildWaitAsyncFallbackResult({
    userId: "u1",
    parentSessionId: "p1",
    sessionId: "s1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.sessionId, "s1");
  assert.equal(result.parentSessionId, "p1");
  assert.equal(result.result.answer, "final answer");
  assert.equal(result.result.dialogProcessId, "dp-123");
  assert.deepEqual(result.result.executionLogs, [{ event: "done" }]);
});
