/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  SESSIONS_SUMMARY_SCHEMA_VERSION,
  collectSessionSummaryEntryErrors,
  compareSessionSummaries,
  createSessionUnavailableReason,
  createSessionsSummaryProjectionError,
  createUnavailableSessionSummary,
  isSessionsSummaryMembershipCurrent,
  isSessionsSummaryProjectionError,
  isSessionsSummarySchemaCurrent,
  requireSessionsSummaryPayload,
} from "../src/index.js";

function availableEntry(overrides = {}) {
  return {
    sessionId: "s-1",
    parentSessionId: "",
    caller: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    aggregateVersion: 3,
    title: "s-1",
    messageCount: 0,
    lastMessage: null,
    activeTurnScopeId: "",
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

function payload(sessions) {
  return {
    schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
    sessions,
    updatedAt: "2026-01-03T00:00:00.000Z",
  };
}

test("available and unavailable entries accept exactly their protocol fields", () => {
  assert.deepEqual(collectSessionSummaryEntryErrors(availableEntry()), []);
  assert.deepEqual(collectSessionSummaryEntryErrors(unavailableEntry()), []);
  assert.deepEqual(
    collectSessionSummaryEntryErrors(availableEntry({ activeTurnScopeId: "client-turn:1" })),
    [],
  );
});

test("unavailable entries carry no time, title or count facts", () => {
  const errors = collectSessionSummaryEntryErrors(
    unavailableEntry({ createdAt: "", updatedAt: "", title: "x", messageCount: 0 }),
  );
  assert.deepEqual(errors, [
    "unexpected_createdAt",
    "unexpected_updatedAt",
    "unexpected_title",
    "unexpected_messageCount",
  ]);
});

test("entries reject missing fields, retired fields and invalid values", () => {
  const { updatedAt: _omitted, ...withoutUpdatedAt } = availableEntry();
  assert.deepEqual(collectSessionSummaryEntryErrors(withoutUpdatedAt), [
    "missing_updatedAt",
    "invalid_updated_at",
  ]);
  assert.deepEqual(collectSessionSummaryEntryErrors(availableEntry({ currentTaskId: "" })), [
    "unexpected_currentTaskId",
  ]);
  assert.deepEqual(collectSessionSummaryEntryErrors(availableEntry({ caller: "system" })), [
    "invalid_caller",
  ]);
  assert.deepEqual(collectSessionSummaryEntryErrors(availableEntry({ messageCount: -1 })), [
    "invalid_message_count",
  ]);
  assert.deepEqual(
    collectSessionSummaryEntryErrors(availableEntry({ activeTurnScopeId: " client-turn:1" })),
    ["invalid_active_turn_scope_id"],
  );
  assert.deepEqual(
    collectSessionSummaryEntryErrors(unavailableEntry({ unavailableReason: { code: "" } })),
    ["invalid_unavailable_reason"],
  );
  assert.deepEqual(collectSessionSummaryEntryErrors(availableEntry({ availability: "x" })), [
    "invalid_availability",
  ]);
  assert.deepEqual(collectSessionSummaryEntryErrors(null), ["entry_not_object"]);
});

test("requireSessionsSummaryPayload enforces schema, entry shape and unique sessionIds", () => {
  const valid = payload([availableEntry(), unavailableEntry()]);
  assert.equal(requireSessionsSummaryPayload(valid), valid);
  assert.throws(
    () =>
      requireSessionsSummaryPayload({
        ...valid,
        schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION - 1,
      }),
    { code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_SCHEMA_UNSUPPORTED },
  );
  assert.throws(
    () => requireSessionsSummaryPayload(payload([availableEntry(), availableEntry()])),
    {
      code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_PAYLOAD_INVALID,
    },
  );
  assert.throws(() => requireSessionsSummaryPayload(payload([availableEntry({ title: "" })])), {
    code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_PAYLOAD_INVALID,
  });
  assert.throws(() => requireSessionsSummaryPayload({ ...valid, updatedAt: "" }), {
    code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_PAYLOAD_INVALID,
  });
});

test("membership is current only when entries equal the live sessionId set", () => {
  const current = payload([availableEntry(), unavailableEntry()]);
  assert.equal(isSessionsSummaryMembershipCurrent(current, ["s-2", "s-1"]), true);
  assert.equal(isSessionsSummaryMembershipCurrent(current, ["s-1"]), false);
  assert.equal(isSessionsSummaryMembershipCurrent(current, ["s-1", "s-2", "s-3"]), false);
  assert.equal(isSessionsSummaryMembershipCurrent(current, ["s-1", "s-3"]), false);
  assert.equal(isSessionsSummaryMembershipCurrent(payload([]), []), true);
});

test("schema is current only for an object carrying the current schemaVersion", () => {
  assert.equal(isSessionsSummarySchemaCurrent(payload([])), true);
  assert.equal(
    isSessionsSummarySchemaCurrent({
      ...payload([]),
      schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION - 1,
    }),
    false,
  );
  assert.equal(isSessionsSummarySchemaCurrent(null), false);
  assert.equal(isSessionsSummarySchemaCurrent([]), false);
});

test("projection failure keeps both the unavailable cause and the projection error", () => {
  const cause = Object.assign(new Error("manifest broken"), { code: "SESSION_PROTOCOL_INVALID" });
  const projectionError = new Error("disk full");
  const error = createSessionsSummaryProjectionError({
    sessionId: "s-1",
    cause,
    projectionError,
  });
  assert.equal(error.code, SESSION_ERROR_CODE.SESSIONS_SUMMARY_PROJECTION_FAILED);
  assert.equal(error.sessionId, "s-1");
  assert.equal(error.cause, cause);
  assert.deepEqual(error.errors, [projectionError]);
  assert.equal(isSessionsSummaryProjectionError(error), true);
  assert.equal(isSessionsSummaryProjectionError(cause), false);
  assert.throws(
    () => createSessionsSummaryProjectionError({ sessionId: "", cause, projectionError }),
    TypeError,
  );
});

test("unavailable reason comes only from a coded error", () => {
  const error = Object.assign(new Error("broken"), { code: "SESSION_PROTOCOL_INVALID" });
  assert.deepEqual(createSessionUnavailableReason(error), {
    code: "SESSION_PROTOCOL_INVALID",
    message: "broken",
  });
  const uncoded = new Error("raw");
  assert.throws(
    () => createSessionUnavailableReason(uncoded),
    (thrown) => thrown === uncoded,
  );
  assert.deepEqual(
    createUnavailableSessionSummary({
      sessionId: "s-2",
      parentSessionId: "",
      caller: "bot",
      error,
    }),
    {
      sessionId: "s-2",
      parentSessionId: "",
      caller: "bot",
      availability: "unavailable",
      unavailableReason: { code: "SESSION_PROTOCOL_INVALID", message: "broken" },
    },
  );
});

test("compareSessionSummaries orders available by updatedAt desc, then unavailable by sessionId", () => {
  const sorted = [
    unavailableEntry({ sessionId: "u-b" }),
    availableEntry({ sessionId: "a-old", updatedAt: "2026-01-01T00:00:00.000Z" }),
    unavailableEntry({ sessionId: "u-a" }),
    availableEntry({ sessionId: "a-new", updatedAt: "2026-02-01T00:00:00.000Z" }),
    availableEntry({ sessionId: "a-same", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ].sort(compareSessionSummaries);
  assert.deepEqual(
    sorted.map((entry) => entry.sessionId),
    ["a-new", "a-old", "a-same", "u-a", "u-b"],
  );
});
