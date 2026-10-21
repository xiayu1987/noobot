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
    relativeDir: "runtime/plugin-data/workflow/session/parent-session/child-turn",
    allowedRoot: "runtime/plugin-data/workflow/session",
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
    dialogProcessId: "child-dialog",
    upstream: {
      onEvent: async (event) => {
        forwarded.push(event);
        return delivered;
      },
    },
    persistenceScope: null,
  });

  const result = await listener.onEvent({
    event: "turn_lifecycle_committed",
    ts: "2026-07-30T13:17:24.634Z",
    data: {
      envelope: { eventType: "turn.completed", revision: 4, persistenceScope },
    },
  });

  await listener.flush();
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
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
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
  await listener.flush();
  assert.deepEqual(calls, [4, 5]);
});

test("execution listener keeps completion behind the persistence durability barrier", async () => {
  let releasePersistence;
  let persistenceStarted;
  const persistenceBlocked = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const started = new Promise((resolve) => {
    persistenceStarted = resolve;
  });
  const listener = createExecutionEventListener({
    sessionManager: {
      appendExecutionLog: async () => {
        persistenceStarted();
        await persistenceBlocked;
      },
    },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });

  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "completed", sequence: 1 },
  });
  await started;
  let completed = false;
  const completion = listener.flush().then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  releasePersistence();
  await completion;
  assert.equal(completed, true);
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
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });

  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "processing", revision: 1, sequence: 1 },
  });

  await assert.rejects(listener.flush(), {
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
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });

  await listener.forwardEvent({
    event: "model_context_trace",
    data: { sessionId: "spoofed-session", invocationId: "invoke-1" },
    route: {
      userId: "user-a",
      sessionId: "child-session",
      parentSessionId: "parent-session",
      turnScopeId: "",
      dialogProcessId: "child-dialog",
    },
  });
  await listener.onEvent({ event: "turn_lifecycle_committed", data: { sessionId: "spoofed" } });
  await listener.flush();

  assert.deepEqual(
    persisted.map((record) => record.sessionId),
    ["parent-session"],
  );
  assert.equal(forwarded.length, 2);
  assert.equal(forwarded[0].data.sessionId, "child-session");
  assert.equal(forwarded[0].data.dialogProcessId, "child-dialog");
  assert.equal(forwarded[0].data.invocationId, "invoke-1");
  assert.equal(forwarded[1].data.sessionId, "parent-session");
});

test("execution listener forwarding port rejects events without a route identity", () => {
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async () => {} },
    upstream: { onEvent: async () => true },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  assert.throws(
    () => listener.forwardEvent({ event: "model_context_trace", data: {} }),
    /execution route identity must be an object/,
  );
});

test("execution listener keeps strict attachment lifecycle payloads unchanged upstream", async () => {
  let forwarded;
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async () => {} },
    sessionId: "session-a",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
    upstream: {
      onEvent: async (event) => {
        forwarded = event;
        return true;
      },
    },
    userId: "user-a",
    parentSessionId: "",
    persistenceScope: null,
  });
  const identity = {
    attachmentId: "source-a",
    sessionId: "session-a",
    attachmentSource: "user",
  };
  const lifecycle = createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    attachmentEventId: "attachment-event-a",
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
    dialogProcessId: "dialog-a",
    upstream: { onEvent: async () => true },
    parentSessionId: "",
    persistenceScope: null,
  });
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "tool-event-a",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "presentation-a", sequence: 1 },
    producer: { type: "agent", id: "message-runtime" },
    occurredAt: "2026-08-16T00:00:00.000Z",
    payload: {
      eventType: "tool_call_start",
      presentationMessageId: "presentation-a",
      dialogProcessId: "dialog-a",
      tool: "read_file",
      toolCallId: "call-a",
    },
  });

  await listener.onEvent({ event: "authority_event_committed", data: { envelope } });
  await listener.flush();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].event, "tool_call_start");
  assert.equal(persisted[0].data.tool, "read_file");
  assert.equal(persisted[0].data.eventId, "tool-event-a");
  assert.equal(persisted[0].data.sequence, 1);
});

test("execution listener forwards transient message events without persisting them", async () => {
  const persisted = [];
  const forwarded = [];
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    userId: "user-a",
    sessionId: "session-a",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
    upstream: {
      onEvent: async (event) => {
        forwarded.push(event);
        return true;
      },
    },
    parentSessionId: "",
    persistenceScope: null,
  });
  const messageEnvelope = (eventId, sequence, payload) =>
    createEventEnvelope({
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      identity: {
        eventId,
        eventType: "message_event",
        sessionId: "session-a",
        turnScopeId: "turn-a",
      },
      causality: {},
      ordering: { domain: "message-event", scopeId: "presentation-a", sequence },
      producer: { type: "agent", id: "message-runtime" },
      occurredAt: "2026-08-16T00:00:00.000Z",
      payload: { presentationMessageId: "presentation-a", dialogProcessId: "dialog-a", ...payload },
    });
  const transientEnvelopes = [
    messageEnvelope("delta-a", 0, { eventType: "llm_delta", text: "he" }),
    messageEnvelope("activity-delta-a", 0, {
      eventType: "activity_delta",
      text: "plan",
      activityId: "activity-a",
      activityKind: "analysis",
      activityEventType: "thinking",
    }),
  ];
  const durable = messageEnvelope("tool-event-a", 1, {
    eventType: "tool_call_start",
    tool: "read_file",
    toolCallId: "call-a",
  });

  for (const envelope of [...transientEnvelopes, durable]) {
    await listener.onEvent({ event: "authority_event_committed", data: { envelope } });
  }
  await listener.flush();

  assert.deepEqual(
    forwarded.map((event) => event.data.envelope.identity.eventId),
    ["delta-a", "activity-delta-a", "tool-event-a"],
  );
  assert.deepEqual(
    persisted.map((record) => record.data.eventId),
    ["tool-event-a"],
  );
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
    dialogProcessId: "dialog-a",
    upstream: { onEvent: async () => true },
    parentSessionId: "",
    persistenceScope: null,
  });

  await listener.onEvent({
    event: "agent.contextIdentity.modelContextCreated",
    data: {
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      sourceMessageUid: "sm_1",
    },
  });
  await listener.flush();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].userId, "user-a");
  assert.equal(persisted[0].sessionId, "session-a");
  assert.equal(persisted[0].dialogProcessId, "dialog-a");
  assert.equal(persisted[0].turnScopeId, "turn-a");
  assert.equal("sessionId" in persisted[0].data, false);
  assert.equal("dialogProcessId" in persisted[0].data, false);
  assert.equal("turnScopeId" in persisted[0].data, false);
  assert.equal(persisted[0].category, "context_identity");
  assert.equal(persisted[0].type, "context_identity_debug");
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
    dialogProcessId: "dialog-a",
    upstream: { onEvent: async () => true },
    parentSessionId: "",
    persistenceScope: null,
  });

  await listener.onEvent({
    event: "agent.context.executionScopeCreated",
    data: {
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      envelope: { protocolVersion: 1 },
    },
  });
  await listener.flush();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].category, "agent_context");
  assert.equal(persisted[0].type, "agent_context_debug");
});

test("execution listener rejects committed authority events that violate the protocol", () => {
  const persisted = [];
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: { onEvent: async () => true },
    userId: "user-a",
    parentSessionId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "event-invalid",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    },
    ordering: { domain: "message-event", scopeId: "presentation-invalid", sequence: 1 },
    producer: { type: "agent", id: "test-agent" },
    occurredAt: "2026-08-16T00:00:00.000Z",
    payload: {
      eventType: "authoritative_final_content",
      presentationMessageId: "presentation-invalid",
      text: "body",
    },
  });

  assert.throws(
    () => listener.onEvent({ event: "authority_event_committed", data: { envelope } }),
    /invalid committed authority event: missing_dialog_process_id/,
  );
  assert.equal(persisted.length, 0);
});

test("execution listener exposes rejected asynchronous upstream delivery at the final barrier", async () => {
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async () => {} },
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: {
      onEvent: async () => false,
    },
    userId: "user-a",
    parentSessionId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });

  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "event-final",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    },
    ordering: { domain: "message-event", scopeId: "presentation-final", sequence: 1 },
    producer: { type: "agent", id: "test-agent" },
    occurredAt: "2026-08-16T00:00:00.000Z",
    payload: {
      eventType: "authoritative_final_content",
      presentationMessageId: "presentation-final",
      dialogProcessId: "dialog-final",
      text: "complete body",
    },
  });
  const delivered = await listener.onEvent({
    event: "authority_event_committed",
    data: { envelope },
  });

  assert.equal(delivered, false);
  await assert.rejects(
    listener.flush(),
    (error) =>
      error?.code === "EVENT_UPSTREAM_DELIVERY_FAILED" &&
      error?.failures?.[0]?.eventId === "event-final" &&
      error?.failures?.[0]?.sourceEvent === "authority_event_committed",
  );
});

test("execution listener drains delivery failure diagnostics before rejecting flush", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const persisted = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (record.event === "execution_upstream_forward_failed") {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        persisted.push(record);
      },
    },
    upstream: { onEvent: async () => false },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  listener.forwardEvent({
    event: "authority_event_committed",
    data: {
      envelope: {
        identity: { eventId: "failed-delivery" },
      },
    },
    route: {
      userId: "user-a",
      sessionId: "session-a",
      parentSessionId: "",
      turnScopeId: "",
      dialogProcessId: "dialog-a",
    },
  });
  let settled = false;
  const completion = assert
    .rejects(listener.flush(), { code: "EVENT_UPSTREAM_DELIVERY_FAILED" })
    .then(() => {
      settled = true;
    });
  await writeStarted.promise;
  assert.equal(settled, false);
  releaseWrite.resolve();
  await completion;
  assert.deepEqual(
    persisted.map((record) => record.event),
    ["execution_upstream_forward_failed"],
  );
});

test("execution listener reports delivery and persistence failures together", async () => {
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog() {
        throw new Error("disk unavailable");
      },
    },
    upstream: { onEvent: async () => false },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  listener.onEvent({ event: "agent_lifecycle_state_changed", data: { state: "completed" } });
  await assert.rejects(listener.flush(), (error) => {
    assert.equal(error.code, "EXECUTION_EVENT_FLUSH_FAILED");
    assert.deepEqual(
      error.errors.map((failure) => failure.code),
      ["EVENT_UPSTREAM_DELIVERY_FAILED", "EXECUTION_LOG_PERSISTENCE_FAILED"],
    );
    return true;
  });
});

test("execution listener includes events enqueued during a flush", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const persisted = [];
  const forwarded = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (record.data.sequence === 1) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        persisted.push(record.data.sequence);
      },
    },
    upstream: { onEvent: async ({ data }) => forwarded.push(data.sequence) },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  listener.onEvent({ event: "agent_lifecycle_state_changed", data: { sequence: 1 } });
  const completion = listener.flush();
  await writeStarted.promise;
  listener.onEvent({ event: "agent_lifecycle_state_changed", data: { sequence: 2 } });
  releaseWrite.resolve();
  await completion;
  assert.deepEqual(persisted, [1, 2]);
  assert.deepEqual(forwarded, [1, 2]);
});

test("execution listener reports delivery timing once at flush without writing execution logs", async () => {
  const persisted = [];
  const timings = [];
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    userId: "user-a",
    sessionId: "session-a",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
    upstream: {
      onEvent: async () => ({ delivered: 1 }),
      onDeliveryTiming: (summary) => timings.push(summary),
    },
    parentSessionId: "",
    persistenceScope: null,
  });
  listener.forwardEvent({
    event: "turn_lifecycle_committed",
    data: {},
    route: {
      userId: "user-a",
      sessionId: "session-a",
      parentSessionId: "",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
    },
  });
  listener.forwardEvent({
    event: "turn_lifecycle_committed",
    data: {},
    route: {
      userId: "user-a",
      sessionId: "session-a",
      parentSessionId: "",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
    },
  });
  await listener.flush();
  await listener.flush();
  assert.equal(persisted.length, 0);
  assert.equal(timings.length, 1);
  assert.equal(timings[0].sessionId, "session-a");
  assert.equal(timings[0].turnScopeId, "turn-a");
  assert.equal(timings[0].queueWaitMs.n, 2);
  assert.equal(timings[0].runMs.n, 2);
});

test("execution listener does not collect delivery timing without onDeliveryTiming", async () => {
  const forwarded = [];
  const listener = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async () => {} },
    userId: "user-a",
    sessionId: "session-a",
    turnScopeId: "turn-a",
    upstream: { onEvent: async () => forwarded.push(1) },
    parentSessionId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  });
  const originalNow = performance.now;
  let nowCalls = 0;
  performance.now = () => {
    nowCalls += 1;
    return originalNow.call(performance);
  };
  try {
    listener.forwardEvent({
      event: "turn_lifecycle_committed",
      data: {},
      route: {
        userId: "user-a",
        sessionId: "session-a",
        parentSessionId: "",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-a",
      },
    });
    await listener.flush();
  } finally {
    performance.now = originalNow;
  }
  assert.equal(forwarded.length, 1);
  assert.equal(nowCalls, 0);
});

test("execution listener carries the explicit persistence scope on every record", async () => {
  const persisted = [];
  const persistenceScope = {
    scopeId: "agent:child-turn",
    parentSessionId: "parent-session",
    relativeDir: "runtime/plugin-data/workflow/session/parent-session/child-turn",
    allowedRoot: "runtime/plugin-data/workflow/session",
  };
  const scoped = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    userId: "user-a",
    sessionId: "child-session",
    parentSessionId: "parent-session",
    turnScopeId: "",
    persistenceScope,
    dialogProcessId: "child-dialog",
  });
  const unscoped = createExecutionEventListener({
    sessionManager: { appendExecutionLog: async (record) => persisted.push(record) },
    userId: "user-a",
    sessionId: "root-session",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "root-dialog",
    persistenceScope: null,
  });

  await scoped.onEvent({ event: "llm_call_start", data: {} });
  await unscoped.onEvent({ event: "llm_call_start", data: {} });
  await scoped.flush();
  await unscoped.flush();

  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].persistenceScope, persistenceScope);
  assert.equal(persisted[1].persistenceScope, null);
  assert.equal("persistenceContext" in persisted[0], false);
});

test("execution listener rejects construction without an explicit persistence scope", () => {
  assert.throws(
    () =>
      createExecutionEventListener({
        sessionManager: { appendExecutionLog: async () => {} },
        userId: "user-a",
        sessionId: "session-a",
        parentSessionId: "",
        turnScopeId: "",
        dialogProcessId: "dialog-a",
      }),
    /explicit persistenceScope/,
  );
});

test("execution listener rejects non-string or missing route identity at construction", () => {
  const base = {
    sessionManager: { appendExecutionLog: async () => {} },
    userId: "user-a",
    sessionId: "session-a",
    parentSessionId: "",
    turnScopeId: "",
    dialogProcessId: "dialog-a",
    persistenceScope: null,
  };
  assert.throws(
    () => createExecutionEventListener({ ...base, parentSessionId: undefined }),
    /parentSessionId must be a string/,
  );
  assert.throws(
    () => createExecutionEventListener({ ...base, sessionId: "" }),
    /sessionId is required/,
  );
  assert.throws(
    () => createExecutionEventListener({ ...base, userId: 1 }),
    /userId must be a string/,
  );
});

test("execution listener rejects an upstream without an onEvent port", () => {
  assert.throws(
    () =>
      createExecutionEventListener({
        sessionManager: { appendExecutionLog: async () => {} },
        dialogProcessId: "dialog-a",
        upstream: {},
      }),
    /upstream requires an onEvent port/,
  );
});
