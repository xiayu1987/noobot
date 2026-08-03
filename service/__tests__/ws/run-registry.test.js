/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachRunTransport,
  buildRunRegistryKeys,
  detachRunTransport,
  findActiveRun,
  isRunTransportAttached,
  publishRunEvent,
  registerActiveRun,
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

test("run transport rebound keeps the stable Run Handle and routes late events only to the current binding", async () => {
  const firstFrames = [];
  const reboundFrames = [];
  const diagnostics = [];
  const handle = registerActiveRun({
    userId: "owner-rebound",
    sessionId: "session-rebound",
    turnScopeId: "turn-rebound",
  });
  const stableRunHandleId = handle.runHandleId;
  const firstBinding = attachRunTransport(
    handle,
    async (event, data, context) => {
      firstFrames.push({ event, data, context });
      return true;
    },
    { onDiagnostic: (data) => diagnostics.push(data) },
  );
  const reboundBinding = attachRunTransport(
    handle,
    async (event, data, context) => {
      reboundFrames.push({ event, data, context });
      return true;
    },
    { onDiagnostic: (data) => diagnostics.push(data) },
  );

  assert.equal(handle.runHandleId, stableRunHandleId);
  assert.equal(isRunTransportAttached(handle, firstBinding), false);
  assert.equal(isRunTransportAttached(handle, reboundBinding), true);
  assert.equal(detachRunTransport(handle, firstBinding), false);
  assert.equal(await publishRunEvent(handle, "message_event", {
    event: {
      eventId: "event-after-rebound",
      eventType: "authoritative_final_content",
      messageId: "message-after-rebound",
      presentationMessageId: "presentation-after-rebound",
    },
  }), true);

  assert.equal(firstFrames.length, 0);
  assert.equal(reboundFrames.length, 1);
  assert.equal(reboundFrames[0].context.runHandleId, stableRunHandleId);
  assert.equal(reboundFrames[0].context.bindingId, reboundBinding.id);
  assert.deepEqual(diagnostics.map((item) => item.stage), ["publish_started", "publish_completed"]);
  assert.ok(diagnostics.every((item) => item.runHandleId === stableRunHandleId));
  assert.ok(diagnostics.every((item) => item.bindingId === reboundBinding.id));
  unregisterActiveRun(handle);
});

test("terminal unregister detaches the current transport and rejects late publication", async () => {
  const frames = [];
  const handle = registerActiveRun({
    userId: "owner-terminal",
    sessionId: "session-terminal",
    turnScopeId: "turn-terminal",
  });
  const binding = attachRunTransport(handle, async (...args) => {
    frames.push(args);
    return true;
  });
  assert.equal(isRunTransportAttached(handle, binding), true);

  unregisterActiveRun(handle);

  assert.equal(isRunTransportAttached(handle, binding), false);
  assert.equal(await publishRunEvent(handle, "message_event", {
    event: { eventId: "late-terminal-event" },
  }), false);
  assert.equal(frames.length, 0);
});
