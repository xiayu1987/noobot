/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  createCommandRequestHash,
  createSessionCommand,
  createSessionSnapshot,
  normalizeDialogProcessId,
  normalizeParentSessionId,
  normalizeSessionId,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  validateSessionCommand,
  validateSessionSnapshot,
} from "../src/index.mjs";

test("session identity normalization has one protocol implementation", () => {
  assert.equal(normalizeSessionId(" session-1 "), "session-1");
  assert.equal(normalizeParentSessionId(` ${"p".repeat(220)} `), "p".repeat(200));
  assert.equal(normalizeDialogProcessId(" dialog-1 "), "dialog-1");
});

test("command fingerprints use the protocol SHA-256 algorithm without Node runtime APIs", () => {
  assert.equal(
    createCommandRequestHash({ hello: "世界", nested: { b: 2, a: 1 } }),
    "0f6b2582ebc00ad8ada743a4b8d8f79b69778ed5847e6b184fbfaf874cbfd02d",
  );
  assert.equal(
    createCommandRequestHash({ nested: { a: 1, b: 2 }, hello: "世界" }),
    "0f6b2582ebc00ad8ada743a4b8d8f79b69778ed5847e6b184fbfaf874cbfd02d",
  );
});

const scope = { userId: "user-1", sessionId: "session-1", parentSessionId: "" };

test("session aggregate conflicts have one protocol error code", () => {
  assert.equal(SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT, "SESSION_AGGREGATE_VERSION_CONFLICT");
});

test("session command has one strict identity and concurrency coordinate", () => {
  const command = createSessionCommand({
    commandId: "command-1",
    type: SESSION_COMMAND.TURN_REPLACE,
    scope,
    expectedAggregateVersion: 4,
    payload: { turnScopeId: "turn-2" },
  });
  assert.deepEqual(validateSessionCommand(command), { valid: true, errors: [] });
  assert.equal(validateSessionCommand({ ...command, idempotencyKey: "old" }).valid, false);
  assert.equal(validateSessionCommand({ ...command, expectedVersion: 4 }).valid, false);
});

test("aggregate concurrency and command idempotency are deterministic", () => {
  assert.deepEqual(
    decideAggregateConcurrency({ expectedAggregateVersion: 3, aggregateVersion: 3 }),
    {
      allowed: true,
      nextAggregateVersion: 4,
    },
  );
  assert.equal(
    decideAggregateConcurrency({ expectedAggregateVersion: 2, aggregateVersion: 3 }).reason,
    "aggregate_version_conflict",
  );
  assert.equal(
    decideCommandIdempotency({
      commandId: "c1",
      type: SESSION_COMMAND.TURN_COMMIT,
      requestHash: "h1",
      receipts: [],
    }).deduplicated,
    false,
  );
  assert.equal(
    decideCommandIdempotency({
      commandId: "c1",
      type: SESSION_COMMAND.TURN_COMMIT,
      requestHash: "h2",
      receipts: [{ commandId: "c1", type: SESSION_COMMAND.TURN_COMMIT, requestHash: "h1" }],
    }).reason,
    "command_id_reuse_conflict",
  );
});

test("session snapshot closes aggregate and event sequence coordinates", () => {
  const snapshot = createSessionSnapshot({
    scope,
    aggregateVersion: 7,
    throughSequence: 12,
    session: { title: "Protocol" },
    turns: [],
    messages: [],
  });
  assert.deepEqual(validateSessionSnapshot(snapshot), { valid: true, errors: [] });
  assert.equal(
    validateSessionSnapshot({ ...snapshot, session: { sessionId: "other" } }).valid,
    false,
  );
});
