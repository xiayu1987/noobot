/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { commitTurnDeletion } from "../src/application/commit-turn-deletion.js";

test("turn deletion removes lifecycle facts and receipts for the deleted scopes", () => {
  const committed = commitTurnDeletion({
    lifecycle: {
      activeTurnScopeId: "turn-delete",
      sequence: 8,
      turns: {
        "turn-keep": {
          turnScopeId: "turn-keep",
          state: "completed",
          continuedByTurnScopeId: "turn-delete",
          sequence: 4,
        },
        "turn-delete": {
          turnScopeId: "turn-delete",
          state: "stop_completed",
          sequence: 8,
        },
      },
      commandReceipts: [
        {
          commandId: "keep",
          type: "turn.completed",
          requestHash: "request-hash-keep",
          aggregateVersion: 4,
          turnScopeId: "turn-keep",
        },
        {
          commandId: "delete",
          type: "turn.stop_completed",
          requestHash: "request-hash-delete",
          aggregateVersion: 8,
          turnScopeId: "turn-delete",
        },
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
      turns: {
        source: {
          turnScopeId: "source",
          dialogProcessId: "source-dialog",
          state: "stop_completed",
        },
        continuation: {
          turnScopeId: "continuation",
          dialogProcessId: "continuation-dialog",
          state: "completed",
          continuationSource: { turnScopeId: "source", dialogProcessId: "source-dialog" },
        },
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
