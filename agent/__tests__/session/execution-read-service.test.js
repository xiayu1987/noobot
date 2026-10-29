/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import {
  SESSIONS_SUMMARY_SCHEMA_VERSION,
  SESSION_SUMMARY_AVAILABILITY,
  requireSessionsSummaryPayload,
} from "@noobot/session-protocol/sessions-summary";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionReadService } from "../../src/session/services/execution-read-service.js";

const now = () => "2026-07-20T00:00:00.000Z";

function availableSummary({ sessionId, updatedAt }) {
  return {
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt,
    aggregateVersion: 1,
    title: sessionId,
    messageCount: 0,
    lastMessage: null,
    activeTurnScopeId: "",
    availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
  };
}

function summaryPayload(entries) {
  return requireSessionsSummaryPayload({
    schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
    sessions: entries,
    updatedAt: now(),
  });
}

function turn(overrides = {}) {
  return {
    turnScopeId: "root",
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
    sessionCrudService: {
      async getAllSessionSummaries() {
        return summaryPayload(
          sessions.map(({ sessionId }) => availableSummary({ sessionId, updatedAt: now() })),
        );
      },
      async getAllSessionsData() {
        return structuredClone(sessions);
      },
    },
    now,
  });
}

test("projects root workflow and nested child agents from authoritative turn lifecycle", async () => {
  const reader = service([
    {
      sessionId: "root-session",
      parentSessionId: "",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
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
        turns: {
          child: turn({
            turnScopeId: "child",
            executionId: "agent:child",
            parentExecutionId: "agent:root",
            rootExecutionId: "agent:root",
            origin: { type: "workflow_node", nodeExecutionId: "node-1" },
          }),
        },
      },
    },
    {
      sessionId: "grandchild-session",
      parentSessionId: "child-session",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
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
      turnLifecycle: { ...createEmptyTurnLifecycle(), turns: { root: turn() } },
    },
    {
      sessionId: "attempt-1",
      parentSessionId: "root",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        turns: {
          a1: turn({
            turnScopeId: "attempt-1",
            executionId: "agent:attempt-1",
            parentExecutionId: "agent:root",
          }),
        },
      },
    },
    {
      sessionId: "attempt-2",
      parentSessionId: "root",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        turns: {
          a2: turn({
            turnScopeId: "attempt-2",
            executionId: "agent:attempt-2",
            parentExecutionId: "agent:root",
          }),
        },
      },
    },
    {
      sessionId: "nested",
      parentSessionId: "attempt-2",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        turns: {
          nested: turn({
            turnScopeId: "nested",
            executionId: "agent:nested",
            parentExecutionId: "agent:attempt-2",
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
        turns: { left: turn({ turnScopeId: "duplicate", executionId: "agent:duplicate" }) },
      },
    },
    {
      sessionId: "right",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        turns: { right: turn({ turnScopeId: "duplicate", executionId: "agent:duplicate" }) },
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

test("execution tree query without target is rejected", async () => {
  const reader = service([
    { sessionId: "s1", turnLifecycle: { ...createEmptyTurnLifecycle(), turns: { root: turn() } } },
  ]);
  const result = await reader.getExecutionTree({ userId: "u1" });
  assert.deepEqual(result, { found: false, reason: "missing_execution" });
});

test("disposable read index is isolated by user and rebuilds when authoritative summaries change", async () => {
  let scans = 0;
  const sessionsByUser = {
    u1: [
      {
        sessionId: "u1-session",
        updatedAt: "2026-07-20T00:00:00.000Z",
        turnLifecycle: { ...createEmptyTurnLifecycle(), turns: { root: turn() } },
      },
    ],
    u2: [
      {
        sessionId: "u2-session",
        updatedAt: "2026-07-20T00:00:00.000Z",
        turnLifecycle: {
          ...createEmptyTurnLifecycle(),
          turns: {
            root: turn({ turnScopeId: "u2", executionId: "agent:u2", rootExecutionId: "agent:u2" }),
          },
        },
      },
    ],
  };
  const reader = new ExecutionReadService({
    sessionCrudService: {
      async getAllSessionSummaries({ userId }) {
        return summaryPayload(sessionsByUser[userId].map(availableSummary));
      },
      async getAllSessionsData({ userId }) {
        scans += 1;
        return structuredClone(sessionsByUser[userId]);
      },
    },
    now,
  });

  assert.equal(
    (await reader.getExecution({ userId: "u1", executionId: "agent:root" })).found,
    true,
  );
  assert.equal(
    (await reader.getExecution({ userId: "u1", executionId: "agent:root" })).found,
    true,
  );
  assert.equal(scans, 1);
  assert.equal((await reader.getExecution({ userId: "u2", executionId: "agent:u2" })).found, true);
  assert.equal(scans, 2);

  sessionsByUser.u1[0].updatedAt = "2026-07-20T00:01:00.000Z";
  sessionsByUser.u1[0].turnLifecycle.turns.root = turn({
    revision: 4,
    sequence: 4,
    updatedAt: "2026-07-20T00:01:00.000Z",
  });
  const refreshed = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(refreshed.execution.revision, 4);
  assert.equal(scans, 3);
});

test("summary read failure propagates instead of falling back to an uncached scan", async () => {
  let scans = 0;
  const reader = new ExecutionReadService({
    sessionCrudService: {
      async getAllSessionSummaries() {
        throw new Error("index unavailable");
      },
      async getAllSessionsData() {
        scans += 1;
        return [];
      },
    },
    now,
  });
  await assert.rejects(
    reader.getExecution({ userId: "u1", executionId: "agent:root" }),
    /index unavailable/,
  );
  assert.equal(scans, 0);
});

test("unreadable sessions are skipped and surfaced as read diagnostics", async () => {
  const reader = new ExecutionReadService({
    sessionCrudService: {
      async getAllSessionSummaries() {
        return summaryPayload([availableSummary({ sessionId: "ok", updatedAt: now() })]);
      },
      async getAllSessionsData({ failures }) {
        failures.push({ sessionId: "broken", code: "SESSION_REPAIR_FAILED", message: "bad" });
        return [
          {
            sessionId: "ok",
            parentSessionId: "",
            turnLifecycle: { ...createEmptyTurnLifecycle(), turns: { root: turn() } },
          },
        ];
      },
    },
    now,
  });
  const tree = await reader.getExecutionTree({ userId: "u1", rootExecutionId: "agent:root" });
  assert.equal(tree.found, true);
  assert.deepEqual(tree.unreadableSessions, [
    { sessionId: "broken", code: "SESSION_REPAIR_FAILED", message: "bad" },
  ]);
  const snapshot = await reader.getExecution({ userId: "u1", executionId: "agent:root" });
  assert.equal(snapshot.unreadableSessions.length, 1);
});
