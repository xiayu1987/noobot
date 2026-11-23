/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { turnRecord } from "../helpers/turn-record.js";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionReadService } from "../../src/session/services/execution-read-service.js";

const now = () => "2026-07-20T00:00:00.000Z";

function turn(overrides = {}) {
  return turnRecord({
    turnScopeId: "root",
    executionId: "agent:root",
    executionKind: "agent",
    rootExecutionId: `agent:${overrides.turnScopeId ?? "root"}`,
    state: "processing",
    phase: "processing",
    executionState: "sending",
    revision: 2,
    sequence: 2,
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  });
}

function service(sessions) {
  return createReader(() => sessions);
}

function createReader(selectSessions) {
  let active = 0;
  return new ExecutionReadService({
    sessionRepo: {
      async listExecutionSessionScopes(userId) {
        return selectSessions(userId).map(({ sessionId }) => ({
          sessionId,
          persistenceContext: { userId, sessionId },
        }));
      },
      async requireSessionReader(userId, sessionId, { persistenceContext }) {
        assert.deepEqual(persistenceContext, { userId, sessionId });
        assert.equal(active, 0);
        const source = selectSessions(userId).find((item) => item.sessionId === sessionId);
        active += 1;
        return {
          async readExecutionSource() {
            assert.equal(active, 1);
            if (source.error) throw source.error;
            return structuredClone({
              sessionId,
              parentSessionId: source.parentSessionId ?? "",
              turns: Object.values(source.turnLifecycle.turns),
            });
          },
          async [Symbol.asyncDispose]() {
            active -= 1;
          },
        };
      },
    },
    now,
    scopedSessionRoots: [],
  });
}

test("projects root workflow and nested child agents from authoritative turn lifecycle", async () => {
  const reader = service([
    {
      sessionId: "root-session",
      parentSessionId: "",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          root: turn({
            executionKind: "workflow",
            origin: { type: "workflow", workflowRunId: "wf-1" },
            stage: "planning",
          }),
        },
      },
    },
    {
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          child: turn({
            turnScopeId: "child",
            executionId: "agent:child",
            parentExecutionId: "agent:root",
            rootExecutionId: "agent:root",
            origin: { type: "workflow_node", workflowRunId: "wf-1", nodeExecutionId: "node-1" },
          }),
        },
      },
    },
    {
      sessionId: "grandchild-session",
      parentSessionId: "child-session",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          grandchild: turn({
            turnScopeId: "grandchild",
            executionId: "agent:grandchild",
            parentExecutionId: "agent:child",
            rootExecutionId: "agent:root",
          }),
        },
      },
    },
  ]);

  const result = await reader.getExecutionTree({ userId: "u1", executionId: "agent:child" });
  assert.equal(result.found, true);
  assert.equal(result.rootExecutionId, "agent:root");
  assert.equal(result.execution.sessionId, "child-session");
  assert.deepEqual(result.tree.executions["agent:root"].childExecutionIds, ["agent:child"]);
  assert.deepEqual(result.tree.executions["agent:child"].childExecutionIds, ["agent:grandchild"]);
  assert.equal(result.tree.executions["agent:root"].executionKind, "workflow");
  assert.equal(result.tree.executions["agent:root"].capabilities.canStop, true);
});

test("execution record excludes turn timing facts", async () => {
  const reader = service([
    {
      sessionId: "timed-session",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: { root: turn({ createdAt: "2026-07-20T00:00:05.000Z" }) },
      },
      turnTimings: [
        {
          turnScopeId: "root",
          thinkingStartedAt: "2026-07-20T00:00:01.000Z",
        },
      ],
    },
  ]);

  const result = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(result.found, true);
  for (const field of ["startedAt", "finishedAt", "thinkingStartedAt", "thinkingFinishedAt"]) {
    assert.equal(Object.hasOwn(result.execution, field), false, field);
  }
});

test("children query returns direct children only and preserves historical attempts", async () => {
  const reader = service([
    {
      sessionId: "root",
      turnLifecycle: { ...createEmptyTurnLifecycle(), sequence: 2, turns: { root: turn() } },
    },
    {
      sessionId: "attempt-1",
      parentSessionId: "root",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          "attempt-1": turn({
            turnScopeId: "attempt-1",
            executionId: "agent:attempt-1",
            parentExecutionId: "agent:root",
            rootExecutionId: "agent:root",
          }),
        },
      },
    },
    {
      sessionId: "attempt-2",
      parentSessionId: "root",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          "attempt-2": turn({
            turnScopeId: "attempt-2",
            executionId: "agent:attempt-2",
            parentExecutionId: "agent:root",
            rootExecutionId: "agent:root",
          }),
        },
      },
    },
    {
      sessionId: "nested",
      parentSessionId: "attempt-2",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          nested: turn({
            turnScopeId: "nested",
            executionId: "agent:nested",
            parentExecutionId: "agent:attempt-2",
            rootExecutionId: "agent:root",
          }),
        },
      },
    },
  ]);
  const result = await reader.getExecutionChildren({ userId: "u1", executionId: "agent:root" });
  assert.deepEqual(result.children.map((item) => item.executionId).sort(), [
    "agent:attempt-1",
    "agent:attempt-2",
  ]);
});

test("duplicate executionId with different ownership is diagnosed and excluded", async () => {
  const reader = service([
    {
      sessionId: "left",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: { duplicate: turn({ turnScopeId: "duplicate", executionId: "agent:duplicate" }) },
      },
    },
    {
      sessionId: "right",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: { duplicate: turn({ turnScopeId: "duplicate", executionId: "agent:duplicate" }) },
      },
    },
  ]);
  const result = await reader.getExecution({ userId: "u1", executionId: "agent:duplicate" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "execution_identity_conflict");
  assert.deepEqual(
    result.conflict.identities.map((item) => item.sessionId),
    ["left", "right"],
  );
});

test("orphan execution remains visible as a root in the read model", async () => {
  const reader = service([
    {
      sessionId: "orphan",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          orphan: turn({
            turnScopeId: "orphan",
            executionId: "agent:orphan",
            parentExecutionId: "agent:missing",
            rootExecutionId: "agent:missing",
          }),
        },
      },
    },
  ]);
  const result = await reader.getExecutionTree({ userId: "u1", executionId: "agent:orphan" });
  assert.equal(result.found, true);
  assert.equal(result.execution.executionId, "agent:orphan");
  assert.deepEqual(result.tree.rootExecutionIds, ["agent:orphan"]);
});

test("invalid execution targets are rejected before opening the workspace", async () => {
  const reader = createReader(() => assert.fail("invalid targets must not enumerate sessions"));
  for (const [method, target] of [
    ["getExecution", {}],
    ["getExecution", { executionId: " agent:root " }],
    ["getExecutionChildren", { executionId: 42 }],
    ["getExecutionTree", {}],
    ["getExecutionTree", { executionId: "agent:root", rootExecutionId: " " }],
  ]) {
    assert.deepEqual(await reader[method]({ userId: "u1", ...target }), {
      found: false,
      reason: "missing_execution",
    });
  }
});

test("execution reads are isolated by user and observe changed lifecycle facts", async () => {
  const sessionsByUser = {
    u1: [
      {
        sessionId: "u1-session",
        updatedAt: "2026-07-20T00:00:00.000Z",
        turnLifecycle: { ...createEmptyTurnLifecycle(), sequence: 2, turns: { root: turn() } },
      },
    ],
    u2: [
      {
        sessionId: "u2-session",
        updatedAt: "2026-07-20T00:00:00.000Z",
        turnLifecycle: {
          ...createEmptyTurnLifecycle(),
          sequence: 2,
          turns: {
            u2: turn({ turnScopeId: "u2", executionId: "agent:u2", rootExecutionId: "agent:u2" }),
          },
        },
      },
    ],
  };
  const reader = createReader((userId) => sessionsByUser[userId]);

  assert.equal(
    (await reader.getExecution({ userId: "u1", executionId: "agent:root" })).found,
    true,
  );
  assert.equal((await reader.getExecution({ userId: "u2", executionId: "agent:u2" })).found, true);
  assert.equal(
    (await reader.getExecution({ userId: "u2", executionId: "agent:root" })).found,
    false,
  );

  sessionsByUser.u1[0].turnLifecycle.sequence = 4;
  sessionsByUser.u1[0].turnLifecycle.turns.root = turn({
    revision: 4,
    sequence: 4,
    updatedAt: "2026-07-20T00:01:00.000Z",
  });
  const refreshed = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(refreshed.execution.revision, 4);
});

test("scope discovery failure prevents all execution answers and preserves its reason", async () => {
  const failure = Object.assign(new Error("published scope is damaged"), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  const reader = createReader(() => {
    throw failure;
  });
  const request = { userId: "u1", executionId: "agent:root" };
  const expected = {
    found: false,
    reason: "execution_query_incomplete",
    scopeDiscoveryFailure: { code: failure.code, message: failure.message },
  };
  assert.deepEqual(await reader.getExecution(request), expected);
  assert.deepEqual(await reader.getExecutionChildren(request), expected);
  assert.deepEqual(await reader.getExecutionTree(request), expected);
  assert.deepEqual(
    await reader.getExecutionTree({ userId: "u1", rootExecutionId: "agent:root" }),
    expected,
  );
  assert.deepEqual(
    await reader.getExecution({ ...request, executionId: "agent:missing" }),
    expected,
  );
});

test("session directory failure propagates", async () => {
  const failure = new Error("index unavailable");
  const reader = createReader(() => {
    throw failure;
  });
  await assert.rejects(reader.getExecution({ userId: "u1", executionId: "agent:root" }), failure);
});

test("a failed session reader releases before the next read and prevents authoritative answers", async () => {
  const reader = service([
    {
      sessionId: "broken",
      error: Object.assign(new Error("bad"), { code: "SESSION_REPAIR_FAILED" }),
    },
    {
      sessionId: "ok",
      turnLifecycle: { ...createEmptyTurnLifecycle(), sequence: 2, turns: { root: turn() } },
    },
  ]);
  const request = { userId: "u1", executionId: "agent:root" };
  const expected = {
    found: false,
    reason: "execution_query_incomplete",
    unreadableSessions: [{ sessionId: "broken", code: "SESSION_REPAIR_FAILED", message: "bad" }],
  };
  assert.deepEqual(await reader.getExecution(request), expected);
  assert.deepEqual(await reader.getExecutionChildren(request), expected);
  assert.deepEqual(await reader.getExecutionTree(request), expected);
  assert.deepEqual(
    await reader.getExecution({ ...request, executionId: "agent:missing" }),
    expected,
  );
});
