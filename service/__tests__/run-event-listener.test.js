/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import {
  createWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createRunEventListener } from "../ws/chat-websocket/run-event-listener.js";

const CHILD_SCOPE = Object.freeze({
  scopeId: "agent:child-turn",
  parentSessionId: "root-session",
  relativeDir: "runtime/plugin-data/workflow/session/root-session/child-turn",
  allowedRoot: "runtime/plugin-data/workflow/session",
});

function createListener(overrides = {}) {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => {
      frames.push({ event, data });
      return true;
    },
    sessionId: "root-session",
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1", dialogProcessId: "dialog-1" }),
    ...overrides,
  });
  return { listener, frames };
}

function messageEnvelope(payload = null) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "event-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "root-session",
      turnScopeId: "turn-1",
    },
    causality: { commandId: "command-1" },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: "presentation-1",
      sequence: 1,
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: payload || {
      eventType: MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      text: "complete body",
    },
  });
}

test("run-event-listener forwards the committed Turn receipt only through its explicit contract", () => {
  const { listener, frames } = createListener();
  listener.onEvent({
    event: "turn_committed",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      aggregateVersion: 7,
      userMessage: {
        messageUid: "sm_1",
        userMessageId: "frontend-user-1",
        role: "user",
        content: "hello",
        sessionId: "root-session",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        attachments: [],
      },
    },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "turn_committed");
  assert.equal(frames[0].data.aggregateVersion, 7);
});

test("run-event-listener forwards the attachment binding receipt through its explicit contract", () => {
  const { listener, frames } = createListener();
  listener.onEvent({
    event: "turn_attachments_bound",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      aggregateVersion: 8,
      userMessage: {
        messageUid: "sm_1",
        userMessageId: "frontend-user-1",
        role: "user",
        content: "hello",
        sessionId: "root-session",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        attachments: [{ attachmentId: "a1", sessionId: "root-session" }],
      },
    },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "turn_attachments_bound");
  assert.equal(frames[0].data.aggregateVersion, 8);
});

test("run-event-listener dispatches a canonical authority commit without rebuilding its envelope", () => {
  const dispatched = [];
  const { listener, frames } = createListener({
    onAuthorityEventCommitted: (envelope, options) => {
      dispatched.push({ envelope, options });
      return true;
    },
  });
  const envelope = messageEnvelope();
  const result = listener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope: CHILD_SCOPE },
  });
  assert.equal(result, true);
  assert.deepEqual(dispatched, [{ envelope, options: { persistenceScope: CHILD_SCOPE } }]);
  assert.deepEqual(frames, []);
});

test("run-event-listener rejects malformed authority commits", () => {
  const { listener, frames } = createListener({ onAuthorityEventCommitted: () => true });
  assert.throws(
    () => listener.onEvent({ event: "authority_event_committed", data: { envelope: {} } }),
    /invalid committed authority event/,
  );
  assert.deepEqual(frames, []);
});

test("run-event-listener uses Agent lifecycle only for local run coordination", () => {
  const running = [];
  const { listener, frames } = createListener({ onRootRunning: (data) => running.push(data) });
  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: {
      state: "running",
      sessionId: "root-session",
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
    },
  });
  assert.equal(running.length, 1);
  assert.deepEqual(frames, []);
});

test("run-event-listener rejects every event outside the private run contract", () => {
  const { listener, frames } = createListener();
  for (const event of [
    "llm_delta",
    "done",
    "user_stopped",
    "workflow_node_state_committed",
    "attachment_lifecycle",
    "tool_call_start",
    "unknown_event",
  ]) {
    assert.throws(
      () => listener.onEvent({ event, data: {} }),
      new RegExp(`unsupported agent run event: ${event}`),
    );
  }
  assert.deepEqual(frames, []);
});

test("run event listener exposes onDeliveryTiming only when delivery-timing debug passes a callback", () => {
  const { listener: disabled } = createListener({ onDeliveryTiming: null });
  assert.equal(Object.prototype.hasOwnProperty.call(disabled, "onDeliveryTiming"), false);
  const received = [];
  const callback = (summary) => received.push(summary);
  const { listener: enabled } = createListener({ onDeliveryTiming: callback });
  assert.equal(enabled.onDeliveryTiming, callback);
  enabled.onDeliveryTiming({ queueWaitMs: { n: 1 } });
  assert.deepEqual(received, [{ queueWaitMs: { n: 1 } }]);
});

test("run-event-listener rejects malformed data before auditing or coordinating a run", () => {
  const audits = [];
  const running = [];
  const { listener, frames } = createListener({
    onEventReceived: (audit) => audits.push(audit),
    onRootRunning: (data) => running.push(data),
  });
  for (const event of [
    "authority_event_committed",
    "turn_lifecycle_committed",
    "turn_committed",
    "turn_attachments_bound",
    "agent_lifecycle_state_changed",
  ]) {
    for (const data of [undefined, null, false, 0, "", "running", []]) {
      assert.throws(
        () => listener.onEvent({ event, data }),
        new RegExp(`invalid ${event} data: expected an object`),
      );
    }
  }
  assert.deepEqual(audits, []);
  assert.deepEqual(running, []);
  assert.deepEqual(frames, []);
});

test("run-event-listener does not normalize event names, lifecycle states or identities", () => {
  const running = [];
  const { listener } = createListener({ onRootRunning: (data) => running.push(data) });
  assert.throws(
    () => listener.onEvent({ event: " agent_lifecycle_state_changed ", data: {} }),
    /unsupported agent run event/,
  );
  const data = { state: "running", sessionId: "root-session", turnScopeId: "turn-1" };
  for (const patch of [
    { state: "RUNNING" },
    { state: " running " },
    { sessionId: " root-session " },
    { turnScopeId: " turn-1 " },
  ]) {
    listener.onEvent({ event: "agent_lifecycle_state_changed", data: { ...data, ...patch } });
  }
  assert.deepEqual(running, []);
});

test("run-event-listener reads current turn identity from live run metadata only", () => {
  const running = [];
  let runMeta = null;
  const { listener } = createListener({
    getCurrentRunMeta: () => runMeta,
    onRootRunning: (data) => running.push(data),
  });
  const emit = (turnScopeId) => {
    const data = { state: "running", sessionId: "root-session", turnScopeId };
    listener.onEvent({ event: "agent_lifecycle_state_changed", data });
    return data;
  };
  emit("turn-1");
  runMeta = { turnScopeId: "turn-1" };
  const first = emit("turn-1");
  runMeta = { turnScopeId: "turn-2" };
  emit("turn-1");
  const second = emit("turn-2");
  assert.deepEqual(running, [first, second]);
  assert.equal(running[0], first);
  assert.equal(running[1], second);
});

test("run-event-listener rejects invalid delivery timing callbacks and preserves failures", () => {
  for (const onDeliveryTiming of [false, 0, "callback", {}, []]) {
    assert.throws(
      () => createListener({ onDeliveryTiming }),
      /onDeliveryTiming must be a function/,
    );
  }
  const failure = new Error("timing callback failed");
  const { listener } = createListener({
    onDeliveryTiming: () => {
      throw failure;
    },
  });
  assert.throws(
    () => listener.onDeliveryTiming({}),
    (error) => error === failure,
  );
});

test("run-event-listener audits authority commits from the committed envelope identity", () => {
  const audits = [];
  const { listener } = createListener({
    onAuthorityEventCommitted: () => true,
    onEventReceived: (audit) => audits.push(audit),
  });
  const envelope = messageEnvelope({
    eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_START,
    tool: "read_file",
    toolCallId: "call-1",
    args: { filePath: "example.txt", riskLevel: "low" },
    dialogProcessId: "dialog-1",
    presentationMessageId: "presentation-1",
  });
  listener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope: null },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, MESSAGE_EVENT_WIRE_EVENT);
  assert.equal(audits[0].payloadEventType, MESSAGE_EVENT_TYPE.TOOL_CALL_START);
  assert.equal(audits[0].sessionId, "root-session");
  assert.equal(audits[0].turnScopeId, "turn-1");
  assert.equal(audits[0].dialogProcessId, "dialog-1");
  assert.equal(audits[0].eventId, "event-1");
  assert.equal(audits[0].protocolVersion, envelope.protocol.version);
  assert.equal(audits[0].schemaVersion, envelope.protocol.schemaVersion);
  assert.equal(audits[0].presentationMessageId, envelope.payload.presentationMessageId);
});

test("run-event-listener audits workflow planning from the committed envelope payload", () => {
  const audits = [];
  const { listener } = createListener({
    onAuthorityEventCommitted: () => true,
    onEventReceived: (audit) => audits.push(audit),
  });
  const sourceMessage = { role: "assistant", presentationMessageId: "presentation-1" };
  const envelope = createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.PLANNING,
    authoritySessionId: "root-session",
    turnScopeId: "turn-1",
    executionId: "run-1",
    eventId: "workflow_planning:run-1:1",
    workflowRunId: "run-1",
    sequence: 1,
    occurredAt: "2026-08-17T00:00:00.000Z",
    producer: { type: "plugin", id: "workflow" },
    causality: { correlationId: "run-1" },
    payload: {
      sessionId: "root-session",
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
      workflowRunId: "run-1",
      workflowPayload: {
        semantic: { nodes: [{ id: "node-1" }], flowtos: [] },
        nodeSessions: [
          {
            nodeExecutionId: "node-1",
            eventId: "workflow_node_state:run-1:node-1:1",
            activeChildExecutionId: "agent-1",
            attemptExecutionIds: [],
            status: "ready",
            revision: 1,
            sequence: 1,
          },
        ],
      },
      sourceMessage,
    },
  });
  listener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope: null },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, WORKFLOW_RUNTIME_EVENT.PLANNING);
  assert.equal(audits[0].workflowRunId, "run-1");
  assert.equal(Object.hasOwn(audits[0], "workflowRevision"), false);
  assert.equal(audits[0].nodeSessionCount, 1);
  assert.deepEqual(audits[0].sourceMessage, sourceMessage);
  assert.equal(audits[0].sequenceScopeId, "run-1");
});

test("run-event-listener audits node state from its sole execution identity", () => {
  const audits = [];
  const dispatched = [];
  const { listener } = createListener({
    onAuthorityEventCommitted: (envelope) => dispatched.push(envelope),
    onEventReceived: (audit) => audits.push(audit),
  });
  const envelope = createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    authoritySessionId: "root-session",
    turnScopeId: "workflow-node:node-1",
    executionId: "node-1",
    eventId: "node-state-1",
    workflowRunId: "run-1",
    sequence: 1,
    revision: 2,
    occurredAt: "2026-08-17T00:00:00.000Z",
    producer: { type: "plugin", id: "workflow" },
    causality: { correlationId: "run-1" },
    payload: {
      workflowRunId: "run-1",
      turnScopeId: "workflow-node:node-1",
      status: "running",
      activeChildExecutionId: "agent-1",
      attemptExecutionIds: ["agent-1"],
    },
  });
  assert.equal(Object.hasOwn(envelope.payload, "nodeExecutionId"), false);
  listener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope: null },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].nodeExecutionId, envelope.identity.executionId);
  assert.equal(audits[0].workflowRevision, envelope.ordering.revision);
  assert.equal(audits[0].workflowStatus, envelope.payload.status);
  assert.equal(dispatched[0], envelope);
});

test("run-event-listener audits envelope-free run events from their route-projected data", () => {
  const audits = [];
  const { listener } = createListener({ onEventReceived: (audit) => audits.push(audit) });
  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: { state: "idle", sessionId: "root-session", turnScopeId: "turn-1", dialogProcessId: "d" },
  });
  assert.equal(audits[0].sessionId, "root-session");
  assert.equal(audits[0].turnScopeId, "turn-1");
  assert.equal(audits[0].dialogProcessId, "d");
  for (const field of ["protocolVersion", "schemaVersion", "eventId", "presentationMessageId"]) {
    assert.equal(Object.hasOwn(audits[0], field), false);
  }
});

test("run-event-listener ignores child-session lifecycle for root run coordination", () => {
  const running = [];
  const runMeta = { turnScopeId: "turn-1", dialogProcessId: "dialog-1" };
  const { listener } = createListener({
    onRootRunning: (data) => running.push(data),
    getCurrentRunMeta: () => runMeta,
  });
  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: {
      state: "running",
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnScopeId: "turn-1",
      dialogProcessId: "child-dialog",
    },
  });
  assert.deepEqual(running, []);
});
