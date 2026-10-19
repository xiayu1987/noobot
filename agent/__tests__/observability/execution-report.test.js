/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { EXECUTION_REPORT_STATUS } from "@noobot/session-protocol/execution-report";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { handleSessionRunFailure } from "../../src/bot/execution/runner/run-failure.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function createFinalizer(session) {
  return new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async saveCurrentTurnTasks() {},
      async getExecutionTurnLogs() {
        return [];
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

test("SessionExecutionFinalizer propagates execution report write failures", async () => {
  const finalizer = createFinalizer({
    async saveExecutionReport() {
      throw new Error("disk full");
    },
  });
  await assert.rejects(finalizer.finalizeRunSession(finalizePayload), /disk full/);
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
      caller: SESSION_CALLER.USER,
      message: "hi",
      turnScopeId: "turn-1",
      saveExecutionReport: async (payload) => saved.push(payload),
      getExecutionTurnLogs: async () => [],
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

test("handleSessionRunFailure writes no report before the turn identity exists", async () => {
  const { saved, context } = failureContext({ resolvedDialogProcessId: "" });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
  assert.equal(saved.length, 0);
});

test("handleSessionRunFailure flushes logs before summarizing the failed turn", async () => {
  const order = [];
  const { saved, context } = failureContext({
    executionEventListener: { flush: async () => order.push("flush") },
    getExecutionTurnLogs: async () => {
      order.push("read");
      return [{ event: "llm_call_start", dialogProcessId: "dp1", data: { modelLoopRound: 2 } }];
    },
  });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
  assert.deepEqual(order, ["flush", "read"]);
  assert.equal(saved[0].report.summary.metrics.model.llmCalls, 1);
  assert.equal(saved[0].report.summary.metrics.model.maxLoopRound, 2);
});

test("handleSessionRunFailure records summaryError when turn logs cannot be read", async () => {
  const { saved, context } = failureContext({
    getExecutionTurnLogs: async () => {
      throw new Error("disk");
    },
  });
  await assert.rejects(handleSessionRunFailure(context), /boom/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].report.summary, null);
  assert.equal(saved[0].report.summaryError.message, "disk");
  assert.equal(saved[0].report.error.message, "boom");
});

test("handleSessionRunFailure aggregates report write failures with the run failure", async () => {
  const { context } = failureContext({
    saveExecutionReport: async () => {
      throw new Error("report disk");
    },
  });
  await assert.rejects(handleSessionRunFailure(context), (error) => {
    const errors = error.cause?.errors || error.errors || [];
    assert.ok(errors.some((entry) => /report disk/.test(entry?.message)));
    return true;
  });
});
