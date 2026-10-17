/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RECONNECT_CONTROL_ACTION,
  RECONNECT_CONTROL_PROTOCOL_VERSION,
  createReconnectControl,
  parseReconnectControl,
  readKnownLifecycleSequence,
  validateReconnectControl,
} from "../src/index.js";

function validControl(overrides = {}) {
  return {
    ...createReconnectControl({
      requestId: "reconnect-1",
      identity: { sessionId: "child-1", parentSessionId: "root-1", parentDialogProcessId: "dp-1" },
      knownLifecycleSequenceMap: { "child-1": 3 },
    }),
    ...overrides,
  };
}

test("reconnect control carries identity in a single identity object", () => {
  const control = createReconnectControl({
    requestId: "r-1",
    identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
    knownLifecycleSequenceMap: {},
  });
  assert.deepEqual(control, {
    action: RECONNECT_CONTROL_ACTION,
    protocolVersion: RECONNECT_CONTROL_PROTOCOL_VERSION,
    requestId: "r-1",
    identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
    knownLifecycleSequenceMap: {},
  });
  assert.equal(parseReconnectControl(control), control);
});

test("reconnect control allows an empty identity when no session is active", () => {
  const control = createReconnectControl({
    requestId: "r-1",
    identity: { sessionId: "", parentSessionId: "", parentDialogProcessId: "" },
    knownLifecycleSequenceMap: {},
  });
  assert.equal(validateReconnectControl(control).valid, true);
});

test("reconnect control builder rejects untrimmed or missing fields instead of normalizing", () => {
  const identity = { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" };
  for (const input of [
    { requestId: " r-1 ", identity, knownLifecycleSequenceMap: {} },
    { requestId: "r-1", identity: { sessionId: " s-1 " }, knownLifecycleSequenceMap: {} },
    { requestId: "r-1", knownLifecycleSequenceMap: {} },
    { requestId: "r-1", identity },
  ]) {
    assert.throws(
      () => createReconnectControl(input),
      (error) => error.code === "INVALID_RECONNECT_CONTROL",
    );
  }
});

test("reconnect control rejects removed flat identity and cursor fields", () => {
  for (const field of [
    "currentSessionId",
    "currentParentSessionId",
    "lastReceivedSeqMap",
    "userId",
  ]) {
    const { errors } = validateReconnectControl(validControl({ [field]: "x" }));
    assert.deepEqual(errors, [`unknown_field:${field}`]);
  }
});

test("reconnect control rejects malformed identity, version and request id", () => {
  assert.throws(
    () => parseReconnectControl(validControl({ protocolVersion: 2, requestId: "" })),
    (error) =>
      error.code === "INVALID_RECONNECT_CONTROL" &&
      error.errors.includes("unsupported_protocol_version") &&
      error.errors.includes("missing_request_id"),
  );
  const untrimmed = validControl({
    identity: { sessionId: " s ", parentSessionId: "", parentDialogProcessId: "" },
  });
  assert.deepEqual(validateReconnectControl(untrimmed).errors, [
    "invalid_identity_field:sessionId",
  ]);
  const orphanParent = validControl({
    identity: { sessionId: "", parentSessionId: "root-1", parentDialogProcessId: "" },
  });
  assert.deepEqual(validateReconnectControl(orphanParent).errors, [
    "parent_identity_requires_session_id",
  ]);
  const extraIdentity = validControl({
    identity: { ...validControl().identity, turnScopeId: "t" },
  });
  assert.deepEqual(validateReconnectControl(extraIdentity).errors, [
    "unknown_field:identity.turnScopeId",
  ]);
});

test("reconnect control requires positive integer known lifecycle sequences", () => {
  for (const sequence of [0, -1, 1.5, "3"]) {
    const control = validControl({ knownLifecycleSequenceMap: { "child-1": sequence } });
    assert.deepEqual(validateReconnectControl(control).errors, [
      "invalid_known_lifecycle_sequence:child-1",
    ]);
  }
  assert.deepEqual(
    validateReconnectControl(validControl({ knownLifecycleSequenceMap: null })).errors,
    ["known_lifecycle_sequence_map_not_object"],
  );
});

test("known lifecycle sequence is zero only for sessions absent from the map", () => {
  const control = validControl();
  assert.equal(readKnownLifecycleSequence(control, "child-1"), 3);
  assert.equal(readKnownLifecycleSequence(control, "other"), 0);
  assert.equal(readKnownLifecycleSequence(control, "toString"), 0);
});
