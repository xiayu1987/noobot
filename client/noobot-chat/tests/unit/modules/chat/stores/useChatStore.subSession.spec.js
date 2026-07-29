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
    presentationMessageId: data.presentationMessageId || messageId,
    sequenceDomain: "message-event",
    sequenceScopeId: messageId,
    ...data,
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
      thinking: "```mermaid\ngraph TD; A-->B\n```",
    }));
    applyMessageEvent(store, "tool_result", messageEvent("tool_call_end", {
      ...identity,
      eventId: "tool-result-1",
      sequence: 2,
      role: "tool",
      toolCallId: "call-1",
      content: "tool completed",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: "assistant",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
      content: "",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    });
    expect(session.messages[0].rawEvents).toHaveLength(2);
  });

  it("does not attach a tool event to an assistant from another turn", () => {
    const store = useChatStore();
    applyMessageEvent(store, "thinking_delta", messageEvent("thinking", {
      sessionId: "child-session",
      turnScopeId: "turn-1",
      eventId: "thinking-1",
      role: "assistant",
      thinking: "planning",
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
      messageId: "msg-assistant-2",
      sequence: 2,
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].thinking).toBe("planning");
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
      thinking: "working",
    }));
    applyMessageEvent(store, "turn_lifecycle", messageEvent("turn_lifecycle", {
      ...identity,
      eventId: "completed",
      sequence: 2,
      status: "completed",
      timestamp: "2026-01-01T00:00:05.000Z",
    }));

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
