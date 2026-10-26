/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionInitializer } from "../../src/bot/execution/initializer.js";

test("initializeRunSessionRuntime leaves turn start to the lifecycle fact", async () => {
  const calls = [];
  const initializer = new SessionExecutionInitializer({
    session: {
      getSessionBundle: async () => ({ exists: true, session: {} }),
      createSession: async () => {},
      upsertTurnTiming: async (payload) => calls.push(payload),
      locateSessionScope: async () => ({
        sessionDir: "/workspace/u1/runtime/session/s1",
        resolvedParentSessionId: "",
      }),
      appendExecutionLog: async () => {},
    },
    configService: { loadUserConfig: async () => ({}) },
    workspaceService: { ensureUserWorkspace: async () => "/workspace/u1" },
  });

  const initialized = await initializer.initializeRunSessionRuntime({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    persistenceScope: null,
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
  });

  assert.equal(calls.length, 0);
  assert.equal(initialized.sessionDir, "/workspace/u1/runtime/session/s1");
});
