/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";

function applyMessageEvent(store, eventName, data) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_message_event",
    data: { ...data, eventType: data?.eventType || eventName },
  }, { source: "test" });
}

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_session_snapshot_loaded",
    data: { snapshotVersion: 1, ...sessionDoc },
  }, { source: "test_snapshot" });
}

function messageEvent(eventType, data = {}) {
  const messageId = data.messageId || "message-1";
  return {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    timestamp: "2026-01-01T00:00:00.000Z",
    sequence: 1,
    eventType,
    messageId,
    sequenceDomain: "message-event",
    ...data,
    presentationMessageId: data.presentationMessageId || messageId,
    sequenceScopeId: data.sequenceScopeId || messageId,
  };
}

describe("sub-session realtime message projection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps assistant thinking when a tool result arrives", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      turnScopeId: "workflow-node:execution-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "execution-1",
      messageId: "msg-assistant-1",
    };

    applyMessageEvent(store, "thinking_delta", messageEvent("thinking", {
      ...identity,
      eventId: "thinking-1",
      sequence: 1,
      role: "assistant",
      text: "```mermaid\ngraph TD; A-->B\n```",
    }));
    applyMessageEvent(store, "tool_result", messageEvent("tool_call_end", {
      ...identity,
      eventId: "tool-result-1",
      sequence: 2,
      role: "tool",
      toolCallId: "call-1",
      result: "ok",
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: "assistant",
      content: "",
    });
    expect(session.messages[0].activityTimeline).toEqual([
      expect.objectContaining({ event: "thinking", text: "```mermaid\ngraph TD; A-->B\n```" }),
    ]);
    expect(session.messages[0].toolTimeline).toEqual([
      expect.objectContaining({ key: "call:call-1", result: "ok", status: "completed" }),
    ]);
  });

  it("does not attach a tool event to an assistant from another turn", () => {
    const store = useChatStore();
    applyMessageEvent(store, "thinking_delta", messageEvent("thinking", {
      sessionId: "child-session",
      turnScopeId: "turn-1",
      eventId: "thinking-1",
      role: "assistant",
      text: "planning",
      messageId: "msg-assistant-1",
      sequence: 1,
    }));
    applyMessageEvent(store, "tool_result", messageEvent("tool_call_end", {
      sessionId: "child-session",
      turnScopeId: "turn-2",
      eventId: "tool-2",
      role: "tool",
      toolCallId: "call-2",
      content: "result",
      result: "result",
      messageId: "msg-assistant-2",
      sequence: 1,
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].activityTimeline[0]).toMatchObject({ text: "planning" });
  });

  it("finalizes child runtime by turn instead of mutating message pending", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      turnScopeId: "turn-completed",
      dialogProcessId: "dialog-child",
      messageId: "assistant-completed",
    };
    applyMessageEvent(store, "thinking", messageEvent("thinking", {
      ...identity,
      eventId: "started",
      sequence: 1,
      status: "sending",
      pending: true,
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "working",
    }));
    store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        ...identity,
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        parentSessionId: "parent-session",
        eventId: "completed",
        sequence: 2,
        revision: 2,
        sequenceDomain: "workflow-node-state",
        status: "completed",
        timestamp: "2026-01-01T00:00:05.000Z",
      },
    }, { source: "test" });

    const session = store.selectSubSessionMessages("child-session");
    expect(session.turnStatuses).toEqual([expect.objectContaining({
      turnScopeId: "turn-completed",
      status: "completed",
    })]);
    expect(session.turnTimings).toEqual([expect.objectContaining({
      turnScopeId: "turn-completed",
      thinkingStartedAt: "2026-01-01T00:00:00.000Z",
      thinkingFinishedAt: "2026-01-01T00:00:05.000Z",
    })]);
    expect(session.messages[0].pending).toBe(true);
  });
});
