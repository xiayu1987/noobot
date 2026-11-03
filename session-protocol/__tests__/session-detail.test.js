/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  TURN_RECOVERY_ACTION,
  collectSessionDetailEntryErrors,
  createAvailableSessionDetailEntry,
  createMissingSessionDetailDocument,
  createSessionDetailDocument,
  createTurnLifecycleSnapshot,
  isAvailableSessionDetailEntry,
  requireSessionDetailDocument,
  requireSessionContentProjection,
  selectSessionContentMessages,
  selectMainSessionDetailEntry,
} from "../src/index.js";

const INVALID = { code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID };

test("partial content projection preserves references and distinguishes omitted messages", () => {
  const partial = Object.freeze({ sessionId: "s-1", title: "updated" });
  assert.equal(requireSessionContentProjection(partial), partial);
  assert.deepEqual(selectSessionContentMessages(partial), []);
  assert.equal(Object.hasOwn(partial, "messages"), false);
  const messages = Object.freeze([Object.freeze({ role: "user" })]);
  const content = Object.freeze({ sessionId: "s-1", messages });
  assert.equal(requireSessionContentProjection(content), content);
  assert.equal(selectSessionContentMessages(content), messages);
});

test("content projection rejects malformed containers and explicit invalid messages", () => {
  for (const value of [null, undefined, [], "", 1, false]) {
    assert.throws(() => requireSessionContentProjection(value), INVALID);
    assert.throws(() => selectSessionContentMessages(value), INVALID);
  }
  for (const messages of [null, undefined, {}, "", [null], [[]], ["message"]]) {
    assert.throws(() => selectSessionContentMessages({ messages }), INVALID);
  }
});

test("content projection rejects retired summary and timing ownership even when undefined", () => {
  for (const field of ["sessionSummary", "turnTimings"]) {
    for (const value of [undefined, null, [], {}]) {
      assert.throws(() => requireSessionContentProjection({ [field]: value }), INVALID);
    }
  }
});

function snapshot(sessionId) {
  return createTurnLifecycleSnapshot({
    commandId: `snapshot-${sessionId}`,
    sessionId,
    sequence: 0,
    activeTurnScopeId: "",
    activeTurn: null,
    recentTerminalTurns: [],
    replacedTurns: [],
    unchanged: false,
    recovery: TURN_RECOVERY_ACTION.NONE,
    generatedAt: "2026-01-02T00:00:00.000Z",
  });
}

function availableEntry(overrides = {}) {
  const sessionId = overrides.sessionId ?? "s-1";
  return {
    sessionId,
    parentSessionId: "",
    caller: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    title: sessionId,
    aggregateVersion: 3,
    turnTimings: [],
    turnLifecycleSnapshot: snapshot(sessionId),
    sessionArtifactEvents: [{ identity: { eventId: "artifact-1", sessionId } }],
    messages: [{ role: "user" }],
    availability: "available",
    ...overrides,
  };
}

function unavailableEntry(overrides = {}) {
  return {
    sessionId: "s-2",
    parentSessionId: "s-1",
    caller: "bot",
    availability: "unavailable",
    unavailableReason: { code: "SESSION_ARTIFACT_NOT_FOUND", message: "missing" },
    ...overrides,
  };
}

test("available and unavailable detail entries accept exactly their protocol fields", () => {
  assert.deepEqual(collectSessionDetailEntryErrors(availableEntry()), []);
  assert.deepEqual(collectSessionDetailEntryErrors(unavailableEntry()), []);
  assert.ok(
    collectSessionDetailEntryErrors(availableEntry({ depth: 0 })).includes("unexpected_depth"),
  );
  const { messages: _messages, ...withoutMessages } = availableEntry();
  assert.ok(collectSessionDetailEntryErrors(withoutMessages).includes("missing_messages"));
  assert.notDeepEqual(collectSessionDetailEntryErrors(unavailableEntry({ messages: [] })), []);
  assert.deepEqual(collectSessionDetailEntryErrors(availableEntry({ availability: "" })), [
    "invalid_availability",
  ]);
});

test("available detail entry is projected from the display summary without extra fields", () => {
  const { availability: _availability, ...display } = availableEntry();
  const entry = createAvailableSessionDetailEntry({ ...display });
  assert.equal(isAvailableSessionDetailEntry(entry), true);
  assert.deepEqual(entry, availableEntry());
  assert.throws(() => createAvailableSessionDetailEntry(null), INVALID);
});

test("detail entry rejects snapshot and artifact events owned by another session", () => {
  assert.deepEqual(
    collectSessionDetailEntryErrors(availableEntry({ turnLifecycleSnapshot: snapshot("s-other") })),
    ["snapshot_lifecycle_session_mismatch"],
  );
  assert.ok(
    collectSessionDetailEntryErrors(
      availableEntry({ sessionArtifactEvents: [{ identity: { sessionId: "s-other" } }] }),
    ).includes("invalid_session_artifact_events"),
  );
});

test("detail entry reports invalid turn timings with the timing protocol reason", () => {
  const errors = collectSessionDetailEntryErrors(
    availableEntry({ turnTimings: [{ turnScopeId: "turn-1" }] }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^invalid_turn_timing_0:turn timing dialogProcessId required/);
  assert.ok(
    collectSessionDetailEntryErrors(availableEntry({ turnTimings: null })).includes(
      "invalid_turn_timings",
    ),
  );
});

test("detail document requires a single main entry and unique entries", () => {
  const document = createSessionDetailDocument({
    sessionId: "s-1",
    sessions: [availableEntry(), unavailableEntry()],
  });
  assert.equal(selectMainSessionDetailEntry(document).sessionId, "s-1");
  assert.throws(
    () => createSessionDetailDocument({ sessionId: "s-1", sessions: [unavailableEntry()] }),
    INVALID,
  );
  assert.throws(
    () =>
      createSessionDetailDocument({
        sessionId: "s-1",
        sessions: [availableEntry(), availableEntry()],
      }),
    INVALID,
  );
});

test("missing detail document carries no entries and has no main entry", () => {
  const document = createMissingSessionDetailDocument({ sessionId: "s-1" });
  assert.deepEqual(document, { exists: false, sessionId: "s-1", sessions: [] });
  assert.throws(() => selectMainSessionDetailEntry(document), INVALID);
  assert.throws(
    () =>
      requireSessionDetailDocument({
        exists: false,
        sessionId: "s-1",
        sessions: [availableEntry()],
      }),
    INVALID,
  );
});

test("detail document accepts exactly its protocol fields", () => {
  const base = { exists: true, sessionId: "s-1", sessions: [availableEntry()] };
  assert.throws(() => requireSessionDetailDocument({ ...base, mode: "summary" }), INVALID);
  assert.throws(() => requireSessionDetailDocument({ ...base, exists: "true" }), INVALID);
  assert.throws(() => requireSessionDetailDocument({ ...base, sessionId: " s-1" }), INVALID);
  assert.throws(() => requireSessionDetailDocument(null), INVALID);
});
