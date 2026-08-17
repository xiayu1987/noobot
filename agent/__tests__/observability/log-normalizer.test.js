/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyExecutionEvent } from "../../src/observability/event-log/log-normalizer.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
  emitMessageEvent,
} from "../../src/events/message-event-stream.js";

function runtimeForTurn({ messageId = "turn-message-1", presentationMessageId = "presentation-1" } = {}) {
  let sequence = 0;
  const runtime = {
    runConfig: { messageId, presentationMessageId },
    systemRuntime: { sessionId: "session-1", turnScopeId: "turn-1" },
    sessionManager: {
      async commitMessageEvent({ sessionId, turnScopeId, messageId: committedMessageId, payload }) {
        sequence += 1;
        return {
          committed: true,
          envelope: createEventEnvelope({
            family: EVENT_FAMILY.MESSAGE_TIMELINE,
            identity: {
              eventId: `event-${sequence}`,
              eventType: MESSAGE_EVENT_WIRE_EVENT,
              sessionId,
              turnScopeId,
              messageId: committedMessageId,
            },
            ordering: {
              domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
              scopeId: messageId,
              sequence,
            },
            producer: { type: "test", id: "message-event-commit" },
            occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
            payload,
          }),
        };
      },
    },
  };
  bindAssistantMessageEventStream(runtime, { messageId, presentationMessageId });
  return runtime;
}

test("authoritative message events declare the message-event sequence domain", async () => {
  const emitted = [];
  const runtime = runtimeForTurn();
  beginAssistantMessageEventStream(runtime);
  const envelope = await emitMessageEvent({ onEvent: (event) => emitted.push(event) }, runtime, "llm_delta", { text: "token" });

  assert.equal(envelope.ordering.domain, MESSAGE_EVENT_SEQUENCE_DOMAIN);
  assert.equal(envelope.ordering.scopeId, envelope.identity.messageId);
  assert.equal(emitted[0]?.event, "authority_event_committed");
  assert.equal(emitted[0]?.data?.envelope, envelope);
});

test("one Turn Aggregate owns a contiguous event sequence across model messages", async () => {
  const runtime = runtimeForTurn();
  const listener = { onEvent() {} };
  const firstMessageId = beginAssistantMessageEventStream(runtime);
  const first = await emitMessageEvent(listener, runtime, "llm_delta", { text: "first" });
  const second = await emitMessageEvent(listener, runtime, "llm_delta", { text: "second" });
  const nextMessageId = beginAssistantMessageEventStream(runtime);
  const next = await emitMessageEvent(listener, runtime, "llm_delta", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.deepEqual([first.ordering.sequence, second.ordering.sequence, next.ordering.sequence], [1, 2, 3]);
  assert.equal(first.ordering.scopeId, "turn-message-1");
  assert.equal(next.ordering.scopeId, "turn-message-1");
});

test("model streams keep independent identities while sharing the run presentation identity", async () => {
  const runtime = runtimeForTurn({
    messageId: "turn-message-preallocated",
    presentationMessageId: "msg_preallocated",
  });
  const firstMessageId = beginAssistantMessageEventStream(runtime);
  const first = await emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", { text: "first" });
  const nextMessageId = beginAssistantMessageEventStream(runtime);
  const next = await emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.equal(first.identity.messageId, "turn-message-preallocated");
  assert.equal(next.identity.messageId, "turn-message-preallocated");
  assert.equal(first.payload.presentationMessageId, "msg_preallocated");
  assert.equal(next.payload.presentationMessageId, "msg_preallocated");
  assert.equal(first.protocol.version, 3);
  assert.deepEqual([first.ordering.sequence, next.ordering.sequence], [1, 2]);
});

test("Turn message event identity is immutable after binding", () => {
  const runtime = runtimeForTurn();
  assert.throws(() => bindAssistantMessageEventStream(runtime, {
    messageId: "other-message",
    presentationMessageId: "presentation-1",
  }), /messageId conflict/);
});

test("workflow ownership is immutable and emitted by the common message stream", async () => {
  const runtime = {
    runConfig: {
      messageId: "workflow-message",
      presentationMessageId: "workflow-presentation",
      workflowRunId: "workflow-run-1",
      workflowNodeExecutionId: "node-execution-1",
    },
    systemRuntime: { sessionId: "child-session", parentSessionId: "root-session", turnScopeId: "turn-workflow" },
  };
  let sequence = 0;
  runtime.sessionManager = {
    async commitMessageEvent({ sessionId, turnScopeId, messageId, payload }) {
      sequence += 1;
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          identity: { eventId: `workflow-event-${sequence}`, eventType: MESSAGE_EVENT_WIRE_EVENT, sessionId, turnScopeId, messageId },
          ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: messageId, sequence },
          producer: { type: "test", id: "workflow-message-event-commit" },
          occurredAt: "2026-01-01T00:00:00.000Z",
          payload,
        }),
      };
    },
  };
  bindAssistantMessageEventStream(runtime, {
    messageId: "workflow-message",
    presentationMessageId: "workflow-presentation",
    parentSessionId: "root-session",
    workflowRunId: "workflow-run-1",
    nodeExecutionId: "node-execution-1",
  });
  beginAssistantMessageEventStream(runtime);
  const envelope = await emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", { text: "token" });
  assert.equal(envelope.payload.parentSessionId, "root-session");
  assert.equal(envelope.payload.workflowRunId, "workflow-run-1");
  assert.equal(envelope.payload.nodeExecutionId, "node-execution-1");
  assert.throws(() => bindAssistantMessageEventStream(runtime, {
    messageId: "workflow-message",
    presentationMessageId: "workflow-presentation",
    parentSessionId: "root-session",
    workflowRunId: "workflow-run-1",
    nodeExecutionId: "node-execution-2",
  }), /nodeExecutionId conflict/);
});

test("authoritative message envelope validation rejects partial events", () => {
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: { eventId: "evt-1", eventType: MESSAGE_EVENT_WIRE_EVENT, sessionId: "session-1", turnScopeId: "turn-1", messageId: "message-1" },
    ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: "message-1", sequence: 1 },
    producer: { type: "test", id: "message-event-validation" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { eventType: "llm_delta", presentationMessageId: "presentation-1", text: "token" },
  });
  assert.equal(validateProtocolEvent(envelope).valid, true);
  assert.equal(validateProtocolEvent({ ...envelope, payload: { ...envelope.payload, text: undefined } }).valid, false);
  assert.equal(validateProtocolEvent({ ...envelope, identity: { ...envelope.identity, messageId: "" } }).valid, false);
  assert.equal(validateProtocolEvent({ ...envelope, identity: { ...envelope.identity, eventId: "" } }).valid, false);
});

test("classifyExecutionEvent classifies structured execution events", () => {
  assert.deepEqual(classifyExecutionEvent("semantic_transfer_validation"), {
    category: "semantic_transfer",
    type: "semantic_transfer",
  });
  assert.deepEqual(classifyExecutionEvent("tool_call_start"), {
    category: "tool",
    type: "tool_call",
  });
  assert.deepEqual(classifyExecutionEvent("tool_call_end"), {
    category: "tool",
    type: "tool_result",
  });
});
