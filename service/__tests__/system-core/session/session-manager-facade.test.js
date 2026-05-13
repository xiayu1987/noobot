import test from "node:test";
import assert from "node:assert/strict";

import { SessionManager } from "../../../system-core/session/index.js";

function createManagerWithMocks(mocks = {}) {
  const manager = Object.create(SessionManager.prototype);
  Object.assign(manager, mocks);
  return manager;
}

test("SessionManager facade should delegate getContextRecords to sessionContextService", async () => {
  let captured = null;
  const manager = createManagerWithMocks({
    sessionContextService: {
      async getContextRecords(payload = {}) {
        captured = payload;
        return [{ role: "user", content: "hi" }];
      },
    },
  });

  const result = await manager.getContextRecords({
    userId: "u1",
    sessionId: "s1",
    userConfig: { x: 1 },
  });

  assert.deepEqual(captured, {
    userId: "u1",
    sessionId: "s1",
    userConfig: { x: 1 },
  });
  assert.deepEqual(result, [{ role: "user", content: "hi" }]);
});

test("SessionManager facade should delegate appendExecutionLog to executionService", async () => {
  let captured = null;
  const manager = createManagerWithMocks({
    executionService: {
      async appendExecutionLog(payload = {}) {
        captured = payload;
        return { ok: true };
      },
    },
  });

  const result = await manager.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "thinking",
    category: "system",
    type: "trace",
    data: { text: "hello" },
    parentSessionId: "p1",
  });

  assert.equal(captured.userId, "u1");
  assert.equal(captured.sessionId, "s1");
  assert.equal(captured.event, "thinking");
  assert.equal(captured.parentSessionId, "p1");
  assert.deepEqual(result, { ok: true });
});
