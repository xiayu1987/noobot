/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
  ATTACHMENT_RELATION_TYPE,
  attachmentLifecycleSequenceScopeId,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";

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
    eventVersion: 1,
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
    schemaVersion: getEventFamily(EVENT_FAMILY.ATTACHMENT_LIFECYCLE).schemaVersion,
    identity: {
      eventId: "attachment-authority-event-a",
      eventType: "attachment_lifecycle",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    },
    causality: {},
    ordering: {
      domain: ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
      scopeId: attachmentLifecycleSequenceScopeId(lifecycle.identity),
      sequence: 1,
    },
    producer: { type: "tool", id: "multimodal_parse" },
    occurredAt: lifecycle.occurredAt,
    payload: lifecycle,
  });
  await listener.onEvent({ event: "authority_event_committed", data: { envelope } });

  assert.equal(forwarded.event, "authority_event_committed");
  assert.deepEqual(forwarded.data.envelope, envelope);
  assert.deepEqual(forwarded.data.envelope.payload, lifecycle);
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
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "event-invalid",
      eventType: "message_event",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    },
    causality: {},
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
