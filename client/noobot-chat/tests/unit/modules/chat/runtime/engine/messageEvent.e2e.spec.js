/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
  emitMessageEvent,
} from "../../../../../../../../agent/src/events/message-event-stream.js";
import { createRunEventListener } from "../../../../../../../../service/ws/chat-websocket/run-event-listener.js";
import { shouldProjectSubSessionEvent } from "../../../../../../src/modules/chat/runtime/engine/sendFlow.js";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";

function applyMessageEvent(store, eventName, data) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_message_event",
    data: { ...data, eventType: data?.eventType || eventName },
  }, { source: "test" });
}

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_session_snapshot_loaded",
    data: {
      aggregateVersion: 1,
      parentSessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      ...sessionDoc,
    },
  }, { source: "test_snapshot" });
}

function deliverPacketToStore(store, frame) {
  const wireFrame = JSON.parse(JSON.stringify(frame));
  expect(shouldProjectSubSessionEvent(wireFrame.event, wireFrame.data)).toBe(true);
  return applyMessageEvent(store,
    wireFrame.data.event.eventType,
    wireFrame.data.event,
  );
}

describe("authoritative message event end-to-end fidelity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves Mermaid thinking through tool results and snapshot takeover", () => {
    const store = useChatStore();
    const frames = [];
    const produced = [];
    const runtime = {
      sessionId: "child-session",
      systemRuntime: {
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
    };
    const listener = createRunEventListener({
      sessionId: "parent-session",
      textStreamingEnabled: true,
      sendEvent(event, data) {
        frames.push({ event, data });
      },
    });

    const messageId = "child-turn-message";
    const presentationMessageId = "child-turn-presentation";
    bindAssistantMessageEventStream(runtime, {
      messageId,
      presentationMessageId,
      parentSessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
    });
    const modelMessageId = beginAssistantMessageEventStream(runtime, { turn: 1 });
    expect(modelMessageId).not.toBe(messageId);
    produced.push(emitMessageEvent(listener, runtime, "main_model_content", {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      text: "```mermaid\ngraph TD; A-->B\n```",
      output: "```mermaid\ngraph TD; A-->B\n```",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
    }));
    produced.push(emitMessageEvent(listener, runtime, "tool_call_end", {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      toolCallId: "call-1",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    }));

    expect(frames).toHaveLength(2);
    frames.forEach((frame, index) => {
      expect(frame.event).toBe("subagent_message_event");
      expect(frame.data.event).toEqual(produced[index]);
      expect(frame.data.event.sequenceScopeId).toBe(messageId);
      expect(frame.data.route).not.toHaveProperty("messageId");
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    let session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      id: presentationMessageId,
      messageId: presentationMessageId,
      role: "assistant",
    });
    expect(session.messages[0].activityTimeline).toEqual([
      expect.objectContaining({
        event: "main_model_content",
        text: "```mermaid\ngraph TD; A-->B\n```",
      }),
    ]);
    expect(session.messages[0].toolTimeline).toEqual([
      expect.objectContaining({
        key: "call:call-1",
        status: "completed",
        result: "ok",
      }),
    ]);
    expect(session.messages[0].messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.eventId),
    );

    applySessionSnapshot(store, {
      sessionId: "child-session",
      messages: [{
        id: presentationMessageId,
      messageId: presentationMessageId,
      presentationMessageId,
        role: "assistant",
        content: "final answer",
      }],
    });
    session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      id: presentationMessageId,
      content: "final answer",
    });
    expect(session.messages[0].activityTimeline).toHaveLength(1);
    expect(session.messages[0].toolTimeline).toHaveLength(1);
    expect(session.messages[0].messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.eventId),
    );
    expect(session.messages[0]).not.toHaveProperty("thinking");
    expect(session.messages[0]).not.toHaveProperty("toolResult");
    expect(session.messages[0]).not.toHaveProperty("rawEvents");
  });
});
