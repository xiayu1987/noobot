/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createReconnectComplete,
  createReconnectControl,
  createReconnectData,
  parseReconnectComplete,
  parseReconnectData,
  validateReconnectComplete,
  validateReconnectData,
} from "../src/index.js";

const control = createReconnectControl({
  requestId: "reconnect-1",
  identity: { sessionId: "child-1", parentSessionId: "root-1", parentDialogProcessId: "dp-1" },
  knownLifecycleSequenceMap: {},
});
const session = { sessionId: "child-1", replayBatch: { events: [] } };

test("reconnect data echoes request identity and carries sessions", () => {
  assert.deepEqual(createReconnectData(control, [session]), {
    requestId: "reconnect-1",
    identity: control.identity,
    sessions: [session],
  });
});

test("reconnect complete counts sessions", () => {
  assert.deepEqual(createReconnectComplete(control, [session, session]), {
    requestId: "reconnect-1",
    totalSessions: 2,
  });
  assert.deepEqual(createReconnectComplete(control, []).totalSessions, 0);
});

test("reconnect data rejects flat identity and unknown keys", () => {
  const data = createReconnectData(control, []);
  const { identity, ...withoutIdentity } = data;
  assert.equal(identity.sessionId, "child-1");
  assert.deepEqual(
    validateReconnectData({ ...withoutIdentity, currentSessionId: "child-1" }).errors,
    ["unknown_field:currentSessionId", "identity_not_object"],
  );
  for (const key of ["cacheExpired", "expiredDialogProcessIds", "suggestion"]) {
    assert.deepEqual(validateReconnectData({ ...data, [key]: true }).errors, [
      `unknown_field:${key}`,
    ]);
  }
});

test("reconnect data requires request id and sessions array", () => {
  assert.deepEqual(
    validateReconnectData({ ...createReconnectData(control, []), requestId: "" }).errors,
    ["missing_request_id"],
  );
  assert.deepEqual(
    validateReconnectData({ ...createReconnectData(control, []), sessions: undefined }).errors,
    ["sessions_not_array"],
  );
  assert.deepEqual(validateReconnectData(null).errors, ["reconnect_data_not_object"]);
});

test("reconnect data session entries are strict", () => {
  const data = createReconnectData(control, []);
  assert.deepEqual(validateReconnectData({ ...data, sessions: [null] }).errors, [
    "session_not_object:0",
  ]);
  assert.deepEqual(
    validateReconnectData({ ...data, sessions: [{ ...session, dialogProcesses: [] }] }).errors,
    ["unknown_field:sessions.0.dialogProcesses"],
  );
  assert.deepEqual(
    validateReconnectData({ ...data, sessions: [{ ...session, sessionId: " child-1" }] }).errors,
    ["invalid_session_id:0"],
  );
  assert.deepEqual(
    validateReconnectData({ ...data, sessions: [{ sessionId: "child-1" }] }).errors,
    ["replay_batch_not_object:0"],
  );
  assert.throws(() => parseReconnectData({ ...data, sessions: [{}] }), {
    code: "INVALID_RECONNECT_CONTROL",
  });
});

test("reconnect complete requires request id and non-negative integer total", () => {
  const complete = createReconnectComplete(control, []);
  for (const totalSessions of [-1, 1.5, "1", undefined]) {
    assert.deepEqual(validateReconnectComplete({ ...complete, totalSessions }).errors, [
      "invalid_total_sessions",
    ]);
  }
  assert.deepEqual(validateReconnectComplete({ ...complete, sessions: [] }).errors, [
    "unknown_field:sessions",
  ]);
  assert.throws(() => parseReconnectComplete({ totalSessions: 0 }), {
    code: "INVALID_RECONNECT_CONTROL",
  });
});
