/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_QUERY_COMMAND,
  EXECUTION_QUERY_CONTRACT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  buildExecutionTree,
  deriveAgentExecutionId,
  isExecutionQueryTargetValid,
  validateExecutionIdentity,
  validateExecutionRecord,
} from "@noobot/session-protocol/execution-lifecycle";
import {
  EXECUTION_ABORT_TYPE,
  createExecutionAbortReason,
  isExecutionAbortError,
  raceExecutionAbort,
  resolveExecutionAbortMessage,
  resolveExecutionAbortReason,
  resolveExecutionAbortType,
  resolveUserStopPayload,
} from "@noobot/session-protocol/execution-abort";

test("agent execution id is derived only from turn scope", () => {
  assert.equal(deriveAgentExecutionId({ turnScopeId: "turn-1" }), "agent:turn-1");
  assert.throws(() => deriveAgentExecutionId({}), { code: "EXECUTION_TURN_SCOPE_REQUIRED" });
  const identity = {
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
  };
  assert.equal(validateExecutionIdentity(identity).valid, true);
});

test("execution identity validation rejects derived-field gaps instead of filling them", () => {
  const errorsOf = (source) => validateExecutionIdentity(source).errors;
  assert.deepEqual(errorsOf({ sessionId: "session-1", turnScopeId: "turn-1" }), [
    "missing_execution_id",
    "invalid_execution_kind",
    "missing_root_execution_id",
  ]);
  assert.deepEqual(
    errorsOf({
      executionId: "agent:other",
      executionKind: "agent",
      rootExecutionId: "agent:other",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    }),
    ["agent_execution_id_not_derived"],
  );
  assert.deepEqual(
    errorsOf({
      executionId: "workflow:turn-1",
      executionKind: "workflow",
      rootExecutionId: "workflow:other",
    }),
    ["root_execution_id_mismatch"],
  );
});

test("execution query contract covers every query command with one response wire event", () => {
  assert.deepEqual(
    Object.keys(EXECUTION_QUERY_CONTRACT).sort(),
    Object.values(EXECUTION_QUERY_COMMAND).sort(),
  );
  assert.deepEqual(
    Object.values(EXECUTION_QUERY_CONTRACT)
      .map((contract) => contract.wireEvent)
      .sort(),
    [
      EXECUTION_CHILDREN_WIRE_EVENT,
      EXECUTION_SNAPSHOT_WIRE_EVENT,
      EXECUTION_TREE_WIRE_EVENT,
    ].sort(),
  );
  assert.equal(Object.isFrozen(EXECUTION_QUERY_CONTRACT), true);
});

test("execution query target validity is derived from the contract", () => {
  const { SNAPSHOT_GET, CHILDREN_GET, TREE_GET } = EXECUTION_QUERY_COMMAND;
  assert.equal(isExecutionQueryTargetValid(SNAPSHOT_GET, { executionId: "e1" }), true);
  assert.equal(isExecutionQueryTargetValid(SNAPSHOT_GET, { rootExecutionId: "r1" }), false);
  assert.equal(isExecutionQueryTargetValid(CHILDREN_GET, {}), false);
  assert.equal(isExecutionQueryTargetValid(TREE_GET, { rootExecutionId: "r1" }), true);
  assert.equal(isExecutionQueryTargetValid(TREE_GET, {}), false);
  assert.equal(isExecutionQueryTargetValid("execution.unknown", { executionId: "e1" }), false);
});

test("execution records require positive integer revision and sequence", () => {
  const root = { executionId: "root", executionKind: "workflow", rootExecutionId: "root" };
  const errorsOf = (source) => validateExecutionRecord(source).errors;
  assert.deepEqual(errorsOf(root), ["invalid_execution_revision", "invalid_execution_sequence"]);
  assert.deepEqual(errorsOf({ ...root, revision: 0, sequence: 0 }), [
    "invalid_execution_revision",
    "invalid_execution_sequence",
  ]);
  assert.deepEqual(errorsOf({ ...root, revision: "1", sequence: 1.5 }), [
    "invalid_execution_revision",
    "invalid_execution_sequence",
  ]);
  assert.throws(() => buildExecutionTree([root]), {
    code: "EXECUTION_RECORD_INVALID",
    executionId: "root",
  });
});

test("execution tree supports arbitrary child agent depth", () => {
  const version = { revision: 1, sequence: 1 };
  const tree = buildExecutionTree([
    { executionId: "root", executionKind: "workflow", rootExecutionId: "root", ...version },
    {
      executionId: "agent:child",
      executionKind: "agent",
      rootExecutionId: "root",
      parentExecutionId: "root",
      sessionId: "s1",
      turnScopeId: "child",
      ...version,
    },
    {
      executionId: "agent:grandchild",
      executionKind: "agent",
      rootExecutionId: "root",
      parentExecutionId: "agent:child",
      sessionId: "s2",
      turnScopeId: "grandchild",
      ...version,
    },
  ]);
  assert.deepEqual(tree.rootExecutionIds, ["root"]);
  assert.deepEqual(tree.executions.root.childExecutionIds, ["agent:child"]);
  assert.deepEqual(tree.executions["agent:child"].childExecutionIds, ["agent:grandchild"]);
});

test("structured signal reason is authoritative over a generic SDK abort error", () => {
  const controller = new AbortController();
  controller.abort(
    createExecutionAbortReason({
      type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT,
      reason: "run timeout after 18000000ms",
      timeoutMs: 18000000,
    }),
  );
  const error = new Error("Request was aborted.");
  error.name = "AbortError";

  assert.deepEqual(resolveExecutionAbortReason({ error, abortSignal: controller.signal }), {
    type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT,
    reason: "run timeout after 18000000ms",
    timeoutMs: 18000000,
  });
  assert.equal(
    resolveExecutionAbortMessage({ error, abortSignal: controller.signal }),
    "run timeout after 18000000ms",
  );
  assert.equal(
    resolveExecutionAbortType({ error, abortSignal: controller.signal }),
    EXECUTION_ABORT_TYPE.RUN_TIMEOUT,
  );
  assert.equal(isExecutionAbortError({ error, abortSignal: controller.signal }), true);
});

test("execution abort reason is an extensible AbortError accepted by fetch", async () => {
  const reason = createExecutionAbortReason({
    type: EXECUTION_ABORT_TYPE.USER_STOP,
    reason: "user stop action",
  });
  assert.ok(reason instanceof Error);
  assert.equal(reason.name, "AbortError");
  assert.equal(reason.code, "ABORT_ERR");
  assert.equal(reason.message, "user stop action");
  assert.equal(Object.isExtensible(reason), true);

  const controller = new AbortController();
  controller.abort(reason);
  assert.throws(
    () => controller.signal.throwIfAborted(),
    (error) => error === reason,
  );
  await assert.rejects(fetch("http://127.0.0.1:9", { signal: controller.signal }), (error) => {
    assert.equal(error, reason);
    return true;
  });
  assert.equal(isExecutionAbortError({ error: reason }), true);
  assert.equal(resolveExecutionAbortType({ error: reason }), EXECUTION_ABORT_TYPE.USER_STOP);
});

test("structured abort type remains authoritative when reason text is absent", () => {
  const controller = new AbortController();
  controller.abort({ type: EXECUTION_ABORT_TYPE.SYSTEM_ABORT });
  const error = new Error("Request was aborted.");
  error.name = "AbortError";

  assert.equal(
    resolveExecutionAbortMessage({ error, abortSignal: controller.signal }),
    "system_abort",
  );
});

test("provider error types cannot enter the execution abort protocol", () => {
  const error = Object.assign(new Error("invalid request"), {
    type: "invalid_request_error",
  });

  assert.equal(resolveExecutionAbortReason({ error }), null);
  assert.equal(isExecutionAbortError({ error }), false);
  assert.throws(
    () => createExecutionAbortReason({ type: "invalid_request_error" }),
    /supported type/,
  );
});

test("user stop payload is read only from a user_stop abort reason with a stop commandId", () => {
  const stopPayload = { commandId: "stop:turn-1", turnScopeId: "turn-1" };
  const stopped = new AbortController();
  stopped.abort(createExecutionAbortReason({ type: EXECUTION_ABORT_TYPE.USER_STOP, stopPayload }));
  assert.deepEqual(resolveUserStopPayload({ abortSignal: stopped.signal }), stopPayload);

  const timedOut = new AbortController();
  timedOut.abort(createExecutionAbortReason({ type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT }));
  assert.throws(() => resolveUserStopPayload({ abortSignal: timedOut.signal }), /user_stop/);
  assert.throws(() => resolveUserStopPayload({ abortSignal: null }), /user_stop/);

  const missing = new AbortController();
  missing.abort(
    createExecutionAbortReason({ type: EXECUTION_ABORT_TYPE.USER_STOP, stopPayload: {} }),
  );
  assert.throws(() => resolveUserStopPayload({ abortSignal: missing.signal }), /commandId/);
});

async function assertAbortRaceSettlesLateRejection(abortBeforeRace) {
  const controller = new AbortController();
  if (abortBeforeRace) controller.abort();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let rejectLate;
    const inner = new Promise((_, reject) => {
      rejectLate = reject;
    });
    const raced = raceExecutionAbort(inner, { abortSignal: controller.signal });
    if (!abortBeforeRace) controller.abort();
    await assert.rejects(raced, (error) =>
      isExecutionAbortError({ error, abortSignal: controller.signal }),
    );
    rejectLate(new Error("late inner failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

test("raceExecutionAbort rejects a pre-aborted race and still observes the inner promise", async () => {
  await assertAbortRaceSettlesLateRejection(true);
});

test("raceExecutionAbort observes the inner promise after an in-flight abort", async () => {
  await assertAbortRaceSettlesLateRejection(false);
});
