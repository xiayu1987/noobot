/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutionReport,
  EXECUTION_REPORT_STATUS,
} from "../../src/observability/execution-log/execution-report.js";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { handleSessionRunFailure } from "../../src/bot/execution/runner/run-failure.js";

test("buildExecutionReport keeps aggregate metrics, duration and error only", () => {
  const report = buildExecutionReport({
    status: EXECUTION_REPORT_STATUS.FAILED,
    sessionId: "s1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.500Z",
    executionSummary: { visibleTotal: 3, toolCallCount: 2, errorCount: 1, steps: [{ x: 1 }] },
    error: Object.assign(new Error("boom"), { code: "E1" }),
  });
  assert.equal(report.protocol, "noobot.execution-report");
  assert.equal(report.version, 2);
  assert.equal(report.durationMs, 1500);
  assert.deepEqual(report.summary, {
    visibleTotal: 3,
    toolCallCount: 2,
    toolResultCount: 0,
    errorCount: 1,
    toolStats: {},
    metrics: null,
  });
  assert.equal("steps" in report.summary, false);
  assert.deepEqual(report.error, { name: "Error", code: "E1", message: "boom" });
});

test("buildExecutionReport tolerates missing timestamps and summary", () => {
  const report = buildExecutionReport({ status: EXECUTION_REPORT_STATUS.COMPLETED });
  assert.equal(report.durationMs, null);
  assert.equal(report.summary, null);
  assert.equal(report.error, null);
});

function createFinalizer(session) {
  return new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
      ...session,
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({ role: "assistant", type: "message", content: "done" }),
      async appendAgentMessages() {},
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    now: () => "2026-01-01T00:00:02.000Z",
  });
}

const finalizePayload = {
  userId: "u1",
  sessionId: "s1",
  dialogProcessId: "dp1",
  turnScopeId: "turn-1",
  thinkingStartedAt: "2026-01-01T00:00:00.000Z",
  agentResult: { output: "done", turnTasks: [] },
};

test("SessionExecutionFinalizer writes a completed execution report", async () => {
  const saved = [];
  const finalizer = createFinalizer({
    async saveExecutionReport(payload) {
      saved.push(payload);
      return { saved: true };
    },
  });
  const result = await finalizer.finalizeRunSession(finalizePayload);
  assert.equal(result.answer, "done");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sessionId, "s1");
  assert.equal(saved[0].report.status, EXECUTION_REPORT_STATUS.COMPLETED);
  assert.equal(saved[0].report.turnScopeId, "turn-1");
  assert.equal(saved[0].report.durationMs, 2000);
  assert.equal(saved[0].report.summary.toolCallCount, 0);
});

test("SessionExecutionFinalizer completes even when the report write fails", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const finalizer = createFinalizer({
      async saveExecutionReport() {
        throw new Error("disk full");
      },
    });
    const result = await finalizer.finalizeRunSession(finalizePayload);
    assert.equal(result.answer, "done");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

function failureContext(overrides = {}) {
  const saved = [];
  return {
    saved,
    context: {
      error: new Error("boom"),
      abortSignal: null,
      lifecycle: { fail() {}, userStop: async () => {}, interrupt() {} },
      lifecycleRuntime: null,
      persistStoppedSnapshotFromRuntime: async () => ({ status: "skipped" }),
      resolvedRuntimeEventListener: null,
      resolvedRunConfig: { thinkingStartedAt: "2026-01-01T00:00:00.000Z" },
      resolvedUsedSessionId: "s1",
      resolvedDialogProcessId: "dp1",
      resolvedParentAsyncResultContainer: null,
      upsertParentAsyncTask() {},
      errorLogger: { async log() {} },
      now: () => "2026-01-01T00:00:03.000Z",
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      caller: "user",
      message: "hi",
      turnScopeId: "turn-1",
      saveExecutionReport: async (payload) => saved.push(payload),
      executionEventListener: null,
      ...overrides,
    },
  };
}

for (const [label, overrides, expectedStatus] of [
  ["plain error", {}, EXECUTION_REPORT_STATUS.FAILED],
  [
    "system abort",
    { error: Object.assign(new Error("aborted"), { name: "AbortError" }) },
    EXECUTION_REPORT_STATUS.INTERRUPTED,
  ],
  [
    "user stop",
    {
      error: Object.assign(new Error("stopped"), { name: "AbortError" }),
      abortSignal: { aborted: true, reason: { type: "user_stop", reason: "stop" } },
    },
    EXECUTION_REPORT_STATUS.USER_STOPPED,
  ],
]) {
  test(`handleSessionRunFailure writes a ${expectedStatus} report for ${label} and rethrows`, async () => {
    const { saved, context } = failureContext(overrides);
    await assert.rejects(handleSessionRunFailure(context));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].report.status, expectedStatus);
    assert.equal(saved[0].report.turnScopeId, "turn-1");
    assert.equal(saved[0].report.durationMs, 3000);
    assert.ok(saved[0].report.error.message);
  });
}

test("handleSessionRunFailure skips the report when no writer is injected", async () => {
  const { context } = failureContext({ saveExecutionReport: null });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
});

test("handleSessionRunFailure flushes logs before summarizing the failed turn", async () => {
  const order = [];
  const { saved, context } = failureContext({
    executionEventListener: { flush: async () => order.push("flush") },
    getExecutionBundle: async () => {
      order.push("read");
      return {
        logs: [
          { event: "llm_call_start", dialogProcessId: "dp1", data: { modelLoopRound: 2 } },
          { event: "llm_call_start", dialogProcessId: "other", data: { modelLoopRound: 9 } },
        ],
      };
    },
  });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
  assert.deepEqual(order, ["flush", "read"]);
  assert.equal(saved[0].report.summary.metrics.model.llmCalls, 1);
  assert.equal(saved[0].report.summary.metrics.model.maxLoopRound, 2);
});

test("handleSessionRunFailure still writes the report when log reading fails", async () => {
  const { saved, context } = failureContext({
    getExecutionBundle: async () => {
      throw new Error("disk");
    },
  });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].report.summary, null);
});
