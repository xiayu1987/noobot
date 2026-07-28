/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionReadService } from "../../src/session/services/execution-read-service.js";

const now = () => "2026-07-20T00:00:00.000Z";

function turn(overrides = {}) {
  return {
    turnScopeId: "turn-root",
    executionId: "agent:root",
    executionKind: "agent",
    rootExecutionId: "agent:root",
    state: "processing",
    phase: "processing",
    executionState: "sending",
    revision: 2,
    sequence: 2,
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function service(sessions) {
  return new ExecutionReadService({
    sessionCrudService: { async getAllSessionsData() { return structuredClone(sessions); } },
    now,
  });
}

test("projects root workflow and nested child agents from authoritative turn lifecycle", async () => {
  const reader = service([
    {
      sessionId: "root-session",
      parentSessionId: "",
      turnLifecycle: { turns: { root: turn({ executionKind: "workflow", origin: { type: "workflow", workflowRunId: "wf-1" }, stage: "planning" }) } },
    },
    {
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnLifecycle: { turns: { child: turn({ turnScopeId: "turn-child", executionId: "agent:child", parentExecutionId: "agent:root", rootExecutionId: "agent:root", origin: { type: "workflow_node", workflowNodeExecutionId: "node-1" } }) } },
    },
    {
      sessionId: "grandchild-session",
      parentSessionId: "child-session",
      turnLifecycle: { turns: { grandchild: turn({ turnScopeId: "turn-grandchild", executionId: "agent:grandchild", parentExecutionId: "agent:child", rootExecutionId: "agent:root" }) } },
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

test("execution recovery uses the persisted Turn timing instead of reconnect time", async () => {
  const reader = service([{
    sessionId: "timed-session",
    turnLifecycle: { turns: { root: turn({ createdAt: "2026-07-20T00:00:05.000Z" }) } },
    turnTimings: [{
      turnScopeId: "turn-root",
      thinkingStartedAt: "2026-07-20T00:00:01.000Z",
    }],
  }]);

  const result = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(result.execution.startedAt, "2026-07-20T00:00:01.000Z");
  assert.equal(result.execution.finishedAt, "");
});

test("children query returns direct children only and preserves historical attempts", async () => {
  const reader = service([
    { sessionId: "root", turnLifecycle: { turns: { root: turn() } } },
    { sessionId: "attempt-1", parentSessionId: "root", turnLifecycle: { turns: { a1: turn({ turnScopeId: "a1", executionId: "agent:attempt-1", parentExecutionId: "agent:root" }) } } },
    { sessionId: "attempt-2", parentSessionId: "root", turnLifecycle: { turns: { a2: turn({ turnScopeId: "a2", executionId: "agent:attempt-2", parentExecutionId: "agent:root" }) } } },
    { sessionId: "nested", parentSessionId: "attempt-2", turnLifecycle: { turns: { nested: turn({ turnScopeId: "nested", executionId: "agent:nested", parentExecutionId: "agent:attempt-2" }) } } },
  ]);
  const result = await reader.getExecutionChildren({ userId: "u1", executionId: "agent:root" });
  assert.deepEqual(result.children.map((item) => item.executionId).sort(), ["agent:attempt-1", "agent:attempt-2"]);
});

test("same execution identity resolves deterministically to the newest authoritative fact", async () => {
  const reader = service([
    { sessionId: "same", turnLifecycle: { turns: { old: turn({ executionId: "agent:duplicate", revision: 2, updatedAt: "2026-07-19T00:00:00.000Z" }) } } },
    { sessionId: "same", turnLifecycle: { turns: { newer: turn({ executionId: "agent:duplicate", revision: 3, updatedAt: "2026-07-20T00:00:00.000Z" }) } } },
  ]);
  const result = await reader.getExecution({ userId: "u1", executionId: "agent:duplicate" });
  assert.equal(result.found, true);
  assert.equal(result.execution.revision, 3);
});

test("duplicate executionId with different ownership is diagnosed and excluded", async () => {
  const reader = service([
    { sessionId: "left", turnLifecycle: { turns: { left: turn({ executionId: "agent:duplicate" }) } } },
    { sessionId: "right", turnLifecycle: { turns: { right: turn({ executionId: "agent:duplicate" }) } } },
  ]);
  const result = await reader.getExecution({ userId: "u1", executionId: "agent:duplicate" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "execution_identity_conflict");
  assert.deepEqual(result.conflict.identities.map((item) => item.sessionId), ["left", "right"]);
});

test("orphan execution remains visible as a root in the read model", async () => {
  const reader = service([
    { sessionId: "orphan", turnLifecycle: { turns: { orphan: turn({ executionId: "agent:orphan", parentExecutionId: "agent:missing", rootExecutionId: "agent:missing" }) } } },
  ]);
  const result = await reader.getExecutionTree({ userId: "u1" });
  assert.equal(result.found, true);
  assert.deepEqual(result.tree.rootExecutionIds, ["agent:orphan"]);
});

test("disposable read index is isolated by user and rebuilds when authoritative summaries change", async () => {
  let scans = 0;
  const sessionsByUser = {
    u1: [{ sessionId: "u1-session", updatedAt: "2026-07-20T00:00:00.000Z", turnLifecycle: { turns: { root: turn() } } }],
    u2: [{ sessionId: "u2-session", updatedAt: "2026-07-20T00:00:00.000Z", turnLifecycle: { turns: { root: turn({ executionId: "agent:u2", rootExecutionId: "agent:u2" }) } } }],
  };
  const reader = new ExecutionReadService({
    sessionCrudService: {
      async getAllSessionSummaries({ userId }) {
        return sessionsByUser[userId].map(({ sessionId, updatedAt }) => ({ sessionId, updatedAt }));
      },
      async getAllSessionsData({ userId }) {
        scans += 1;
        return structuredClone(sessionsByUser[userId]);
      },
    },
    now,
  });

  assert.equal((await reader.getExecution({ userId: "u1", executionId: "agent:root" })).found, true);
  assert.equal((await reader.getExecution({ userId: "u1", executionId: "agent:root" })).found, true);
  assert.equal(scans, 1);
  assert.equal((await reader.getExecution({ userId: "u2", executionId: "agent:u2" })).found, true);
  assert.equal(scans, 2);

  sessionsByUser.u1[0].updatedAt = "2026-07-20T00:01:00.000Z";
  sessionsByUser.u1[0].turnLifecycle.turns.root = turn({ revision: 4, sequence: 4, updatedAt: "2026-07-20T00:01:00.000Z" });
  const refreshed = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(refreshed.execution.revision, 4);
  assert.equal(scans, 3);

  reader.invalidate("u1");
  await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(scans, 4);
});

test("summary/index failure falls back to authoritative scan without caching stale facts", async () => {
  let scans = 0;
  let revision = 2;
  const reader = new ExecutionReadService({
    sessionCrudService: {
      async getAllSessionSummaries() { throw new Error("index unavailable"); },
      async getAllSessionsData() {
        scans += 1;
        return [{ sessionId: "root", turnLifecycle: { turns: { root: turn({ revision, sequence: revision }) } } }];
      },
    },
    now,
  });

  assert.equal((await reader.getExecution({ userId: "u1", executionId: "agent:root" })).execution.revision, 2);
  revision = 3;
  assert.equal((await reader.getExecution({ userId: "u1", executionId: "agent:root" })).execution.revision, 3);
  assert.equal(scans, 2);
});
