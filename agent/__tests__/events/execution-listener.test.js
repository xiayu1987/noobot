/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  ATTACHMENT_RELATION_TYPE,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";

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

  await listener.flushPersistence();
  assert.equal(persisted.length, 1);
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

test("execution listener exposes persistence failures at the durability barrier", async () => {
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async () => {
        throw new Error("storage unavailable");
      },
    },
    userId: "user-a",
    sessionId: "session-a",
  });

  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "processing", revision: 1, sequence: 1 },
  });

  await assert.rejects(listener.flushPersistence(), {
    code: "EXECUTION_LOG_PERSISTENCE_FAILED",
    message: "execution log persistence failed: storage unavailable",
  });
});

test("execution listener forwarding port delivers without taking persistence ownership", async () => {
  const persisted = [];
  const forwarded = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async (record) => persisted.push(record),
    },
    userId: "user-a",
    sessionId: "parent-session",
    upstream: {
      onEvent: async (event) => forwarded.push(event),
    },
  });

  await listener.forwardEvent({
    event: "model_context_trace",
    data: { sessionId: "child-session", invocationId: "invoke-1" },
  });
  await listener.flushPersistence();

  assert.equal(persisted.length, 0);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].data.sessionId, "child-session");
  assert.equal(forwarded[0].data.invocationId, "invoke-1");
});

test("execution listener keeps strict attachment lifecycle payloads unchanged upstream", async () => {
  let forwarded;
  const listener = createExecutionEventListener({
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: {
      dialogProcessId: "dialog-a",
      onEvent: async (event) => {
        forwarded = event;
        return true;
      },
    },
  });
  const identity = {
    attachmentId: "source-a",
    sessionId: "session-a",
    attachmentSource: "user",
  };
  const lifecycle = createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    messageId: "attachment-event-a",
    identity,
    status: ATTACHMENT_LIFECYCLE.PARSED,
    occurredAt: "2026-08-16T00:00:00.000Z",
    turnScopeId: "turn-a",
    relation: {
      relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
      sourceIdentity: identity,
      targetIdentity: {
        attachmentId: "parsed-a",
        sessionId: "session-a",
        attachmentSource: "model",
      },
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  });

  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
    identity: {
      eventId: "attachment-authority-event-a",
      eventType: "attachment_lifecycle",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      messageId: lifecycle.messageId,
    },
    ordering: { domain: "attachment-lifecycle", scopeId: "source-a:session-a:user", sequence: 1 },
    producer: { type: "tool", id: "multimodal_parse" },
    occurredAt: lifecycle.occurredAt,
    payload: lifecycle,
  });
  await listener.onEvent({ event: "authority_event_committed", data: { envelope } });

  assert.equal(forwarded.event, "authority_event_committed");
  assert.deepEqual(forwarded.data.envelope, envelope);
  assert.deepEqual(forwarded.data.envelope.payload, lifecycle);
});

test("execution listener persists the canonical message fact instead of the private commit callback", async () => {
  const persisted = [];
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    userId: "user-a",
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: { dialogProcessId: "dialog-a", onEvent: async () => true },
  });
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "tool-event-a",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      messageId: "message-a",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "message-a", sequence: 1 },
    producer: { type: "agent", id: "message-runtime" },
    occurredAt: "2026-08-16T00:00:00.000Z",
    payload: {
      eventType: "tool_call_start",
      presentationMessageId: "presentation-a",
      tool: "read_file",
      toolCallId: "call-a",
    },
  });

  await listener.onEvent({ event: "authority_event_committed", data: { envelope } });
  await listener.flushPersistence();

  assert.equal(persisted[0].event, "tool_call_start");
  assert.equal(persisted[0].data.tool, "read_file");
  assert.equal(persisted[0].data.eventId, "tool-event-a");
  assert.equal(persisted[0].data.sequence, 1);
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
  assert.equal(persisted[0].userId, "user-a");
  assert.equal(persisted[0].sessionId, "session-a");
  assert.equal(persisted[0].dialogProcessId, "dialog-a");
  assert.equal(persisted[0].turnScopeId, "turn-a");
  assert.equal(persisted[0].data.sessionId, persisted[0].sessionId);
  assert.equal(persisted[0].data.dialogProcessId, persisted[0].dialogProcessId);
  assert.equal(persisted[0].data.turnScopeId, persisted[0].turnScopeId);
  assert.equal(persisted[0].category, "context_identity");
  assert.equal(persisted[0].type, "context_identity_debug");
  assert.equal(persisted[0].data.debugType, "context-identity");
  assert.equal(persisted[0].data.sourceMessageUid, "sm_1");
});

test("execution listener classifies agent context diagnostics under the dedicated debug category", async () => {
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
    event: "agent.context.executionScopeCreated",
    data: {
      debugType: "agent-context",
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      envelope: { protocolVersion: 1 },
    },
  });
  await listener.flushPersistence();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].category, "agent_context");
  assert.equal(persisted[0].type, "agent_context_debug");
  assert.equal(persisted[0].data.debugType, "agent-context");
});

test("execution listener exposes rejected asynchronous upstream delivery at the final barrier", async () => {
  const listener = createExecutionEventListener({
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: {
      onEvent: async () => false,
    },
  });

  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "event-final",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      messageId: "message-final",
    },
    ordering: { domain: "message-event", scopeId: "message-final", sequence: 1 },
    producer: { type: "agent", id: "test-agent" },
    occurredAt: "2026-08-16T00:00:00.000Z",
    payload: {
      eventType: "authoritative_final_content",
      presentationMessageId: "presentation-final",
      text: "complete body",
    },
  });
  const delivered = await listener.onEvent({
    event: "authority_event_committed",
    data: { envelope },
  });

  assert.equal(delivered, false);
  await assert.rejects(
    listener.flushDelivery(),
    (error) =>
      error?.code === "EVENT_UPSTREAM_DELIVERY_FAILED" &&
      error?.failures?.[0]?.eventId === "event-final" &&
      error?.failures?.[0]?.sourceEvent === "authority_event_committed",
  );
});
