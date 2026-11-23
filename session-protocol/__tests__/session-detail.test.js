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
  selectSessionDetailBlockingEntry,
} from "../src/index.js";
import { selectBranchDialogMessages } from "../src/aggregate/session-detail.js";

const INVALID = { code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID };

test("branch detail rejects conflicting parent and session claims", () => {
  const collect = (sessions) =>
    selectBranchDialogMessages({
      sessionId: "root-session",
      rootDialogProcessIds: ["root-dialog"],
      sessions,
    });
  const message = { dialogProcessId: "child-dialog", parentDialogProcessId: "root-dialog" };
  assert.throws(
    () =>
      collect([
        { sessionId: "child", messages: [message, { ...message, parentDialogProcessId: "other" }] },
      ]),
    INVALID,
  );
  assert.throws(
    () =>
      collect([
        { sessionId: "child", messages: [message] },
        { sessionId: "other-child", messages: [message] },
      ]),
    INVALID,
  );
  assert.throws(
    () =>
      collect([
        { sessionId: "child", messages: [{ ...message, parentDialogProcessId: "child-dialog" }] },
      ]),
    INVALID,
  );
});

const STATS = Object.freeze({
  messageCount: 4,
  displayMessageCount: 1,
  injectedMessageCount: 1,
  thinkingMessageCount: 0,
  toolLogCount: 2,
  displayToolLogCount: 0,
  unassignedToolArtifactCount: 0,
  conflictedToolArtifactCount: 0,
  attachmentCount: 0,
  hasToolDetails: true,
});

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
    generation: 9,
    turnTimings: [],
    turnLifecycleSnapshot: snapshot(sessionId),
    sessionArtifactEvents: [{ identity: { eventId: "artifact-1", sessionId } }],
    messages: [{ role: "user" }],
    stats: STATS,
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

test("detail entries require authoritative global statistics and cannot disguise a partial display", () => {
  const entry = availableEntry();
  assert.equal(entry.stats.messageCount, 4);
  assert.equal(entry.messages.length, 1);
  assert.deepEqual(collectSessionDetailEntryErrors(entry), []);
  const { stats: _stats, ...missing } = entry;
  assert.ok(collectSessionDetailEntryErrors(missing).includes("missing_stats"));
  for (const stats of [
    null,
    {},
    { ...STATS, messageCount: -1 },
    { ...STATS, hasToolDetails: false },
    { ...STATS, extra: 1 },
  ]) {
    assert.ok(
      collectSessionDetailEntryErrors(availableEntry({ stats })).includes("invalid_display_stats"),
    );
  }
  assert.ok(
    collectSessionDetailEntryErrors(availableEntry({ messages: [] })).includes(
      "display_message_count_mismatch",
    ),
  );
});
test("detail reports malformed rows independently of invalid global statistics", () => {
  const invalidStats = { ...STATS, hasToolDetails: false };
  for (const messages of [null, [null], Array(1)]) {
    assert.deepEqual(
      collectSessionDetailEntryErrors(availableEntry({ stats: invalidStats, messages })),
      ["invalid_messages", "invalid_display_stats"],
    );
  }
  assert.deepEqual(
    collectSessionDetailEntryErrors(availableEntry({ stats: invalidStats, messages: [] })),
    ["invalid_display_stats"],
  );
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

test("full detail is blocked by any unreadable branch entry and prioritizes the main failure", () => {
  const root = availableEntry();
  const child = unavailableEntry();
  const brokenRoot = unavailableEntry({ sessionId: root.sessionId, parentSessionId: "" });
  const detail = (sessions) => createSessionDetailDocument({ sessionId: root.sessionId, sessions });
  assert.equal(selectSessionDetailBlockingEntry(detail([root])), null);
  assert.equal(selectSessionDetailBlockingEntry(detail([root, child])), child);
  assert.equal(selectSessionDetailBlockingEntry(detail([child, brokenRoot])), brokenRoot);
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
