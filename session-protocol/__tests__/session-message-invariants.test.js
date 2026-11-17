/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { createEmptyTurnLifecycle, validateSessionAggregateInvariants } from "../src/index.js";
import { sessionMessageInvariants } from "../src/aggregate/session-message-invariants.js";

function aggregate(messages) {
  return {
    sessionId: "session-1",
    parentSessionId: "",
    caller: "user",
    messages,
    dialogOrder: [],
    turnTimings: [],
    turnLifecycle: createEmptyTurnLifecycle(),
  };
}

test("immutable message validation reuse preserves aggregate uniqueness and error ordering", () => {
  const message = deepFreeze({
    messageUid: "assistant-1",
    role: "assistant",
    chatPresentation: true,
    turnScopeId: "turn-1",
    turnCommit: { action: "invalid" },
  });
  const first = sessionMessageInvariants(message);
  assert.equal(sessionMessageInvariants(message), first);
  assert.throws(() => first.errors.push("consumer mutation"), TypeError);
  const duplicate = deepFreeze({ ...message });
  const expected = [
    "invalid_turn_commit_metadata",
    "missing_canonical_presentation_message_id",
    "duplicate_message_uid",
    "invalid_turn_commit_metadata",
    "missing_canonical_presentation_message_id",
    "duplicate_canonical_assistant_presentation",
  ];
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(
      validateSessionAggregateInvariants(aggregate([message, duplicate])).errors,
      expected,
    );
    assert.deepEqual(
      validateSessionAggregateInvariants(aggregate(structuredClone([message, duplicate]))).errors,
      expected,
    );
  }
});

test("mutable, shallow-frozen and dynamic messages are validated after every change", () => {
  const message = Object.freeze({
    messageUid: "a",
    turnCommit: { action: "send", commandId: "c" },
  });
  assert.deepEqual(sessionMessageInvariants(message).errors, []);
  message.turnCommit.action = "invalid";
  assert.deepEqual(sessionMessageInvariants(message).errors, ["invalid_turn_commit_metadata"]);
  let uid = "a";
  const dynamic = deepFreeze({
    get messageUid() {
      return uid;
    },
  });
  assert.equal(sessionMessageInvariants(dynamic).messageUid, "a");
  uid = "b";
  assert.equal(sessionMessageInvariants(dynamic).messageUid, "b");
  const mutable = { messageUid: "a", role: "assistant", chatPresentation: false };
  assert.deepEqual(sessionMessageInvariants(mutable).errors, []);
  mutable.chatPresentation = true;
  assert.deepEqual(sessionMessageInvariants(mutable).errors, [
    "missing_canonical_presentation_turn_scope",
    "missing_canonical_presentation_message_id",
  ]);
});
