/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionEventListener } from "../../src/events/execution-listener.js";

test("execution listener forwards the authoritative persistence scope and its delivery barrier", async () => {
  const persisted = [];
  const forwarded = [];
  const persistenceScope = {
    scopeId: "agent:child-turn",
    parentSessionId: "parent-session",
    relativeDir: "runtime/workflow/session/parent-session/child-turn",
    allowedRoot: "runtime/workflow/session",
  };
  const delivered = { dispatched: true, delivered: 1 };
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async (record) => persisted.push(record),
    },
    userId: "user-a",
    sessionId: "child-session",
    parentSessionId: "parent-session",
    turnScopeId: "child-turn",
    upstream: {
      dialogProcessId: "child-dialog",
      onEvent: async (event) => {
        forwarded.push(event);
        return delivered;
      },
    },
  });

  const result = await listener.onEvent({
    event: "turn_lifecycle_committed",
    ts: "2026-07-30T13:17:24.634Z",
    data: {
      envelope: { eventType: "turn.completed", revision: 4, persistenceScope },
    },
  });

  assert.equal(persisted.length, 0);
  assert.equal(result, delivered);
  assert.equal(forwarded.length, 1);
  assert.deepEqual(forwarded[0].data.envelope, {
    eventType: "turn.completed",
    revision: 4,
    persistenceScope,
  });
  assert.equal(forwarded[0].data.sessionId, "child-session");
  assert.equal(forwarded[0].data.parentSessionId, "parent-session");
  assert.equal(forwarded[0].data.turnScopeId, "child-turn");
  assert.equal(forwarded[0].data.dialogProcessId, "child-dialog");
});

test("execution listener persists events in source order and exposes a durability barrier", async () => {
  const calls = [];
  let releaseFirst;
  let markFirstStarted;
  const firstPersisted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async (record) => {
        calls.push(record.data.sequence);
        if (record.data.sequence === 4) {
          markFirstStarted();
          await firstPersisted;
        }
      },
    },
    userId: "user-a",
    sessionId: "session-a",
  });

  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "memory", revision: 4, sequence: 4 },
  });
  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "completed", revision: 5, sequence: 5 },
  });

  await firstStarted;
  assert.deepEqual(calls, [4]);
  releaseFirst();
  await listener.flushPersistence();
  assert.deepEqual(calls, [4, 5]);
});

test("execution listener classifies context identity diagnostics under one protocol category", async () => {
  const persisted = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async (record) => persisted.push(record),
    },
    userId: "user-a",
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: { dialogProcessId: "dialog-a", onEvent: async () => true },
  });

  await listener.onEvent({
    event: "agent.contextIdentity.modelContextCreated",
    data: {
      debugType: "context-identity",
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      sourceMessageUid: "sm_1",
    },
  });
  await listener.flushPersistence();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].category, "context_identity");
  assert.equal(persisted[0].type, "context_identity_debug");
  assert.equal(persisted[0].data.debugType, "context-identity");
  assert.equal(persisted[0].data.sourceMessageUid, "sm_1");
});

test("execution listener exposes rejected asynchronous upstream delivery at the final barrier", async () => {
  const listener = createExecutionEventListener({
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: {
      onEvent: async () => false,
    },
  });

  const delivered = await listener.onEvent({
    event: "authoritative_final_content",
    data: {
      eventId: "event-final",
      eventType: "authoritative_final_content",
      messageId: "message-final",
      presentationMessageId: "presentation-final",
      text: "complete body",
    },
  });

  assert.equal(delivered, false);
  await assert.rejects(
    listener.flushDelivery(),
    (error) => error?.code === "EVENT_UPSTREAM_DELIVERY_FAILED" &&
      error?.failures?.[0]?.eventId === "event-final",
  );
});
