/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  buildAuthoritativeExecutionReadModel,
  createAuthoritativeTurnSnapshot,
  queryAuthoritativeExecution,
  queryAuthoritativeExecutionTree,
  resolveAuthoritativeTurnTerminal,
} from "../src/application/index.js";

import { turnRecord } from "./helpers/turn-record.js";

const now = "2026-07-30T00:00:00.000Z";
const turn = (overrides = {}) =>
  turnRecord({
    turnScopeId: "turn-1",
    presentationMessageId: "message-1",
    dialogProcessId: "dialog-1",
    state: "processing",
    phase: "processing",
    executionState: "sending",
    revision: 2,
    sequence: 2,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

test("authority builds active and terminal snapshot from one lifecycle rule", () => {
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "turn-1",
      sequence: 3,
      turns: {
        "turn-1": turn(),
        "turn-0": turn({
          turnScopeId: "turn-0",
          executionId: "agent:turn-0",
          rootExecutionId: "agent:turn-0",
          state: "completed",
          finishedAt: now,
          phase: "completion",
          sequence: 1,
        }),
      },
    },
    turnTimings: [
      {
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
        thinkingFinishedAt: "2026-07-29T23:59:00.000Z",
      },
    ],
    commandId: "snapshot-1",
    sessionId: "s1",
    terminalTurnScopeIds: ["turn-0"],
    parentSessionId: "parent-1",
    knownSequence: 3,
    terminalLimit: 10,
    recovery: "none",
    generatedAt: now,
  });
  assert.equal(snapshot.activeTurn.startedAt, now);
  assert.equal(snapshot.activeTurn.parentSessionId, "parent-1");
  assert.equal(snapshot.recentTerminalTurns[0].parentSessionId, "parent-1");
  assert.equal(snapshot.activeTurn.thinkingFinishedAt, "2026-07-29T23:59:00.000Z");
  assert.equal(Object.hasOwn(snapshot.activeTurn, "thinkingStartedAt"), false);
  assert.deepEqual(
    snapshot.recentTerminalTurns.map((item) => item.turnScopeId),
    ["turn-0"],
  );
  assert.equal(snapshot.unchanged, true);
  assert.equal(snapshot.recovery, "none");
});

test("authority snapshot carries the read-side recovery annotation verbatim", () => {
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "turn-1",
      sequence: 2,
      turns: { "turn-1": turn() },
    },
    turnTimings: [],
    commandId: "snapshot-recovery",
    sessionId: "s1",
    parentSessionId: "",
    terminalTurnScopeIds: [],
    recovery: "finalize",
    knownSequence: 0,
    terminalLimit: 10,
    generatedAt: now,
  });
  assert.equal(snapshot.recovery, "finalize");
  assert.equal(snapshot.activeTurn.state, "processing");
});

test("authority snapshots only terminal Turns represented by canonical messages", () => {
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: {
      ...createEmptyTurnLifecycle(),
      sequence: 3,
      turns: {
        "turn-retained": turn({
          turnScopeId: "turn-retained",
          state: "completed",
          phase: "completion",
          finishedAt: now,
          sequence: 2,
        }),
        "turn-deleted": turn({
          turnScopeId: "turn-deleted",
          state: "stop_completed",
          phase: "stop",
          finishedAt: now,
          sequence: 3,
        }),
      },
    },
    turnTimings: [],
    terminalTurnScopeIds: ["turn-retained"],
    recovery: "none",
    commandId: "snapshot-message-projection",
    sessionId: "s1",
    parentSessionId: "",
    knownSequence: 0,
    terminalLimit: 10,
    generatedAt: now,
  });

  assert.deepEqual(
    snapshot.recentTerminalTurns.map((item) => item.turnScopeId),
    ["turn-retained"],
  );
});

test("authority owns terminal readiness decisions", () => {
  const lifecycle = { ...createEmptyTurnLifecycle(), sequence: 2, turns: { "turn-1": turn() } };
  assert.throws(
    () => resolveAuthoritativeTurnTerminal({ lifecycle, sessionId: "s1", turnScopeId: "turn-1" }),
    /requires commandId/,
  );
  assert.equal(
    resolveAuthoritativeTurnTerminal({
      lifecycle,
      turnTimings: [],
      commandId: "resolve-1",
      sessionId: "s1",
      parentSessionId: "",
      turnScopeId: "missing",
    }).reason,
    "turn_not_found",
  );
  assert.equal(
    resolveAuthoritativeTurnTerminal({
      lifecycle,
      turnTimings: [],
      commandId: "resolve-1",
      sessionId: "s1",
      parentSessionId: "",
      turnScopeId: "turn-1",
    }).reason,
    "turn_not_terminal",
  );

  lifecycle.turns["turn-1"] = turn({
    state: "completed",
    phase: "completion",
    finishedAt: now,
    terminalStatus: {
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
      status: "completed",
      reason: "run_completed",
      description: "",
      updatedAt: now,
    },
  });
  const resolved = resolveAuthoritativeTurnTerminal({
    lifecycle,
    turnTimings: [],
    aggregateVersion: 12,
    commandId: "resolve-1",
    sessionId: "s1",
    parentSessionId: "parent-terminal",
    turnScopeId: "turn-1",
  });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.turn.parentSessionId, "parent-terminal");
  assert.equal(resolved.aggregateVersion, 12);
  assert.equal(resolved.turn.terminalStatus.status, "completed");
});

test("terminal query rejects noncanonical identity before reading lifecycle", () => {
  for (const field of ["commandId", "sessionId", "turnScopeId"]) {
    for (const value of [" padded ", "", 42, null, undefined]) {
      const input = { commandId: "read", sessionId: "s1", turnScopeId: "turn-1", [field]: value };
      input.lifecycle = new Proxy(
        {},
        {
          get() {
            throw new Error("lifecycle_read");
          },
        },
      );
      assert.throws(() => resolveAuthoritativeTurnTerminal(input), TypeError);
    }
  }
});

test("snapshot and terminal reads project the same persisted timing and reject a foreign round owner", () => {
  const lifecycle = {
    ...createEmptyTurnLifecycle(),
    sequence: 2,
    turns: {
      "turn-1": turn({
        state: "completed",
        phase: "completion",
        finishedAt: now,
        terminalStatus: {
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
          status: "completed",
          reason: "run_completed",
          description: "",
          updatedAt: now,
        },
      }),
    },
  };
  const input = {
    lifecycle,
    turnTimings: [
      {
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
        thinkingFinishedAt: now,
        modelLoopRound: 3,
      },
    ],
    commandId: "read",
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 2,
    turnScopeId: "turn-1",
    terminalTurnScopeIds: ["turn-1"],
    recovery: "none",
    terminalLimit: 10,
    knownSequence: 0,
  };
  const before = structuredClone(input);
  const snapshot = createAuthoritativeTurnSnapshot(input);
  const terminal = resolveAuthoritativeTurnTerminal(input);
  assert.equal(
    snapshot.recentTerminalTurns[0].thinkingFinishedAt,
    terminal.turn.thinkingFinishedAt,
  );
  assert.equal(terminal.turn.thinkingFinishedAt, now);
  assert.deepEqual(input, before);
  const invalid = {
    ...input,
    turnTimings: [{ turnScopeId: "turn-1", dialogProcessId: "foreign", modelLoopRound: 3 }],
  };
  for (const read of [createAuthoritativeTurnSnapshot, resolveAuthoritativeTurnTerminal]) {
    assert.throws(() => read(invalid), { code: SESSION_ERROR_CODE.TURN_TIMING_CONFLICT });
  }
});

test("authority execution read model excludes conflicting ownership and builds trees", () => {
  const readModel = buildAuthoritativeExecutionReadModel([
    {
      sessionId: "root",
      turnLifecycle: { ...createEmptyTurnLifecycle(), sequence: 2, turns: { "turn-1": turn() } },
    },
    {
      sessionId: "child",
      parentSessionId: "root",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: {
          child: turn({
            turnScopeId: "child",
            executionId: "agent:child",
            parentExecutionId: "agent:turn-1",
            rootExecutionId: "agent:turn-1",
          }),
        },
      },
    },
    {
      sessionId: "left",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: { conflict: turn({ turnScopeId: "conflict" }) },
      },
    },
    {
      sessionId: "right",
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        sequence: 2,
        turns: { conflict: turn({ turnScopeId: "conflict" }) },
      },
    },
  ]);
  assert.equal(
    queryAuthoritativeExecution(readModel, { executionId: "agent:conflict" }).reason,
    "execution_identity_conflict",
  );
  const tree = queryAuthoritativeExecutionTree(readModel, {
    executionId: "agent:child",
    generatedAt: now,
  });
  assert.equal(tree.rootExecutionId, "agent:turn-1");
  assert.deepEqual(tree.tree.executions["agent:turn-1"].childExecutionIds, ["agent:child"]);
});
