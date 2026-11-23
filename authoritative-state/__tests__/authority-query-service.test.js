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
  queryAuthoritativeExecutionChildren,
  queryAuthoritativeExecutionTree,
  resolveIndexedTurnTerminal,
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
    knownSequence: 3,
    terminalLimit: 10,
    recovery: "none",
    generatedAt: now,
  });
  assert.equal(snapshot.activeTurn.startedAt, now);
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
  assert.throws(
    () =>
      resolveIndexedTurnTerminal({
        generatedAt: "2026-07-18T00:00:00.000Z",
        turn: turn(),
        sessionId: "s1",
        turnScopeId: "turn-1",
      }),
    /requires commandId/,
  );
  assert.equal(
    resolveIndexedTurnTerminal({
      generatedAt: "2026-07-18T00:00:00.000Z",
      turn: null,
      turnTimings: [],
      commandId: "resolve-1",
      sessionId: "s1",
      turnScopeId: "missing",
    }).reason,
    "turn_not_found",
  );
  assert.equal(
    resolveIndexedTurnTerminal({
      generatedAt: "2026-07-18T00:00:00.000Z",
      turn: turn(),
      turnTimings: [],
      commandId: "resolve-1",
      sessionId: "s1",
      turnScopeId: "turn-1",
    }).reason,
    "turn_not_terminal",
  );

  const completed = turn({
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
  const resolved = resolveIndexedTurnTerminal({
    generatedAt: "2026-07-18T00:00:00.000Z",
    turn: completed,
    turnTimings: [],
    aggregateVersion: 12,
    commandId: "resolve-1",
    sessionId: "s1",
    turnScopeId: "turn-1",
  });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.aggregateVersion, 12);
  assert.equal(resolved.turn.terminalStatus.status, "completed");
});

test("terminal query rejects noncanonical identity before reading the turn", () => {
  for (const field of ["commandId", "sessionId", "turnScopeId"]) {
    for (const value of [" padded ", "", 42, null, undefined]) {
      const input = { commandId: "read", sessionId: "s1", turnScopeId: "turn-1", [field]: value };
      input.turn = new Proxy(
        {},
        {
          get() {
            assert.fail("turn must not be read");
          },
        },
      );
      assert.throws(() => resolveIndexedTurnTerminal(input), TypeError);
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
    generatedAt: now,
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
    aggregateVersion: 2,
    turnScopeId: "turn-1",
    terminalTurnScopeIds: ["turn-1"],
    recovery: "none",
    terminalLimit: 10,
    knownSequence: 0,
  };
  const before = structuredClone(input);
  const snapshot = createAuthoritativeTurnSnapshot(input);
  const readTerminal = (source) =>
    resolveIndexedTurnTerminal({ ...source, turn: source.lifecycle.turns[source.turnScopeId] });
  const terminal = readTerminal(input);
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
  for (const read of [createAuthoritativeTurnSnapshot, readTerminal]) {
    assert.throws(() => read(invalid), { code: SESSION_ERROR_CODE.TURN_TIMING_CONFLICT });
  }
});

test("authority execution read model excludes conflicting ownership and builds trees", () => {
  const readModel = buildAuthoritativeExecutionReadModel([
    {
      sessionId: "root",
      parentSessionId: "",
      turns: [turn()],
    },
    {
      sessionId: "child",
      parentSessionId: "root",
      turns: [
        turn({
          turnScopeId: "child",
          executionId: "agent:child",
          parentExecutionId: "agent:turn-1",
          rootExecutionId: "agent:turn-1",
        }),
      ],
    },
    {
      sessionId: "left",
      parentSessionId: "",
      turns: [turn({ turnScopeId: "conflict" })],
    },
    {
      sessionId: "right",
      parentSessionId: "",
      turns: [turn({ turnScopeId: "conflict" })],
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

test("execution trees and children do not omit an identity claimed by three roots", () => {
  const roots = ["turn-1", "turn-2", "turn-3"];
  const readModel = buildAuthoritativeExecutionReadModel(
    roots.map((root) => ({
      sessionId: root,
      parentSessionId: "",
      turns: [
        turn({ turnScopeId: root }),
        turn({
          turnScopeId: "duplicate",
          parentExecutionId: `agent:${root}`,
          rootExecutionId: `agent:${root}`,
        }),
      ],
    })),
  );
  for (const root of roots) {
    const executionId = `agent:${root}`;
    for (const query of [queryAuthoritativeExecutionTree, queryAuthoritativeExecutionChildren]) {
      const result = query(readModel, { executionId });
      assert.equal(result.found, false);
      assert.equal(result.reason, "execution_identity_conflict");
      assert.deepEqual(
        result.conflict.identities.map(({ sessionId }) => sessionId),
        roots,
      );
    }
    assert.equal(queryAuthoritativeExecution(readModel, { executionId }).found, true);
  }
});

test("a root-only tree query reports conflicting claims even when the root is not visible", () => {
  const rootExecutionId = "agent:missing-root";
  const claim = turn({
    turnScopeId: "duplicate",
    parentExecutionId: rootExecutionId,
    rootExecutionId,
  });
  const readModel = buildAuthoritativeExecutionReadModel(
    ["left", "right"].map((sessionId) => ({ sessionId, parentSessionId: "", turns: [claim] })),
  );
  assert.equal(
    queryAuthoritativeExecutionTree(readModel, { rootExecutionId }).reason,
    "execution_identity_conflict",
  );
});

test("a selected execution conflicts with claims under a different parent and root", () => {
  const rootExecutionId = "agent:turn-1";
  const otherRoot = "agent:other-root";
  const claim = (root) =>
    turn({ turnScopeId: "duplicate", parentExecutionId: root, rootExecutionId: root });
  const readModel = buildAuthoritativeExecutionReadModel([
    { sessionId: "left", parentSessionId: "", turns: [turn(), claim(rootExecutionId)] },
    { sessionId: "right", parentSessionId: "", turns: [claim(otherRoot)] },
  ]);
  for (const result of [
    queryAuthoritativeExecutionChildren(readModel, { executionId: rootExecutionId }),
    queryAuthoritativeExecutionTree(readModel, { rootExecutionId }),
  ]) {
    assert.equal(result.reason, "execution_identity_conflict");
    assert.deepEqual(
      result.conflict.identities.map(({ rootExecutionId }) => rootExecutionId),
      [rootExecutionId, otherRoot],
    );
  }
});

test("direct children do not depend on conflicts below the queried parent", () => {
  const root = "agent:turn-1";
  const child = "agent:child";
  const grandchild = turn({
    turnScopeId: "grandchild",
    parentExecutionId: child,
    rootExecutionId: root,
  });
  const readModel = buildAuthoritativeExecutionReadModel([
    {
      sessionId: "root",
      parentSessionId: "",
      turns: [
        turn(),
        turn({ turnScopeId: "child", parentExecutionId: root, rootExecutionId: root }),
      ],
    },
    { sessionId: "left", parentSessionId: "root", turns: [grandchild] },
    { sessionId: "right", parentSessionId: "root", turns: [grandchild] },
  ]);
  const result = queryAuthoritativeExecutionChildren(readModel, { executionId: root });
  assert.equal(result.found, true);
  assert.deepEqual(
    result.children.map(({ executionId }) => executionId),
    [child],
  );
  assert.equal(
    queryAuthoritativeExecutionChildren(readModel, { executionId: child }).reason,
    "execution_identity_conflict",
  );
  assert.equal(
    queryAuthoritativeExecutionChildren(readModel, { executionId: "agent:grandchild" }).reason,
    "execution_identity_conflict",
  );
  assert.equal(
    queryAuthoritativeExecutionTree(readModel, { executionId: root }).reason,
    "execution_identity_conflict",
  );
});
