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
  createTurnAttachmentBindFingerprint,
  createTurnAcceptanceReceipt,
  validateTurnAttachmentsBoundEventData,
  createSessionCommand,
  createSessionSnapshot,
  normalizeDialogProcessId,
  normalizeParentSessionId,
  normalizeSessionId,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  validateTurnAcceptanceUserMessage,
  validateSessionCommand,
  validateSessionSnapshot,
} from "../src/index.js";

test("Turn acceptance owns exactly one authoritative user-message rule", () => {
  const accepted = validateTurnAcceptanceUserMessage({
    eventType: "turn.action_accepted",
    action: "send",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    userMessage: { content: "hello", frontendUserMessage: true },
  });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.materialize, true);
  assert.equal(
    validateTurnAcceptanceUserMessage({
      eventType: "turn.action_accepted",
      action: "send",
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
    }).valid,
    false,
  );
  assert.deepEqual(
    validateTurnAcceptanceUserMessage({
      eventType: "turn.action_accepted",
      action: "resend",
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
    }),
    { valid: true, materialize: false, value: null, errors: [] },
  );
});

test("Turn acceptance receipt keeps transaction facts outside run configuration", () => {
  const receipt = createTurnAcceptanceReceipt({
    commandId: "command-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    messageUid: "message-1",
    aggregateVersion: 1,
    committedEventPublished: true,
  });
  assert.equal(receipt.aggregateVersion, 1);
  assert.equal(receipt.committedEventPublished, true);
  assert.throws(
    () => createTurnAcceptanceReceipt({ ...receipt, messageUid: "" }),
    /messageUid_missing/,
  );
});

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

test("attachment binding fingerprints are stable and identify canonical attachment sets", () => {
  const attachmentA = { attachmentId: "a1", sessionId: "s1", attachmentSource: "user" };
  const attachmentB = { attachmentId: "a2", sessionId: "s1", attachmentSource: "user" };
  const first = createTurnAttachmentBindFingerprint({
    turnScopeId: "t1",
    messageUid: "sm_1",
    attachments: [attachmentB, attachmentA],
  });
  const reordered = createTurnAttachmentBindFingerprint({
    turnScopeId: "t1",
    messageUid: "sm_1",
    attachments: [attachmentA, attachmentB],
  });
  const different = createTurnAttachmentBindFingerprint({
    turnScopeId: "t1",
    messageUid: "sm_1",
    attachments: [attachmentA],
  });
  assert.equal(first, reordered);
  assert.notEqual(first, different);
});

test("attachment binding is a canonical Session command type", () => {
  const command = createSessionCommand({
    commandId: "bind-1",
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    scope,
    expectedAggregateVersion: 1,
    payload: { turnScopeId: "t1", messageUid: "sm_1", attachments: [] },
  });
  assert.deepEqual(validateSessionCommand(command), { valid: true, errors: [] });
});

test("attachment binding event requires the bound canonical user message", () => {
  const valid = {
    sessionId: "s1",
    aggregateVersion: 2,
    dialogProcessId: "d1",
    turnScopeId: "t1",
    userMessage: {
      messageUid: "sm_1",
      messageId: "m1",
      role: "user",
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      attachments: [{ attachmentId: "a1", sessionId: "s1" }],
    },
  };
  assert.deepEqual(validateTurnAttachmentsBoundEventData(valid), { ok: true, errors: [] });
  assert.equal(
    validateTurnAttachmentsBoundEventData({
      ...valid,
      userMessage: { ...valid.userMessage, attachments: [] },
    }).ok,
    false,
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
