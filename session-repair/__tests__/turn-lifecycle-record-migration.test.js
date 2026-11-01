/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyTurnLifecycle,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { SESSION_REPAIR_DATA_REJECTION_CODES } from "../src/errors.js";
import { turnRecord } from "./helpers/turn-record.js";
import { releasedSession } from "./helpers/released-session.js";

function source(turn = turnRecord(), schemaVersion = 20) {
  return releasedSession({
    schemaVersion,
    sessionId: "s-1",
    caller: "user",
    aggregateVersion: 0,
    dialogOrder: [],
    turnLifecycle: { ...createEmptyTurnLifecycle(), sequence: 1, turns: { "turn-1": turn } },
  });
}
const REJECTION = "SESSION_TURN_LIFECYCLE_RECORD_UNMIGRATABLE";

test("schema20 migration preserves lifecycle facts, makes absence explicit and converges", () => {
  const document = source();
  for (const field of [
    "origin",
    "summaryVersion",
    "failure",
    "finalizeIntent",
    "completionCommitId",
  ]) {
    delete document.turnLifecycle.turns["turn-1"][field];
  }
  const before = structuredClone(document);
  const result = migrateSessionDocument(document);
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  assert.ok(result.migrations.includes("turn-lifecycle-record-v21"));
  assert.deepEqual(document, before);
  assert.deepEqual(result.document.turnLifecycle.turns["turn-1"], turnRecord());
  const repeated = migrateSessionDocument(result.document);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.document, result.document);
});

for (const [name, changes] of [
  ["missing execution identity", { executionId: undefined }],
  ["invalid origin", { origin: [] }],
  ["malformed intent", { finalizeIntent: {} }],
  ["unsupported intent payload", { finalizeIntent: { payload: { x: 1 } } }],
  ["conflicting failure phase", { failure: { phase: "stop" } }],
]) {
  test(`migration rejects ${name} atomically as an isolatable data error`, () => {
    const document = source(turnRecord(changes));
    const before = structuredClone(document);
    assert.throws(
      () => migrateSessionDocument(document),
      (error) => {
        assert.equal(error.code, REJECTION);
        assert.ok(SESSION_REPAIR_DATA_REJECTION_CODES.includes(error.code));
        return true;
      },
    );
    assert.deepEqual(document, before);
    assert.equal(
      migrateSessionDocument(source()).document.schemaVersion,
      SESSION_ARTIFACT_SCHEMA_VERSION,
    );
  });
}

test("current schema does not reapply historical missing-field migration", () => {
  const document = source(turnRecord({ origin: undefined }), SESSION_ARTIFACT_SCHEMA_VERSION);
  const before = structuredClone(document);
  assert.throws(() => migrateSessionDocument(document), { code: REJECTION });
  assert.deepEqual(document, before);
});

test("historical nonretryable failure intent is removed only when otherwise valid", () => {
  const turn = turnRecord({
    state: "completion_failed",
    phase: "completion",
    executionState: "error",
    finishedAt: "2026-07-30T00:00:01.000Z",
    failure: { code: "failed", message: "failed", retryable: false },
    finalizeIntent: {
      type: "completion",
      commandId: "finalize-1",
      retryable: true,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
      payload: {},
    },
  });
  const document = source(turn);
  document.turnLifecycle.activeTurnScopeId = "turn-1";
  const migrated = migrateSessionDocument(document).document;
  assert.equal(migrated.turnLifecycle.turns["turn-1"].finalizeIntent, null);
  assert.equal(migrated.turnLifecycle.activeTurnScopeId, "");
  document.turnLifecycle.turns["turn-1"].finalizeIntent.commandId = 12;
  assert.throws(() => migrateSessionDocument(document), { code: REJECTION });
});
