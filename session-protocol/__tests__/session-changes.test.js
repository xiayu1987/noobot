/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requireSessionChanges } from "@noobot/session-protocol/session-changes";

test("content append requires explicit identity, version and a nonempty fragment", () => {
  const append = {
    messageUid: "m",
    dialogProcessId: "d",
    turnScopeId: "t",
    expectedContentReference: "reference",
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
    outboxTurnRemoval: {},
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
    { messages: [], unexpected: [] },
    { messages: {} },
    { turnTransition: [] },
    { summaryCheckpoints: null },
    { constructor: {} },
    { toString: [] },
  ])
    assert.throws(() => requireSessionChanges(changes), TypeError);
});

for (const operation of ["attachmentBinding", "messageDeletion", "turnReplacement"]) {
  test(`${operation} is an independent operation regardless of field order`, () => {
    const changes = { [operation]: {} };
    assert.equal(requireSessionChanges(changes), changes);
    assert.throws(() => requireSessionChanges({ [operation]: [] }), TypeError);
    for (const combined of [
      { ...changes, messages: [] },
      { messages: [], ...changes },
      { ...changes, sessionMetadata: {} },
    ])
      assert.throws(() => requireSessionChanges(combined), /independent session operation/);
  });
}

test("user meta delta requires an explicit source and rejects replacement content and combined operations", () => {
  const request = { messageUid: "source", result: { summary: "parsed" } };
  const changes = { userMetaParsedResult: request };
  assert.equal(requireSessionChanges(changes), changes);
  for (const value of [
    {},
    { ...request, content: "replacement" },
    { ...request, messageUid: " source" },
    { ...request, result: null },
    { ...request, result: [] },
  ])
    assert.throws(() => requireSessionChanges({ userMetaParsedResult: value }), TypeError);
  for (const combined of [
    { ...changes, messages: [] },
    { messages: [], ...changes },
  ])
    assert.throws(() => requireSessionChanges(combined), /independent session operation/);
});
