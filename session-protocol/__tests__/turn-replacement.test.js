/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTurnReplaceRequest,
  parseTurnReplacementChange,
  createTurnReplaceFingerprint,
  matchesTurnReplacementAnchor,
} from "../src/command/turn-replace-command.js";
import {
  assertTurnReplacementCommit,
  createTurnReplacementCommit,
  validateTurnReplacementCommit,
} from "../src/lifecycle/turn-replacement.js";

function input(overrides = {}) {
  return {
    commandId: "resend-1",
    sessionId: "session-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageUid: "user-new",
    requestHash: "request-hash-1",
    committedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

test("replacement anchor is a natural user at or before the first message in the same dialog", () => {
  const message = {
    sessionId: "session-1",
    dialogProcessId: "dialog-old",
    turnScopeId: "turn-source",
    messageUid: "indexed-user",
    role: "user",
    type: "message",
    messageOrigin: "natural",
  };
  const first = {
    ordinal: 12,
    message: { ...message, turnScopeId: "continuation", messageUid: "first-message" },
  };
  const matches = (candidate) =>
    matchesTurnReplacementAnchor({ first, indexedMessageUid: "indexed-user", candidate });
  assert.equal(matches({ message, ordinal: 10 }), true);
  assert.equal(matches({ message, ordinal: 13 }), false);
  assert.equal(matches({ message, ordinal: NaN }), false);
  for (const overrides of [
    { messageUid: "wrong-user" },
    { sessionId: "other-session" },
    { dialogProcessId: "other-dialog" },
    { messageOrigin: "internal" },
    { role: "assistant" },
  ]) {
    assert.equal(matches({ message: { ...message, ...overrides }, ordinal: 10 }), false);
  }
});

test("replacement change accepts only its explicit canonical identity fields", () => {
  const command = {
    commandId: "replace-1",
    anchor: { turnScopeId: "old" },
    newContent: "edited",
    turnScopeId: "new",
    attachments: [],
  };
  const identity = { dialogProcessId: "dialog-new", messageUid: "sm_new", userMessageId: "um_new" };
  const captured = parseTurnReplacementChange({ command, identity });
  identity.messageUid = "changed";
  assert.equal(captured.identity.messageUid, "sm_new");
  assert.equal(Object.isFrozen(captured.identity), true);
  for (const invalid of [
    undefined,
    null,
    {},
    { ...identity, messageUid: " " },
    { ...identity, userMessageId: 42 },
    { ...identity, sessionId: "other-session" },
    { ...identity, content: "injected" },
  ])
    assert.throws(
      () => parseTurnReplacementChange({ command, identity: invalid }),
      /requires canonical/,
    );
  assert.throws(
    () => parseTurnReplacementChange({ command, identity, extra: true }),
    /requires canonical/,
  );
});

test("replacement request captures immutable attachment values before asynchronous submission", () => {
  const identity = { attachmentId: "att-1", sessionId: "session-1", attachmentSource: "user" };
  const attachment = { ...identity, metadata: { tags: ["original"] } };
  const source = {
    commandId: "replace-1",
    anchor: { turnScopeId: "old" },
    newContent: "edited",
    turnScopeId: "new",
    attachments: [attachment],
  };
  const captured = parseTurnReplaceRequest(source);
  const fingerprint = createTurnReplaceFingerprint(captured);
  attachment.attachmentId = "changed";
  attachment.metadata.tags.push("changed");
  source.attachments.push({ ...identity, attachmentId: "att-2" });
  source.anchor.turnScopeId = "changed";
  assert.deepEqual(captured.attachments, [{ ...identity, metadata: { tags: ["original"] } }]);
  assert.equal(captured.anchor.turnScopeId, "old");
  assert.equal(createTurnReplaceFingerprint(captured), fingerprint);
  assert.throws(() => captured.attachments[0].metadata.tags.push("changed"), TypeError);
});

test("replacement request validates attachment values after serialization", () => {
  const request = {
    commandId: "replace-1",
    anchor: { turnScopeId: "old" },
    newContent: "edited",
    turnScopeId: "new",
  };
  for (const value of [null, "attachment", []])
    assert.throws(
      () =>
        parseTurnReplaceRequest({
          ...request,
          attachments: [{ toJSON: () => value }],
        }),
      /requires canonical/,
    );
  const circular = {};
  circular.self = circular;
  assert.throws(() => parseTurnReplaceRequest({ ...request, attachments: [circular] }), TypeError);
});

test("replacement validates the captured values rather than reading dynamic inputs again", () => {
  let reads = 0;
  const request = {
    commandId: "replace-1",
    anchor: { turnScopeId: "old" },
    get newContent() {
      reads += 1;
      return reads === 1 ? "edited" : " ";
    },
    turnScopeId: "new",
    attachments: [],
  };
  assert.equal(parseTurnReplaceRequest(request).newContent, "edited");
  assert.equal(reads, 1);
  const command = { ...request, newContent: "edited" };
  const identity = { dialogProcessId: "dialog-new", messageUid: "sm_new", userMessageId: "um_new" };
  assert.throws(
    () =>
      parseTurnReplacementChange({
        command,
        identity: { ...identity, toJSON: () => ({ ...identity, messageUid: " " }) },
      }),
    /requires canonical/,
  );
});

test("turn replacement commit binds one replacement user to one committed session version", () => {
  const commit = createTurnReplacementCommit(input());
  assert.equal(validateTurnReplacementCommit(commit).valid, true);
  assert.equal(assertTurnReplacementCommit(commit), commit);
  assert.equal(commit.committedAggregateVersion, 4);
  assert.equal(Object.isFrozen(commit.replacedTurnScopeIds), true);
});

test("turn replacement commit requires every field and never fills a default", () => {
  for (const field of Object.keys(input())) {
    const { [field]: _omitted, ...rest } = input();
    assert.throws(
      () => createTurnReplacementCommit(rest),
      /invalid turn replacement commit/,
      field,
    );
  }
});

test("turn replacement commit rejects non-canonical values instead of coercing them", () => {
  const invalid = [
    { committedAggregateVersion: "4" },
    { committedAggregateVersion: 0 },
    { commandId: " resend-1" },
    { replacedTurnScopeIds: [] },
    { replacedTurnScopeIds: ["turn-old", "turn-old"] },
    { replacedTurnScopeIds: ["turn-old", ""] },
    { replacementTurnScopeId: "turn-old" },
  ];
  for (const overrides of invalid) {
    assert.throws(
      () => createTurnReplacementCommit(input(overrides)),
      /invalid turn replacement commit/,
    );
  }
});

test("turn replacement commit validation rejects a non-object and a foreign protocol version", () => {
  assert.deepEqual(validateTurnReplacementCommit(null).errors, ["commit_not_object"]);
  assert.deepEqual(validateTurnReplacementCommit(undefined).errors, ["commit_not_object"]);
  const commit = createTurnReplacementCommit(input());
  assert.ok(
    validateTurnReplacementCommit({ ...commit, protocolVersion: 2 }).errors.includes(
      "unsupported_protocol_version",
    ),
  );
  assert.ok(
    validateTurnReplacementCommit({ ...commit, eventType: "turn.other" }).errors.includes(
      "invalid_event_type",
    ),
  );
});
