/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COMMAND,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  resolveSessionArtifactSchemaVersion,
  SESSION_ERROR_CODE,
  createCommandRequestHash,
  createTurnAttachmentBindFingerprint,
  createTurnAcceptanceReceipt,
  validateTurnAttachmentsBoundEventData,
  createSessionCommand,
  normalizeDialogProcessId,
  normalizeParentSessionId,
  normalizeSessionId,
  isCanonicalSessionId,
  isCanonicalParentSessionId,
  decideAggregateConcurrency,
  isNewerSessionAggregateVersion,
  createAggregateVersionConflictError,
  createTurnLifecycleRejectedError,
  isTurnLifecycleRejectedError,
  decideCommandIdempotency,
  normalizeCommandReceipt,
  normalizeTurnCommitMetadata,
  createEmptyTurnLifecycle,
  validateSessionAggregateInvariants,
  validateCanonicalAssistantPresentation,
  validateTurnAcceptanceUserMessage,
  validateSessionCommand,
  assertSessionScopeIdentity,
} from "../src/index.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("Session artifact and Turn commit metadata have one canonical protocol shape", () => {
  assert.equal(SESSION_ARTIFACT_SCHEMA_VERSION, 18);
  assert.deepEqual(
    normalizeTurnCommitMetadata({
      action: " SEND ",
      commandId: " command-1 ",
      requestHash: " hash-1 ",
      runState: "pending_start",
    }),
    { action: "send", commandId: "command-1", requestHash: "hash-1" },
  );
  const commitReceipt = {
    commandId: "command-1",
    type: SESSION_COMMAND.TURN_COMMIT,
    requestHash: "hash-1",
    aggregateVersion: 1,
    committedAt: "2026-07-18T00:00:00.000Z",
    result: { messageUid: "message-1" },
  };
  assert.deepEqual(normalizeCommandReceipt(commitReceipt), commitReceipt);
  assert.equal(
    normalizeCommandReceipt({
      ...commitReceipt,
      result: { messageUid: "message-1", runState: "pending_start" },
    }),
    null,
  );
  assert.deepEqual(
    validateSessionAggregateInvariants({
      sessionId: "session-1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      messages: [
        {
          messageUid: "message-1",
          turnCommit: {
            action: "send",
            commandId: "command-1",
            runState: "pending_start",
          },
        },
      ],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
    }).errors,
    ["invalid_turn_commit_metadata"],
  );
});

test("session aggregate requires canonical collection shapes", () => {
  assert.deepEqual(validateSessionAggregateInvariants({ messages: [] }).errors, [
    "invalid_session_id",
    "invalid_parent_session_id",
    "invalid_caller",
    "invalid_dialog_order",
    "invalid_turn_timings",
    "invalid_turn_lifecycle",
  ]);
  assert.deepEqual(
    validateSessionAggregateInvariants({
      sessionId: "session-1",
      parentSessionId: "",
      caller: SESSION_CALLER.BOT,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: { turns: {}, commandReceipts: [] },
    }).errors,
    ["invalid_turn_lifecycle"],
  );
  assert.deepEqual(
    validateSessionAggregateInvariants({
      sessionId: "session-1",
      parentSessionId: "",
      caller: "",
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
    }).errors,
    ["invalid_caller"],
  );
  assert.deepEqual(
    validateSessionAggregateInvariants({
      sessionId: "",
      parentSessionId: null,
      caller: SESSION_CALLER.USER,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
    }).errors,
    ["invalid_session_id", "invalid_parent_session_id"],
  );
  assert.deepEqual(validateSessionAggregateInvariants(null).errors, ["invalid_session"]);
});

test("canonical assistant presentation is unique and fully identified per Turn", () => {
  assert.equal(
    validateCanonicalAssistantPresentation({
      role: "assistant",
      chatPresentation: true,
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
    }).valid,
    true,
  );
  const result = validateSessionAggregateInvariants({
    sessionId: "session-1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    messages: [
      {
        messageUid: "assistant-1",
        role: "assistant",
        chatPresentation: true,
        turnScopeId: "turn-1",
        presentationMessageId: "presentation-1",
      },
      {
        messageUid: "assistant-2",
        role: "assistant",
        chatPresentation: true,
        turnScopeId: "turn-1",
        presentationMessageId: "presentation-1",
      },
    ],
    dialogOrder: [],
    turnTimings: [],
    turnLifecycle: createEmptyTurnLifecycle(),
  });
  assert.equal(result.errors.includes("duplicate_canonical_assistant_presentation"), true);
});

test("Session artifact schema versions are explicit protocol facts", () => {
  assert.equal(resolveSessionArtifactSchemaVersion(undefined), 0);
  assert.equal(
    resolveSessionArtifactSchemaVersion(SESSION_ARTIFACT_SCHEMA_VERSION),
    SESSION_ARTIFACT_SCHEMA_VERSION,
  );
  for (const value of [null, "7", 7.1, -1]) {
    assert.throws(
      () => resolveSessionArtifactSchemaVersion(value),
      (error) => error.code === "SESSION_ARTIFACT_SCHEMA_VERSION_INVALID",
    );
  }
});

test("Turn acceptance owns exactly one authoritative user-message rule", () => {
  const userMessage = { content: "hello", userMessageId: "um_1", messageOrigin: "natural" };
  const send = {
    eventType: "turn.action_accepted",
    action: "send",
    turnScopeId: "turn-1",
    sessionCaller: SESSION_CALLER.USER,
    userMessage,
  };
  const accepted = validateTurnAcceptanceUserMessage(send);
  assert.equal(accepted.valid, true);
  assert.equal(accepted.materialize, true);
  assert.deepEqual(
    validateTurnAcceptanceUserMessage({
      ...send,
      userMessage: { content: "hello", messageOrigin: "natural" },
    }).errors,
    ["accepted_user_userMessageId_required"],
  );
  assert.equal(validateTurnAcceptanceUserMessage({ ...send, userMessage: undefined }).valid, false);
  assert.deepEqual(
    validateTurnAcceptanceUserMessage({
      eventType: "turn.action_accepted",
      action: "resend",
      turnScopeId: "turn-1",
    }),
    { valid: true, materialize: false, value: null, errors: [] },
  );
});

test("Turn acceptance takes dialogProcessId from exactly one source per caller", () => {
  const base = {
    eventType: "turn.action_accepted",
    action: "send",
    turnScopeId: "turn-1",
    userMessage: { content: "hello", userMessageId: "um_1", messageOrigin: "natural" },
  };
  const errorsOf = (extra) => validateTurnAcceptanceUserMessage({ ...base, ...extra }).errors;
  assert.deepEqual(errorsOf({ sessionCaller: SESSION_CALLER.USER }), []);
  for (const dialogProcessId of ["dp-1", "", undefined]) {
    assert.deepEqual(errorsOf({ sessionCaller: SESSION_CALLER.USER, dialogProcessId }), [
      "accepted_user_dialog_process_id_forbidden",
    ]);
  }
  assert.deepEqual(errorsOf({ sessionCaller: SESSION_CALLER.BOT, dialogProcessId: "dp-1" }), []);
  for (const dialogProcessId of [undefined, "", " dp-1 "]) {
    assert.deepEqual(errorsOf({ sessionCaller: SESSION_CALLER.BOT, dialogProcessId }), [
      "accepted_bot_dialog_process_id_required",
    ]);
  }
  for (const sessionCaller of [undefined, "", "system"]) {
    assert.deepEqual(errorsOf({ sessionCaller }), ["accepted_session_caller_required"]);
  }
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

test("canonical session id predicates accept only normalized text", () => {
  assert.equal(isCanonicalSessionId("session-1"), true);
  for (const value of ["", " session-1", "session-1 ", "s".repeat(201), undefined, null, 1]) {
    assert.equal(isCanonicalSessionId(value), false);
  }
  assert.equal(isCanonicalParentSessionId(""), true);
  assert.equal(isCanonicalParentSessionId("root"), true);
  for (const value of [" root", "p".repeat(201), undefined, null, 1]) {
    assert.equal(isCanonicalParentSessionId(value), false);
  }
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
      userMessageId: "m1",
      role: "user",
      content: "hello",
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      attachments: [{ attachmentId: "a1", sessionId: "s1" }],
    },
  };
  assert.deepEqual(validateTurnAttachmentsBoundEventData(valid), { valid: true, errors: [] });
  assert.equal(
    validateTurnAttachmentsBoundEventData({
      ...valid,
      userMessage: { ...valid.userMessage, attachments: [] },
    }).valid,
    false,
  );
});

const scope = { userId: "user-1", sessionId: "session-1", parentSessionId: "" };

test("session aggregate conflicts have one protocol error code", () => {
  assert.equal(SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT, "SESSION_AGGREGATE_VERSION_CONFLICT");
});

test("session scope identity has one protocol assertion over sessionId and parentSessionId", () => {
  const session = { sessionId: "child", parentSessionId: "root" };
  assert.doesNotThrow(() =>
    assertSessionScopeIdentity({ session, sessionId: "child", parentSessionId: "root" }),
  );
  for (const scope of [
    { sessionId: "other", parentSessionId: "root" },
    { sessionId: "child", parentSessionId: "" },
    { sessionId: "child", parentSessionId: "other" },
  ]) {
    assert.throws(() => assertSessionScopeIdentity({ session, ...scope }), {
      code: SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT,
      statusCode: 409,
    });
  }
  assert.throws(
    () => assertSessionScopeIdentity({ session: null, sessionId: "child", parentSessionId: "" }),
    { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
  );
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

test("command receipts own aggregate versions only for Session commands", () => {
  const base = {
    commandId: "command-1",
    requestHash: "hash-1",
    committedAt: "2026-07-18T00:00:00.000Z",
    turnScopeId: "turn-1",
  };
  const sessionReceipt = {
    ...base,
    type: SESSION_COMMAND.TURN_COMMIT,
    aggregateVersion: 2,
    result: { messageUid: "message-1" },
  };
  const turnReceipt = {
    ...base,
    type: "turn.action_accepted",
    revision: 1,
    sequence: 1,
    eventId: "event-1",
    envelope: { identity: { eventId: "event-1" } },
  };
  assert.deepEqual(normalizeCommandReceipt(sessionReceipt), sessionReceipt);
  assert.deepEqual(normalizeCommandReceipt(turnReceipt), turnReceipt);
  const { aggregateVersion: _omitted, ...sessionWithoutVersion } = sessionReceipt;
  for (const invalid of [
    sessionWithoutVersion,

    { ...sessionReceipt, eventId: "" },
    { ...sessionReceipt, envelope: null },
    { ...sessionReceipt, revision: 0, sequence: 0 },
    { ...turnReceipt, aggregateVersion: 0 },
    { ...turnReceipt, result: {} },

    { ...turnReceipt, envelope: null },
    { ...turnReceipt, eventId: "" },
    { ...turnReceipt, envelope: { identity: { eventId: "event-2" } } },
    { ...turnReceipt, revision: "1" },
    { ...turnReceipt, type: "turn.accepted" },
    { ...turnReceipt, committedAt: "" },
  ]) {
    assert.equal(normalizeCommandReceipt(invalid), null, JSON.stringify(invalid));
  }
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
  assert.equal(isNewerSessionAggregateVersion(4, 3), true);
  assert.equal(isNewerSessionAggregateVersion(3, 3), false);
  assert.equal(isNewerSessionAggregateVersion(2, 3), false);
  for (const invalid of [null, undefined, "", "3", -1, 1.5]) {
    assert.throws(
      () => isNewerSessionAggregateVersion(invalid, 3),
      (error) => error.code === SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
    );
    assert.throws(
      () => isNewerSessionAggregateVersion(3, invalid),
      (error) => error.code === SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
    );
  }
  const conflict = createAggregateVersionConflictError({ currentVersion: 7 });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.code, SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT);
  assert.equal(conflict.currentVersion, 7);
  for (const invalid of [null, undefined, "", "7", -1, 1.5]) {
    assert.throws(
      () => createAggregateVersionConflictError({ currentVersion: invalid }),
      (error) => error.code === SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
    );
  }
  const rejectedConflict = createTurnLifecycleRejectedError({
    applied: false,
    reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
    currentVersion: 4,
  });
  assert.equal(isTurnLifecycleRejectedError(rejectedConflict), true);
  assert.equal(rejectedConflict.code, SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT);
  assert.equal(rejectedConflict.currentVersion, 4);
  for (const invalid of [null, undefined, "4", -1, 1.5]) {
    assert.throws(
      () =>
        createTurnLifecycleRejectedError({
          reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: invalid,
        }),
      (error) => error.code === SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
    );
  }
  const rejectedAction = createTurnLifecycleRejectedError({
    applied: false,
    reason: "session_action_conflict",
  });
  assert.equal(rejectedAction.code, "session_action_conflict");
  assert.equal(Object.hasOwn(rejectedAction, "currentVersion"), false);
  assert.throws(
    () =>
      createTurnLifecycleRejectedError({ reason: "session_action_conflict", currentVersion: 4 }),
    /currentVersion is only allowed for aggregate version conflicts/,
  );
  assert.throws(() => createTurnLifecycleRejectedError("session_action_conflict"), TypeError);
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
      receipts: [
        {
          commandId: "c1",
          type: SESSION_COMMAND.TURN_COMMIT,
          requestHash: "h1",
          aggregateVersion: 1,
          committedAt: "2026-07-18T00:00:00.000Z",
          result: { messageUid: "message-1" },
        },
      ],
    }).reason,
    "command_id_reuse_conflict",
  );
});
