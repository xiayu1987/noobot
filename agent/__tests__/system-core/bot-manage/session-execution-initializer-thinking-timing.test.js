import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionInitializer } from "../../../src/system-core/bot-manage/execution/initializer.js";

test("initializeRunSessionRuntime persists thinking start before execution begins", async () => {
  const calls = [];
  const initializer = new SessionExecutionInitializer({
    session: {
      upsertSessionTree: async () => {},
      getSessionBundle: async () => ({ exists: true, session: {} }),
      createSession: async () => {},
      upsertTurnTiming: async (payload) => calls.push(payload),
      getExecutionBundle: async () => ({ logs: [] }),
      appendExecutionLog: async () => {},
    },
    configService: { loadUserConfig: async () => ({}) },
    workspaceService: { ensureUserWorkspace: async () => "/workspace/u1" },
  });

  await initializer.initializeRunSessionRuntime({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "turn-1",
    thinkingStartedAt: "2026-07-15T14:00:00.000Z",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "u1");
  assert.equal(calls[0].sessionId, "s1");
  assert.equal(calls[0].turnScopeId, "turn-1");
  assert.equal(calls[0].thinkingStartedAt, "2026-07-15T14:00:00.000Z");
  assert.ok(calls[0].dialogProcessId);
});
