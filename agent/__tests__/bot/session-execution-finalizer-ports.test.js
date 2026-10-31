/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { createTestSessionFinalizationContext } from "../helpers/session-finalization.js";

test("missing finalization capabilities fail before any persistence or memory effects", async () => {
  const effects = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      upsertTurnTiming: async () => effects.push("timing"),
      saveExecutionReport: async () => effects.push("report"),
      getExecutionTurnLogs: async () => effects.push("logs"),
    },
    turnPersister: { appendAgentMessages: async () => effects.push("messages") },
    memoryPostProcessService: {
      resolveMemoryPostProcessAsyncEnabled: () => effects.push("memory"),
    },
    now: () => effects.push("clock"),
  });
  for (const [port, method] of [
    ["lifecycle", "enterPersisting"],
    ["lifecycle", "enterMemory"],
    ["runtimeEventListener", "onEvent"],
    ["runtimeEventListener", "flush"],
  ]) {
    const payload = createTestSessionFinalizationContext();
    delete payload[port][method];
    await assert.rejects(finalizer.finalizeRunSession(payload), {
      code: "SESSION_FINALIZATION_PORT_INVALID",
      message: `session finalization requires ${port}.${method}`,
    });
  }
  assert.deepEqual(effects, []);
});
