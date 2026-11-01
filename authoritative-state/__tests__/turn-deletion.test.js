/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { turnRecord } from "./helpers/turn-record.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";

import { commitTurnDeletion } from "../src/application/commit-turn-deletion.js";

test("turn deletion removes lifecycle facts and receipts for the deleted scopes", () => {
  const turnReceipt = (commandId, type, turnScopeId) => ({
    commandId,
    type,
    requestHash: `request-hash-${commandId}`,
    turnScopeId,
    revision: 1,
    sequence: 1,
    committedAt: "2026-07-18T00:00:00.000Z",
    eventId: `event-${commandId}`,
    envelope: { identity: { eventId: `event-${commandId}` } },
  });
  const committed = commitTurnDeletion({
    lifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "",
      sequence: 8,
      turns: {
        "turn-keep": turnRecord({
          turnScopeId: "turn-keep",
          state: "stop_completed",
          phase: "stop",
          finishedAt: "2026-07-30T00:00:00.000Z",
          continuedByTurnScopeId: "turn-delete",
          revision: 1,
          sequence: 4,
        }),
        "turn-delete": turnRecord({
          turnScopeId: "turn-delete",
          action: "continue",
          continuationSource: { turnScopeId: "turn-keep", dialogProcessId: "dialog-1" },
          state: "stop_completed",
          phase: "stop",
          finishedAt: "2026-07-30T00:00:00.000Z",
          revision: 1,
          sequence: 8,
        }),
      },
      commandReceipts: [
        turnReceipt("keep", "turn.completed", "turn-keep"),
        turnReceipt("delete", "turn.stop_completed", "turn-delete"),
      ],
    },
    turnScopeIds: ["turn-delete", "turn-delete"],
  });

  assert.equal(committed.applied, true);
  assert.deepEqual(committed.removedTurnScopeIds, ["turn-delete"]);
  assert.deepEqual(Object.keys(committed.lifecycle.turns), ["turn-keep"]);
  assert.equal(committed.lifecycle.turns["turn-keep"].continuedByTurnScopeId, "");
  assert.equal(committed.lifecycle.activeTurnScopeId, "");
  assert.equal(committed.lifecycle.sequence, 9);
  assert.deepEqual(
    committed.lifecycle.commandReceipts.map((receipt) => receipt.turnScopeId),
    ["turn-keep"],
  );
});

test("turn deletion clears a surviving continuation's reference to the deleted source", () => {
  const committed = commitTurnDeletion({
    lifecycle: {
      ...createEmptyTurnLifecycle(),
      sequence: 2,
      turns: {
        source: turnRecord({
          turnScopeId: "source",
          continuedByTurnScopeId: "continuation",
          dialogProcessId: "source-dialog",
          state: "stop_completed",
          phase: "stop",
          finishedAt: "2026-07-30T00:00:00.000Z",
          revision: 1,
          sequence: 1,
        }),
        continuation: turnRecord({
          turnScopeId: "continuation",
          action: "continue",
          dialogProcessId: "continuation-dialog",
          state: "completed",
          phase: "completion",
          finishedAt: "2026-07-30T00:00:00.000Z",
          revision: 1,
          sequence: 2,
          continuationSource: { turnScopeId: "source", dialogProcessId: "source-dialog" },
        }),
      },
    },
    turnScopeIds: ["source"],
  });

  assert.equal(committed.applied, true);
  assert.deepEqual(committed.removedTurnScopeIds, ["source"]);
  assert.deepEqual(Object.keys(committed.lifecycle.turns), ["continuation"]);
  assert.equal(committed.lifecycle.turns.continuation.continuationSource, null);
  assert.deepEqual(committed.clearedContinuationSourceTurnScopeIds, ["continuation"]);
});
