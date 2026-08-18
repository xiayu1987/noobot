/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSessionDeletionHookResult,
  createSessionDeletionHookResult,
  createHookManager,
  mergeSessionDeletionIds,
  HookExecutionError,
  HOOK_OUTCOME_STATUS,
  HOOK_CANCELLATION_MODE,
  HOOK_POINT,
  requireHookPointDescriptor,
} from "../src/index.js";

test("session deletion hook results expose explicit related session identities", () => {
  const result = createSessionDeletionHookResult({
    deletedRelatedSessionIds: ["node-1", "node-1", " node-2 ", ""],
    retainedRelatedSessionIds: ["node-3"],
  });
  assert.deepEqual(result.deletedRelatedSessionIds, ["node-1", "node-2"]);
  assert.deepEqual(result.retainedRelatedSessionIds, ["node-3"]);
  assert.deepEqual(
    collectSessionDeletionHookResult({
      outcomes: [
        { status: "ok", value: result },
        {
          status: "failed",
          value: {
            deletedRelatedSessionIds: ["ignored"],
            retainedRelatedSessionIds: ["ignored"],
          },
        },
      ],
    }),
    {
      deletedRelatedSessionIds: ["node-1", "node-2"],
      retainedRelatedSessionIds: ["node-3"],
    },
  );
  assert.deepEqual(mergeSessionDeletionIds(["root", "node-1"], ["node-1", "node-2"]), [
    "root",
    "node-1",
    "node-2",
  ]);
});

test("hook point descriptors own cancellation policy", () => {
  assert.equal(
    requireHookPointDescriptor(HOOK_POINT.AGENT.BEFORE_LLM_CALL).cancellationMode,
    HOOK_CANCELLATION_MODE.PROPAGATE,
  );
  assert.equal(
    requireHookPointDescriptor(HOOK_POINT.AGENT.ON_ABORT).cancellationMode,
    HOOK_CANCELLATION_MODE.DETACHED,
  );
  assert.equal(
    requireHookPointDescriptor(HOOK_POINT.BOT.SESSION_RUN_ERROR).cancellationMode,
    HOOK_CANCELLATION_MODE.DETACHED,
  );
  assert.equal(
    requireHookPointDescriptor(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT).cancellationMode,
    HOOK_CANCELLATION_MODE.DETACHED,
  );
  assert.equal(
    requireHookPointDescriptor(HOOK_POINT.AGENT.AFTER_STATE_COMMIT).cancellationMode,
    HOOK_CANCELLATION_MODE.DETACHED,
  );
});

test("protocol rejects unknown hook points and anonymous handlers", () => {
  const manager = createHookManager();
  assert.throws(() => manager.on("before_turn", () => {}, { id: "legacy" }), /unknown hook point/);
  assert.throws(() => manager.on(HOOK_POINT.AGENT.BEFORE_TURN, () => {}), /handler id is required/);
});

test("once registration is consumed atomically before concurrent invocations", async () => {
  const manager = createHookManager();
  let invocationCount = 0;
  manager.once(
    HOOK_POINT.AGENT.AFTER_TURN,
    async () => {
      invocationCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    { id: "test.once" },
  );
  await Promise.all([
    manager.emit(HOOK_POINT.AGENT.AFTER_TURN),
    manager.emit(HOOK_POINT.AGENT.AFTER_TURN),
  ]);
  assert.equal(invocationCount, 1);
});

test("duplicate handler ids are rejected", () => {
  const manager = createHookManager();
  manager.on(HOOK_POINT.AGENT.AFTER_TURN, () => {}, { id: "test.duplicate" });
  assert.throws(
    () => manager.on(HOOK_POINT.AGENT.AFTER_TURN, () => {}, { id: "test.duplicate" }),
    /duplicate hook handler id/,
  );
});

test("timeout aborts the handler signal and fail-flow points throw", async () => {
  const manager = createHookManager();
  let observedAbort = false;
  manager.on(
    HOOK_POINT.AGENT.BEFORE_TURN,
    async (_context, invocation) => {
      await new Promise((resolve) => {
        invocation.signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
    },
    { id: "test.timeout", timeoutMs: 10 },
  );
  await assert.rejects(
    manager.emit(HOOK_POINT.AGENT.BEFORE_TURN),
    (error) => error instanceof HookExecutionError && error.cause?.code === "HOOK_TIMEOUT",
  );
  assert.equal(observedAbort, true);
});

test("parent cancellation propagates the single abort fact without hook failure reporting", async () => {
  const reportedErrors = [];
  const manager = createHookManager({
    onError: (event) => reportedErrors.push(event),
  });
  const controller = new AbortController();
  const abortReason = Object.assign(new Error("stopped by user"), {
    name: "AbortError",
    code: "USER_STOP",
    type: "user_stop",
  });
  let secondHandlerCalls = 0;
  manager.on(
    HOOK_POINT.AGENT.BEFORE_TURN,
    async (_context, invocation) => {
      await new Promise((resolve) => {
        invocation.signal.addEventListener("abort", resolve, { once: true });
      });
    },
    { id: "test.parent-abort.first" },
  );
  manager.on(
    HOOK_POINT.AGENT.BEFORE_TURN,
    () => {
      secondHandlerCalls += 1;
    },
    { id: "test.parent-abort.second" },
  );

  const emitted = manager.emit(HOOK_POINT.AGENT.BEFORE_TURN, {}, { signal: controller.signal });
  controller.abort(abortReason);

  await assert.rejects(emitted, (error) => error === abortReason);
  assert.equal(secondHandlerCalls, 0);
  assert.deepEqual(reportedErrors, []);
});

test("observer point returns a canonical failure outcome without failing the flow", async () => {
  const manager = createHookManager();
  manager.on(
    HOOK_POINT.AGENT.AFTER_TURN,
    () => {
      throw new Error("observer failure");
    },
    { id: "test.observer" },
  );
  const result = await manager.emit(HOOK_POINT.AGENT.AFTER_TURN);
  assert.equal(result.failures.length, 1);
  assert.equal(result.outcomes[0].status, HOOK_OUTCOME_STATUS.FAILED);
  assert.equal(result.outcomes[0].error.message, "observer failure");
});
