/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeUserMetaParsedResults,
  requireSessionChanges,
} from "@noobot/session-protocol/session-changes";

test("parsed results replace the entry for the same attachment", () => {
  const attachmentRef = "attachment:v1:s1/user/a1";
  const first = mergeUserMetaParsedResults(undefined, { sourceAttachmentRef: attachmentRef, v: 1 });
  const other = mergeUserMetaParsedResults(first, { sourceAttachmentRef: "attachment:b", v: 1 });
  const replaced = mergeUserMetaParsedResults(other, { sourceAttachmentRef: attachmentRef, v: 2 });
  assert.deepEqual(replaced, [
    { sourceAttachmentRef: "attachment:b", v: 1 },
    { sourceAttachmentRef: attachmentRef, v: 2 },
  ]);
  assert.throws(() => mergeUserMetaParsedResults([], { v: 1 }), /requires sourceAttachmentRef/);
  assert.throws(
    () => mergeUserMetaParsedResults([{}], { sourceAttachmentRef: attachmentRef }),
    /requires sourceAttachmentRef/,
  );
});

test("content append requires explicit identity, version and a nonempty fragment", () => {
  const append = {
    messageUid: "m",
    dialogProcessId: "d",
    turnScopeId: "t",
    expectedContentReference: "reference",
    owner: 1,
    content: "fragment",
  };
  assert.doesNotThrow(() =>
    requireSessionChanges({
      messageContentAppends: [append],
      messages: [{ messageUid: "other" }],
      turnTransition: {},
    }),
  );
  for (const invalid of [
    { ...append, content: "" },
    { ...append, content: null },
    { ...append, expectedContentReference: " ref" },
    { ...append, turnScopeId: "" },
    { ...append, revision: 1 },
  ])
    assert.throws(() => requireSessionChanges({ messageContentAppends: [invalid] }), TypeError);
  assert.throws(
    () => requireSessionChanges({ messageContentAppends: [append, append] }),
    /exactly one/,
  );
  assert.throws(
    () =>
      requireSessionChanges({ messageContentAppends: [append], messages: [{ messageUid: "m" }] }),
    /exactly one/,
  );
  assert.throws(
    () =>
      requireSessionChanges({
        messageContentAppends: [append],
        summaryCheckpoints: [{ messages: [{ messageUid: "m" }] }],
      }),
    /exactly one/,
  );
});

test("session delta keeps combined message, lifecycle, checkpoint and event changes atomic", () => {
  const changes = {
    messages: [],
    turnTransition: {},
    summaryCheckpoints: [],
    artifactEvents: [],
    sessionMetadata: {},
    scopedMetadata: {},
    timings: [],
    deliveries: [],
    outboxCursors: [],
    outboxMaintenance: {},
  };
  assert.equal(requireSessionChanges(changes), changes);
});

test("session delta rejects full state, aliases, unknown fields and malformed envelopes", () => {
  for (const changes of [
    null,
    [],
    {},
    { session: {} },
    { turnTransitions: [] },
    { outboxTurnRemoval: { turnScopeIds: ["t1"] } },
    { messages: [], outboxTurnRemoval: { turnScopeIds: ["t1"] } },
    { messages: [], unexpected: [] },
    { messages: {} },
    { turnTransition: [] },
    { summaryCheckpoints: null },
    { constructor: {} },
    { toString: [] },
  ])
    assert.throws(() => requireSessionChanges(changes), TypeError);
});

const deleteCommand = {
  commandId: "delete",
  anchor: { turnScopeId: "old" },
  expectedAggregateVersion: 1,
};
const replacement = {
  command: {
    ...deleteCommand,
    commandId: "replace",
    newContent: "hello",
    turnScopeId: "new",
    attachments: [],
  },
  identity: { dialogProcessId: "dialog", messageUid: "new-message", userMessageId: "user-message" },
};

for (const [operation, value] of Object.entries({
  attachmentBinding: {},
  messageDeletion: deleteCommand,
  turnReplacement: replacement,
})) {
  test(`${operation} is an independent operation regardless of field order`, () => {
    const changes = { [operation]: value };
    assert.equal(requireSessionChanges(changes), changes);
    assert.throws(() => requireSessionChanges({ [operation]: [] }), TypeError);
    for (const combined of [
      { ...changes, messages: [] },
      { messages: [], ...changes },
      { ...changes, sessionMetadata: {} },
    ])
      assert.throws(() => requireSessionChanges(combined), {
        code: "SESSION_COMMIT_INPUT_INVALID",
        message: /independent session operation/,
      });
  });
}

test("range commands reject malformed identities at the common commit boundary", () => {
  for (const changes of [
    { messageDeletion: {} },
    { messageDeletion: { ...deleteCommand, anchor: { turnScopeId: " old" } } },
    { turnReplacement: {} },
    { turnReplacement: { ...replacement, identity: { ...replacement.identity, messageUid: "" } } },
  ])
    assert.throws(() => requireSessionChanges(changes), { code: "SESSION_COMMIT_INPUT_INVALID" });
});

test("user meta delta requires an explicit source and rejects replacement content and combined operations", () => {
  const request = {
    messageUid: "source",
    result: { sourceAttachmentRef: "attach://source", summary: "parsed" },
  };
  const changes = { userMetaParsedResult: request };
  assert.equal(requireSessionChanges(changes), changes);
  for (const value of [
    {},
    { ...request, content: "replacement" },
    { ...request, messageUid: " source" },
    { ...request, result: null },
    { ...request, result: [] },
    { ...request, result: {} },
    { ...request, result: { sourceAttachmentRef: " " } },
    { ...request, result: { sourceAttachmentRef: 1 } },
  ])
    assert.throws(() => requireSessionChanges({ userMetaParsedResult: value }), {
      code: "SESSION_COMMIT_INPUT_INVALID",
    });
  for (const combined of [
    { ...changes, messages: [] },
    { messages: [], ...changes },
  ])
    assert.throws(() => requireSessionChanges(combined), /independent session operation/);
});
