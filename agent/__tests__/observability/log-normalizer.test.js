/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { initializeCurrentTurnMessageEventProjection } from "../../src/events/current-turn-message-event-projection.js";
import test from "node:test";
import assert from "node:assert/strict";

import { classifyExecutionEvent } from "../../src/observability/event-log/log-normalizer.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  validateProtocolEvent,
  getEventFamily,
} from "@noobot/event-protocol";
import {
  ACTIVITY_EVENT_TYPES,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
  emitMessageEvent,
} from "../../src/events/message-event-stream.js";

function runtimeForTurn({
  presentationMessageId = "presentation-1",
  streamIdentity = { parentSessionId: "", workflowRunId: "", nodeExecutionId: "" },
} = {}) {
  let sequence = 0;
  const runtime = createTestRuntimeContext({
    runConfig: {
      hookManager: null,
      executionId: "execution-1",
      commandId: "command-1",
      presentationMessageId,
    },
    identity: { sessionId: "session-1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
    systemRuntime: {},
    sessionManager: {
      async commitMessageEvent({ sessionId, turnScopeId, producer, payload }) {
        sequence += 1;
        return {
          committed: true,
          envelope: createEventEnvelope({
            family: EVENT_FAMILY.MESSAGE_TIMELINE,
            schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
            identity: {
              eventId: `event-${sequence}`,
              eventType: MESSAGE_EVENT_WIRE_EVENT,
              sessionId,
              turnScopeId,
            },
            causality: {},
            ordering: {
              domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
              scopeId: payload.presentationMessageId,
              sequence,
            },
            producer,
            occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
            payload,
          }),
        };
      },
    },
  });
  bindAssistantMessageEventStream(runtime, { presentationMessageId, ...streamIdentity });
  initializeCurrentTurnMessageEventProjection(runtime);
  return runtime;
}

test("message event payload identity comes only from the bound stream", async () => {
  const runtime = runtimeForTurn({
    streamIdentity: {
      parentSessionId: "parent-bound",
      workflowRunId: "run-bound",
      nodeExecutionId: "node-bound",
    },
  });
  runtime.systemRuntime.dialogProcessId = "dialog-bound";
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const envelope = await emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", {
    text: "token",
    parentSessionId: "parent-stale",
    dialogProcessId: "dialog-stale",
    workflowRunId: "run-stale",
    nodeExecutionId: "node-stale",
  });

  assert.equal(envelope.payload.parentSessionId, "parent-bound");
  assert.equal(envelope.payload.dialogProcessId, "dialog-bound");
  assert.equal(envelope.payload.workflowRunId, "run-bound");
  assert.equal(envelope.payload.nodeExecutionId, "node-bound");
  assert.equal(envelope.identity.turnScopeId, "turn-1");
});

test("authoritative message events declare the message-event sequence domain", async () => {
  const emitted = [];
  const runtime = runtimeForTurn();
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const envelope = await emitMessageEvent(
    { onEvent: (event) => emitted.push(event) },
    runtime,
    "llm_delta",
    { text: "token" },
  );

  assert.equal(envelope.ordering.domain, MESSAGE_EVENT_SEQUENCE_DOMAIN);
  assert.equal(envelope.ordering.scopeId, envelope.payload.presentationMessageId);
  assert.equal(emitted[0]?.event, "authority_event_committed");
  assert.equal(emitted[0]?.data?.envelope, envelope);
});

test("message events commit with the execution-bound persistence scope", async () => {
  const runtime = runtimeForTurn();
  const persistenceScope = {
    scopeId: "agent:child-1",
    parentSessionId: "parent-1",
    relativeDir: "parent-1/child-1",
    allowedRoot: "runtime/session/parent-1/child-1",
  };
  runtime.systemRuntime.persistenceScope = persistenceScope;
  let committed = null;
  const commit = runtime.sessionManager.commitMessageEvent;
  runtime.sessionManager.commitMessageEvent = async (payload) => {
    committed = payload;
    return commit(payload);
  };

  beginAssistantMessageEventStream(runtime, { turn: 0 });
  await emitMessageEvent({ onEvent() {} }, runtime, "thinking", { text: "token" });

  assert.equal(committed.persistenceScope, persistenceScope);
  assert.equal(Object.hasOwn(committed, "persistenceContext"), false);
});

test("message event delivery exposes only the cross-layer persistence scope", async () => {
  const runtime = runtimeForTurn();
  const persistenceScope = {
    scopeId: "agent:child-1",
    parentSessionId: "parent-1",
    relativeDir: "parent-1/child-1",
    allowedRoot: "runtime/session/parent-1/child-1",
  };
  runtime.systemRuntime.persistenceScope = persistenceScope;
  const emitted = [];

  beginAssistantMessageEventStream(runtime, { turn: 0 });
  await emitMessageEvent({ onEvent: (event) => emitted.push(event) }, runtime, "llm_delta", {
    text: "token",
  });

  assert.equal(emitted[0]?.data?.persistenceScope, persistenceScope);
  assert.equal(Object.hasOwn(emitted[0]?.data || {}, "persistenceContext"), false);
});

test("one Turn Aggregate owns a contiguous event sequence across model messages", async () => {
  const runtime = runtimeForTurn();
  const listener = { onEvent() {} };
  const firstMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  const first = await emitMessageEvent(listener, runtime, "thinking", { text: "first" });
  const second = await emitMessageEvent(listener, runtime, "thinking", { text: "second" });
  const nextMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  const next = await emitMessageEvent(listener, runtime, "thinking", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.deepEqual(
    [first.ordering.sequence, second.ordering.sequence, next.ordering.sequence],
    [1, 2, 3],
  );
  assert.equal(first.ordering.scopeId, "presentation-1");
  assert.equal(next.ordering.scopeId, "presentation-1");
});

test("model streams keep independent identities while sharing the run presentation identity", async () => {
  const runtime = runtimeForTurn({ presentationMessageId: "msg_preallocated" });
  const firstMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  const first = await emitMessageEvent({ onEvent() {} }, runtime, "thinking", { text: "first" });
  const nextMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  const next = await emitMessageEvent({ onEvent() {} }, runtime, "thinking", { text: "next" });

  assert.notEqual(nextMessageId, firstMessageId);
  assert.equal(Object.hasOwn(first.identity, "messageId"), false);
  assert.equal(next.ordering.scopeId, "msg_preallocated");
  assert.equal(first.payload.presentationMessageId, "msg_preallocated");
  assert.equal(next.payload.presentationMessageId, "msg_preallocated");
  assert.equal(first.protocol.version, 3);
  assert.deepEqual([first.ordering.sequence, next.ordering.sequence], [1, 2]);
});

test("Turn message event identity is immutable after binding", () => {
  const runtime = runtimeForTurn();
  assert.throws(
    () =>
      bindAssistantMessageEventStream(runtime, {
        presentationMessageId: "presentation-other",
        parentSessionId: "",
        workflowRunId: "",
        nodeExecutionId: "",
      }),
    /presentationMessageId conflict/,
  );
});

test("workflow ownership is immutable and emitted by the common message stream", async () => {
  const runtime = createTestRuntimeContext({
    runConfig: {
      hookManager: null,
      executionId: "execution-1",
      commandId: "command-1",
      presentationMessageId: "workflow-presentation",
      workflowRunId: "workflow-run-1",
      workflowNodeExecutionId: "node-execution-1",
    },
    identity: {
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnScopeId: "turn-workflow",
      dialogProcessId: "dialog-workflow",
    },
    systemRuntime: {},
  });
  let sequence = 0;
  runtime.sessionManager = {
    async commitMessageEvent({ sessionId, turnScopeId, producer, payload }) {
      sequence += 1;
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
          identity: {
            eventId: `workflow-event-${sequence}`,
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId,
            turnScopeId,
          },
          causality: {},
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId: payload.presentationMessageId,
            sequence,
          },
          producer,
          occurredAt: "2026-01-01T00:00:00.000Z",
          payload,
        }),
      };
    },
  };
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "workflow-presentation",
    parentSessionId: "root-session",
    workflowRunId: "workflow-run-1",
    nodeExecutionId: "node-execution-1",
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const envelope = await emitMessageEvent({ onEvent() {} }, runtime, "llm_delta", {
    text: "token",
  });
  assert.equal(envelope.payload.parentSessionId, "root-session");
  assert.equal(envelope.payload.workflowRunId, "workflow-run-1");
  assert.equal(envelope.payload.nodeExecutionId, "node-execution-1");
  assert.throws(
    () =>
      bindAssistantMessageEventStream(runtime, {
        presentationMessageId: "workflow-presentation",
        parentSessionId: "root-session",
        workflowRunId: "workflow-run-1",
        nodeExecutionId: "node-execution-2",
      }),
    /nodeExecutionId conflict/,
  );
});

test("authoritative message envelope validation rejects partial events", () => {
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "evt-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: "presentation-1", sequence: 0 },
    producer: { type: "test", id: "message-event-validation" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: {
      eventType: "llm_delta",
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      text: "token",
    },
  });
  assert.equal(validateProtocolEvent(envelope).valid, true);
  assert.equal(
    validateProtocolEvent({ ...envelope, payload: { ...envelope.payload, dialogProcessId: "" } })
      .valid,
    false,
  );
  assert.equal(
    validateProtocolEvent({ ...envelope, payload: { ...envelope.payload, text: undefined } }).valid,
    false,
  );
  assert.equal(
    validateProtocolEvent({ ...envelope, ordering: { ...envelope.ordering, scopeId: "other" } })
      .valid,
    false,
  );
  assert.equal(
    validateProtocolEvent({ ...envelope, identity: { ...envelope.identity, eventId: "" } }).valid,
    false,
  );
  assert.deepEqual(
    validateProtocolEvent({ ...envelope, ordering: { ...envelope.ordering, sequence: 1 } }).errors,
    ["transient_event_sequenced"],
  );
});

test("transient message events bypass the authority commit and take no sequence", async () => {
  const runtime = runtimeForTurn();
  let commits = 0;
  const commit = runtime.sessionManager.commitMessageEvent;
  runtime.sessionManager.commitMessageEvent = async (payload) => {
    commits += 1;
    return commit(payload);
  };
  const emitted = [];
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const delta = await emitMessageEvent(
    { onEvent: (event) => emitted.push(event) },
    runtime,
    "llm_delta",
    {
      text: "token",
    },
  );
  const durable = await emitMessageEvent({ onEvent() {} }, runtime, "thinking", { text: "done" });

  assert.equal(commits, 1);
  assert.equal(delta.ordering.sequence, 0);
  assert.equal(durable.ordering.sequence, 1);
  assert.equal(validateProtocolEvent(delta).valid, true);
  assert.equal(emitted[0]?.event, "authority_event_committed");
  assert.equal(emitted[0]?.data?.envelope, delta);
});

test("classifyExecutionEvent classifies structured execution events", () => {
  assert.deepEqual(classifyExecutionEvent("model_context_trace"), {
    category: "model_context_trace",
    type: "model_context_trace_debug",
  });
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

  for (const eventType of ACTIVITY_EVENT_TYPES) {
    assert.deepEqual(classifyExecutionEvent(eventType), { category: "activity", type: eventType });
  }
});
