/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionInitializer } from "../../src/bot/execution/initializer.js";
import { turnRecord } from "../helpers/turn-record.js";

const TEST_NOW = () => "2026-01-01T00:00:00.000Z";

const AUTHORITY_STARTED_AT = "2026-07-30T00:00:00.000Z";

function createInitializer(bundle, calls = []) {
  return new SessionExecutionInitializer({
    now: TEST_NOW,
    session: {
      getSessionBundle: async () => bundle,
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
}

const runIdentity = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  persistenceScope: null,
  turnScopeId: "turn-1",
  dialogProcessId: "dp-1",
};

test("initializeRunSessionRuntime reads startedAt from the accepted Authority Turn", async () => {
  const calls = [];
  const turn = turnRecord({ turnScopeId: "turn-1", dialogProcessId: "dp-1" });
  const initializer = createInitializer(
    { exists: true, session: { turnLifecycle: { turns: { "turn-1": turn } } } },
    calls,
  );

  const initialized = await initializer.initializeRunSessionRuntime(runIdentity);

  assert.equal(calls.length, 0);
  assert.equal(initialized.startedAt, AUTHORITY_STARTED_AT);
  assert.equal(initialized.sessionDir, "/workspace/u1/runtime/session/s1");
});

test("initializeRunSessionRuntime rejects a run without its accepted Turn", async () => {
  await assert.rejects(
    createInitializer({ exists: false, session: null }).initializeRunSessionRuntime(runIdentity),
    /accepted Turn session is required/,
  );
  await assert.rejects(
    createInitializer({
      exists: true,
      session: { turnLifecycle: { turns: {} } },
    }).initializeRunSessionRuntime(runIdentity),
    { code: "TURN_LIFECYCLE_TURN_NOT_FOUND" },
  );
});
