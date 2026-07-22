/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRunEventListener } from "../ws/chat-websocket/run-event-listener.js";

test("run-event-listener forwards workflow planning frames verbatim", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => frames.push({ event, data }),
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "turn-1",
  });

  listener.onEvent({
    event: "workflow_planning_message_prepared",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-run-1",
      nodeSessions: [{ nodeId: "node-1" }],
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
    extra: "keep-me",
  });
});

test("run-event-listener forwards workflow node state frames verbatim", () => {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => frames.push({ event, data }),
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
    sendEvent: (event, data) => frames.push({ event, data }),
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
    sendEvent: (event, data) => frames.push({ event, data }),
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
        envelopeVersion: 1,
        eventId: "evt-incomplete",
        eventType: "tool_call_end",
        sessionId: "sub-session",
        messageId: "msg-1",
        sequence: 1,
        // timestamp is deliberately absent.
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
    sendEvent: (event, data) => frames.push({ event, data }),
    sessionId: "root-session",
    textStreamingEnabled: true,
    registerActiveRun: () => {},
  });
  const base = {
    envelopeKind: "noobot.message_event", envelopeVersion: 1,
    eventType: "tool_call_start", messageId: "msg-1", sequence: 1,
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
