/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionLogService } from "../../src/observability/execution-log/execution-log-service.js";
import { useRuntimeEventsEnv } from "../helpers/runtime-events-env.js";

function createService() {
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

test("ExecutionLogService can enable full turn diagnostics through the environment", async (t) => {
  useRuntimeEventsEnv(t, { executionLog: { sessionTurnFullDebug: true } });
  const harness = createService();
  const result = await harness.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "session_turn_full",
  });

  assert.deepEqual(result, { appended: true, skipped: false });
  assert.equal(harness.resolvedScopeCount, 1);
  assert.equal(harness.appendedLogs.length, 1);
});

test("ExecutionLogService applies the context identity debug switch from the environment", async (t) => {
  useRuntimeEventsEnv(t, { debug: { contextIdentity: false } });
  const disabled = createService();
  const skipped = await disabled.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.contextIdentity.contextBuildInput",
    category: "context_identity",
    data: {},
  });
  assert.equal(skipped.skipped, true);
  assert.equal(disabled.resolvedScopeCount, 0);

  useRuntimeEventsEnv(t, { debug: { contextIdentity: true } });
  const enabled = createService();
  const appended = await enabled.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.contextIdentity.contextBuildInput",
    category: "context_identity",
    data: {},
  });
  assert.equal(appended.appended, true);
});

test("ExecutionLogService applies the default-off agent context debug switch", async (t) => {
  const defaults = createService();
  const defaultSkipped = await defaults.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.context.executionScopeCreated",
    category: "agent_context",
    data: {},
  });
  assert.equal(defaultSkipped.skipped, true);

  useRuntimeEventsEnv(t, { debug: { agentContext: true } });
  const enabled = createService();
  const appended = await enabled.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.context.executionScopeCreated",
    category: "agent_context",
    data: {},
  });
  assert.equal(appended.appended, true);

  useRuntimeEventsEnv(t, { debug: { agentContext: false } });
  const disabled = createService();
  const skipped = await disabled.service.appendExecutionLog({
    userId: "u1",
    sessionId: "s1",
    event: "agent.context.executionScopeCreated",
    category: "agent_context",
    data: {},
  });
  assert.equal(skipped.skipped, true);
  assert.equal(disabled.resolvedScopeCount, 0);
});
