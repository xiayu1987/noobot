/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionLogService } from "../../src/observability/execution-log/execution-log-service.js";

function createService(runtimeEventsConfig = { env: {} }) {
  const appendedLogs = [];
  let resolvedScopeCount = 0;
  const service = new ExecutionLogService({
    executionRepo: {
      async appendLog(...args) {
        appendedLogs.push(args);
      },
    },
    sessionRepo: {
      async resolveSessionScope() {
        resolvedScopeCount += 1;
        return { resolvedParentSessionId: "parent-1" };
      },
    },
    runtimeEventsConfig,
  });
  return {
    service,
    appendedLogs,
    get resolvedScopeCount() {
      return resolvedScopeCount;
    },
  };
}

test("ExecutionLogService skips session_turn_full before resolving storage scope", async () => {
  const harness = createService();
  const result = await harness.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "session_turn_full",
    data: { role: "assistant" },
  });

  assert.deepEqual(result, {
    appended: false,
    skipped: true,
    reason: "runtime_event_policy",
  });
  assert.equal(harness.resolvedScopeCount, 0);
  assert.equal(harness.appendedLogs.length, 0);
});

test("ExecutionLogService skips duplicate successful message persistence logs", async () => {
  for (const event of ["assistant_message_saved", "tool_message_saved"]) {
    const harness = createService();
    const result = await harness.service.appendExecutionLog({
      userId: "u1",
      sessionId: "s1",
      event,
      data: { sessionId: "s1" },
    });
    assert.deepEqual(result, {
      appended: false,
      skipped: true,
      reason: "runtime_event_policy",
    });
    assert.equal(harness.resolvedScopeCount, 0);
    assert.equal(harness.appendedLogs.length, 0);
  }
});

test("ExecutionLogService preserves ordinary and failure execution logs", async () => {
  const harness = createService();
  const result = await harness.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "message_persistence_failed",
    category: "error",
    data: { message: "save failed" },
  });

  assert.deepEqual(result, { appended: true, skipped: false });
  assert.equal(harness.resolvedScopeCount, 1);
  assert.equal(harness.appendedLogs.length, 1);
  assert.equal(harness.appendedLogs[0][2].event, "message_persistence_failed");
});

test("ExecutionLogService can enable full turn diagnostics through centralized config", async () => {
  const harness = createService({ executionLogControls: { sessionTurnFullDebug: true }, env: {} });
  const result = await harness.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "session_turn_full",
  });

  assert.deepEqual(result, { appended: true, skipped: false });
  assert.equal(harness.resolvedScopeCount, 1);
  assert.equal(harness.appendedLogs.length, 1);
});

test("ExecutionLogService applies the context identity debug switch without a flat fallback", async () => {
  const disabled = createService({
    env: {},
    sessionLogControls: { debug: { contextIdentity: false } },
  });
  const skipped = await disabled.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.contextIdentity.contextBuildInput",
    category: "context_identity",
    data: { debugType: "context-identity" },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(disabled.resolvedScopeCount, 0);

  const flatOverride = createService({ env: {}, contextIdentityDebug: false });
  const appended = await flatOverride.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.contextIdentity.contextBuildInput",
    category: "context_identity",
    data: { debugType: "context-identity" },
  });
  assert.equal(appended.appended, true);
});
