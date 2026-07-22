/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRunRegistryKeys,
  consumePendingStop,
  findActiveRun,
  registerActiveRun,
  rememberPendingStop,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";

test("run-registry scopes every identity key to the canonical owner", () => {
  const keys = buildRunRegistryKeys({
    userId: "owner-a",
    sessionId: "session-owner-scope",
    turnScopeId: "turn-owner-scope",
    dialogProcessId: "dialog-owner-scope",
  });
  assert.ok(keys.length >= 3);
  assert.ok(keys.every((key) => key.startsWith("user:owner-a:")));
});

test("run-registry finds a run only for the same canonical owner", () => {
  const handle = registerActiveRun({
    userId: "owner-a",
    sessionId: "session-active-owner",
    turnScopeId: "turn-active-owner",
    dialogProcessId: "dialog-active-owner",
  });
  try {
    assert.equal(findActiveRun({ userId: "owner-a", sessionId: handle.sessionId, turnScopeId: handle.turnScopeId }), handle);
    assert.equal(findActiveRun({ userId: "owner-b", sessionId: handle.sessionId, turnScopeId: handle.turnScopeId }), null);
    assert.equal(findActiveRun({ sessionId: handle.sessionId, turnScopeId: handle.turnScopeId }), null);
  } finally {
    unregisterActiveRun(handle);
  }
});

test("run-registry pending stops are consumed only by the same canonical owner", () => {
  const identity = {
    userId: "owner-pending-a",
    sessionId: "session-pending-owner",
    turnScopeId: "turn-pending-owner",
  };
  rememberPendingStop(identity, { marker: "owned-stop" });
  assert.equal(consumePendingStop({ ...identity, userId: "owner-pending-b" }), null);
  assert.deepEqual(consumePendingStop(identity), { marker: "owned-stop" });
  assert.equal(consumePendingStop(identity), null);
});
