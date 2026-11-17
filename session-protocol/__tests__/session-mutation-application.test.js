/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSessionMutationApplication,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
} from "../src/index.js";

const receipt = {
  commandId: "delete-1",
  type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
  requestHash: "delete-request",
  aggregateVersion: 4,
  committedAt: "2026-11-15T00:00:00.000Z",
  result: { deletedCount: 1, anchorIndex: 2, deletedTurnScopeIds: ["turn-removed"] },
};
const commit = {
  kind: "commit",
  generation: 9,
  receipt,
  baseAggregateVersion: 3,
  metadata: { sessionId: "s1", parentSessionId: "", aggregateVersion: 4 },
  lifecycleHead: { sequence: 5, activeTurnScopeId: "" },
  deletedMessageUids: ["removed"],
  messages: [],
  turns: [{ key: "turn-removed", value: null }],
  replacements: [],
  timings: [],
};
const baseline = { kind: "baseline", generation: 1, receipt };

function decide(overrides = {}) {
  return decideSessionMutationApplication({
    sessionId: "s1",
    projection: commit,
    appliedGeneration: 8,
    knownGeneration: 8,
    currentGeneration: 9,
    ...overrides,
  });
}

test("a command effect advances only its exact predecessor document", () => {
  assert.deepEqual(decide(), { action: "apply", requiredGeneration: 9 });
  assert.deepEqual(decide({ knownGeneration: 9 }), {
    action: "apply",
    requiredGeneration: 9,
  });
  for (const appliedGeneration of [null, 1, 2, 7]) {
    assert.deepEqual(decide({ appliedGeneration }), {
      action: "synchronize",
      requiredGeneration: 9,
    });
  }
});

test("knowing a server generation does not advance the message document", () => {
  assert.deepEqual(decide({ knownGeneration: 11 }), {
    action: "synchronize",
    requiredGeneration: 11,
  });
  assert.deepEqual(decide({ currentGeneration: 11 }), {
    action: "synchronize",
    requiredGeneration: 11,
  });
  assert.deepEqual(decide({ appliedGeneration: 9, knownGeneration: 11 }), {
    action: "synchronize",
    requiredGeneration: 11,
  });
});

test("response-loss retries never replay deletion over an already applied or newer document", () => {
  for (const generation of [9, 10, 100]) {
    assert.deepEqual(decide({ appliedGeneration: generation, knownGeneration: generation }), {
      action: "unchanged",
      requiredGeneration: generation,
    });
  }
});

test("imported receipts require synchronization until a document proves the current generation", () => {
  assert.deepEqual(decide({ projection: baseline }), {
    action: "synchronize",
    requiredGeneration: 9,
  });
  assert.deepEqual(decide({ projection: baseline, appliedGeneration: 9, knownGeneration: 9 }), {
    action: "unchanged",
    requiredGeneration: 9,
  });
  assert.deepEqual(
    decide({
      projection: baseline,
      appliedGeneration: 9,
      knownGeneration: 9,
      currentGeneration: 10,
    }),
    {
      action: "synchronize",
      requiredGeneration: 10,
    },
  );
});

test("invalid generations and impossible server evidence fail explicitly", () => {
  const invalid = { code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID };
  for (const field of ["appliedGeneration", "knownGeneration", "currentGeneration"]) {
    for (const value of [undefined, -1, 0, 1.5, "9", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => decide({ [field]: value }), invalid, `${field}:${value}`);
    }
  }
  assert.throws(() => decide({ knownGeneration: null }), invalid);
  assert.throws(() => decide({ currentGeneration: null }), invalid);
  assert.throws(() => decide({ currentGeneration: 8 }), invalid);
  assert.throws(() => decide({ appliedGeneration: 9 }), invalid);
});

test("late responses still validate command evidence before deciding it is already applied", () => {
  assert.throws(
    () =>
      decide({
        projection: { ...commit, deletedMessageUids: ["one", "two"] },
        appliedGeneration: 100,
        knownGeneration: 100,
      }),
    { code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID },
  );
  assert.throws(() => decide({ sessionId: "another" }), {
    code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID,
  });
});
