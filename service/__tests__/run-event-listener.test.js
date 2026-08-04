/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRunEventListener } from "../ws/chat-websocket/run-event-listener.js";

test("run-event-listener forwards committed session version as a first-class event", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => {
      frames.push({ event, data });
      return true;
    },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "turn-1",
  });

  listener.onEvent({
    event: "turn_committed",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      sessionVersion: 7,
      userMessage: {
        messageUid: "sm_1",
        messageId: "frontend-user-1",
        role: "user",
        sessionId: "root-session",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        attachments: [{ attachmentId: "attachment-1", sessionId: "root-session" }],
      },
    },
  });

  assert.deepEqual(frames, [{
    event: "turn_committed",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      sessionVersion: 7,
      userMessage: {
        messageUid: "sm_1",
        messageId: "frontend-user-1",
        role: "user",
        sessionId: "root-session",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        attachments: [{ attachmentId: "attachment-1", sessionId: "root-session" }],
      },
    },
  }]);
});

test("run-event-listener forwards workflow planning frames verbatim", () => {
  const frames = [];
  const received = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "turn-1",
    onEventReceived: (event) => received.push(event),
  });

  listener.onEvent({
    event: "workflow_planning_message_prepared",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-run-1",
      nodeSessions: [{ nodeId: "node-1" }],
      semanticText: "WORKFLOW_DSL/1",
      sourceMessage: { type: "workflow", workflowRunId: "workflow-run-1" },
      extra: "keep-me",
    },
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "workflow_planning_message_prepared");
  assert.deepEqual(frames[0].data, {
    sessionId: "root-session",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    workflowRunId: "workflow-run-1",
    nodeSessions: [{ nodeId: "node-1" }],
    semanticText: "WORKFLOW_DSL/1",
    sourceMessage: { type: "workflow", workflowRunId: "workflow-run-1" },
    extra: "keep-me",
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].eventName, "workflow_planning_message_prepared");
  assert.equal(received[0].workflowRunId, "workflow-run-1");
  assert.equal(received[0].nodeSessionCount, 1);
  assert.equal(received[0].semanticTextLength, 14);
  assert.deepEqual(received[0].sourceMessage, {
    type: "workflow",
    workflowRunId: "workflow-run-1",
  });
});

test("run-event-listener forwards workflow node state frames verbatim", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "turn-1",
  });

  listener.onEvent({
    event: "workflow_node_state_committed",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-run-2",
      nodeSessions: [{ nodeId: "node-2" }],
      state: "running",
    },
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "workflow_node_state_committed");
  assert.deepEqual(frames[0].data, {
    sessionId: "root-session",
    dialogProcessId: "dialog-2",
    turnScopeId: "turn-1",
    workflowRunId: "workflow-run-2",
    nodeSessions: [{ nodeId: "node-2" }],
    state: "running",
  });
});

test("run-event-listener routes workflow child deltas with sub session identity", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ dialogProcessId: "parent-dialog", turnScopeId: "parent-turn" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "parent-turn",
  });

  listener.onEvent({
    event: "llm_delta",
    data: {
      text: "live token",
      sessionId: "sub-session",
      dialogProcessId: "sub-dialog",
      turnScopeId: "sub-turn",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      subAgentCall: true,
    },
  });

  assert.equal(frames[0]?.event, "subagent_delta");
  assert.equal(frames[0]?.data?.scope, "sub_session");
  assert.equal(frames[0]?.data?.sessionId, "sub-session");
  assert.equal(frames[0]?.data?.parentSessionId, "root-session");
  assert.equal(frames[0]?.data?.dialogProcessId, "sub-dialog");
  assert.equal(frames[0]?.data?.turnScopeId, "sub-turn");
  assert.equal(frames[0]?.data?.content, "live token");
});

test("run-event-listener rejects malformed authoritative envelopes instead of legacy normalization", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ dialogProcessId: "parent-dialog", turnScopeId: "parent-turn" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "parent-turn",
  });

  assert.throws(
    () => listener.onEvent({
      event: "tool_call_end",
      data: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 2,
        eventId: "evt-incomplete",
        eventType: "tool_call_end",
        sessionId: "sub-session",
        messageId: "msg-1",
        sequence: 1,
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
      },
    }),
    /invalid authoritative message event envelope/,
  );
  assert.deepEqual(frames, []);
});

test("run-event-listener separates root and child authoritative message channels", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
  });
  const base = {
    envelopeKind: "noobot.message_event", envelopeVersion: 2,
    eventType: "tool_call_start", messageId: "msg-1", presentationMessageId: "presentation-1", sequence: 1,
    tool: "read_file", toolCallId: "call-1", args: {},
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  listener.onEvent({ event: "tool_call_start", data: {
    ...base, eventId: "evt-root", sessionId: "root-session",
  } });
  listener.onEvent({ event: "tool_call_start", data: {
    ...base, eventId: "evt-child", sessionId: "child-session", parentSessionId: "root-session",
  } });
  assert.equal(frames[0].event, "message_event");
  assert.equal(frames[0].data.route.scope, "main_session");
  assert.equal(frames[1].event, "subagent_message_event");
  assert.equal(frames[1].data.route.scope, "sub_session");
});

test("non-streaming delivery suppresses only deltas and preserves root and workflow child finals", () => {
  const frames = [];
  const routed = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => { frames.push({ event, data }); return true; },
    sessionId: "root-session",
    textStreamingEnabled: false,
    registerActiveRun: () => {},
    onAuthoritativeMessageRouted: (data) => routed.push(data),
  });
  const base = {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    sequenceDomain: "message-event",
    messageId: "msg-1",
    presentationMessageId: "presentation-1",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  listener.onEvent({ event: "llm_delta", data: {
    ...base, eventId: "delta-root", eventType: "llm_delta",
    sessionId: "root-session", sequence: 1, text: "hidden",
  } });
  listener.onEvent({ event: "main_model_content", data: {
    ...base, eventId: "final-root", eventType: "main_model_content",
    sessionId: "root-session", sequence: 2, text: "root final",
  } });
  listener.onEvent({ event: "llm_delta", data: {
    ...base, eventId: "delta-child", eventType: "llm_delta",
    sessionId: "child-session", parentSessionId: "root-session",
    sequence: 1, text: "hidden child",
  } });
  listener.onEvent({ event: "main_model_content", data: {
    ...base, eventId: "final-child", eventType: "main_model_content",
    sessionId: "child-session", parentSessionId: "root-session",
    sequence: 2, text: "child final",
  } });

  assert.deepEqual(frames.map((frame) => frame.event), ["message_event", "subagent_message_event"]);
  assert.deepEqual(frames.map((frame) => frame.data.event.text), ["root final", "child final"]);
  assert.deepEqual(routed.map((item) => item.delivery), [
    "suppressed", "delivered", "suppressed", "delivered",
  ]);
  assert.equal(routed[0].suppressionReason, "non_streaming_delta");
  assert.equal(routed[1].textStreamingEnabled, false);
  assert.equal(routed[1].sequenceScopeId, "msg-1");
});

test("authoritative final content awaits the canonical transport result with complete body and attachments", async () => {
  const frames = [];
  const routed = [];
  let releaseSend;
  const sendCompleted = new Promise((resolve) => {
    releaseSend = resolve;
  });
  const listener = createRunEventListener({
    sendEvent: async (event, data) => {
      frames.push({ event, data });
      await sendCompleted;
      return true;
    },
    sessionId: "root-session",
    textStreamingEnabled: false,
    registerActiveRun: () => {},
    onAuthoritativeMessageRouted: (data) => routed.push(data),
  });
  const event = {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    eventId: "event-final",
    eventType: "authoritative_final_content",
    sessionId: "root-session",
    turnScopeId: "turn-1",
    messageId: "message-final",
    presentationMessageId: "presentation-final",
    sequenceDomain: "message-event",
    sequenceScopeId: "message-final",
    sequence: 7,
    timestamp: "2026-01-01T00:00:00.000Z",
    text: "WORKFLOW_DSL/1\nEND\n\ncomplete workflow body",
    attachments: [{ path: "runtime/attach/result.txt", summary: "result" }],
    transferEnvelopes: [{ envelopeId: "transfer-1" }],
  };

  let settled = false;
  const delivery = listener.onEvent({ event: event.eventType, data: event })
    .then((result) => {
      settled = true;
      return result;
    });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "message_event");
  assert.equal(frames[0].data.event.eventId, "event-final");
  assert.equal(frames[0].data.event.text, event.text);
  assert.deepEqual(frames[0].data.event.attachments, event.attachments);
  assert.deepEqual(frames[0].data.event.transferEnvelopes, event.transferEnvelopes);

  releaseSend();
  assert.equal(await delivery, true);
  assert.equal(routed.at(-1).delivery, "delivered");
  assert.equal(routed.at(-1).eventId, "event-final");
});

test("authoritative final content reports asynchronous transport rejection", async () => {
  const routed = [];
  const listener = createRunEventListener({
    sendEvent: async () => false,
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    onAuthoritativeMessageRouted: (data) => routed.push(data),
  });
  const result = await listener.onEvent({
    event: "authoritative_final_content",
    data: {
      envelopeKind: "noobot.message_event",
      envelopeVersion: 2,
      eventId: "event-rejected",
      eventType: "authoritative_final_content",
      sessionId: "root-session",
      messageId: "message-rejected",
      presentationMessageId: "presentation-rejected",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "final body",
    },
  });

  assert.equal(result, false);
  assert.equal(routed.at(-1).delivery, "rejected");
  assert.equal(routed.at(-1).rejectionReason, "transport_send_rejected");
  assert.equal(routed.at(-1).eventId, "event-rejected");
});
