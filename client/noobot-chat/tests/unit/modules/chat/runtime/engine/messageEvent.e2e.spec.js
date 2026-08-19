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
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { canonicalWorkflowSessionSnapshot } from "../../helpers/workflowRuntimeEventFixture.js";

function applyMessageEvent(store, eventName, data) {
  return store.reduceSubSessionMessageEvent(
    canonicalMessageEvent({
      ...data,
      eventType: data?.eventType || eventName,
      eventId: data?.eventId,
      sequence: data?.sequence,
    }),
    { source: "test" },
  );
}

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent(
    canonicalWorkflowSessionSnapshot({
      aggregateVersion: 1,
      authoritySessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      ...sessionDoc,
    }),
    { source: "test_snapshot" },
  );
}

function deliverPacketToStore(store, envelope) {
  const wireEnvelope = JSON.parse(JSON.stringify(envelope));
  expect(shouldProjectSubSessionEvent(wireEnvelope.identity.eventType, wireEnvelope)).toBe(true);
  return store.reduceSubSessionMessageEvent(wireEnvelope, { source: "test" });
}

describe("authoritative message event end-to-end fidelity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves Mermaid thinking through tool results and snapshot takeover", async () => {
    const store = useChatStore();
    const frames = [];
    const produced = [];
    const runtime = {
      sessionId: "child-session",
      userId: "user-1",
      systemRuntime: {
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
      sessionManager: {
        commitMessageEvent: async ({ payload, sessionId, turnScopeId, messageId }) => ({
          committed: true,
          envelope: canonicalMessageEvent({
            ...payload,
            eventId: `${messageId}:${payload.eventType}:${produced.length + 1}`,
            sessionId,
            turnScopeId,
            messageId,
            sequence: produced.length + 1,
          }),
        }),
      },
    };
    const listener = createRunEventListener({
      sessionId: "parent-session",
      onAuthorityEventCommitted(envelope) {
        frames.push(envelope);
        return true;
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
    produced.push(
      await emitMessageEvent(listener, runtime, "turn_presentation_committed", {
        presentation: {
          userMessage: {
            id: "child-turn-user",
            messageId: "child-turn-user",
            role: "user",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            content: "run the workflow node",
            attachments: [],
          },
          assistantMessage: {
            id: presentationMessageId,
            messageId: presentationMessageId,
            presentationMessageId,
            role: "assistant",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            content: "",
            attachments: [],
            pending: true,
          },
        },
      }),
    );
    produced.push(
      await emitMessageEvent(listener, runtime, "main_model_content", {
        sessionId: "child-session",
        parentSessionId: "parent-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
        workflowRunId: "workflow-run-1",
        nodeExecutionId: "node-execution-1",
        text: "```mermaid\ngraph TD; A-->B\n```",
        thinking: "```mermaid\ngraph TD; A-->B\n```",
      }),
    );
    produced.push(
      await emitMessageEvent(listener, runtime, "tool_call_end", {
        sessionId: "child-session",
        parentSessionId: "parent-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
        workflowRunId: "workflow-run-1",
        nodeExecutionId: "node-execution-1",
        toolCallId: "call-1",
        result: "ok",
        success: true,
      }),
    );

    expect(frames).toHaveLength(3);
    frames.forEach((frame, index) => {
      expect(frame).toEqual(produced[index]);
      expect(frame.identity.eventType).toBe("message_event");
      expect(frame.ordering.scopeId).toBe(messageId);
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    let session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    let assistantMessage = session.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      id: presentationMessageId,
      messageId: presentationMessageId,
      role: "assistant",
    });
    expect(assistantMessage.activityTimeline).toEqual([
      expect.objectContaining({
        event: "main_model_content",
        text: "```mermaid\ngraph TD; A-->B\n```",
      }),
    ]);
    expect(assistantMessage.toolTimeline).toEqual([
      expect.objectContaining({
        key: "call:call-1",
        status: "completed",
        result: "ok",
      }),
    ]);
    expect(assistantMessage.messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.identity.eventId),
    );

    applySessionSnapshot(store, {
      sessionId: "child-session",
      messages: [
        {
          id: presentationMessageId,
          messageId: presentationMessageId,
          presentationMessageId,
          role: "assistant",
          content: "final answer",
        },
      ],
    });
    session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    assistantMessage = session.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      id: presentationMessageId,
      content: "final answer",
    });
    expect(assistantMessage.activityTimeline).toHaveLength(1);
    expect(assistantMessage.toolTimeline).toHaveLength(1);
    expect(assistantMessage.messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.identity.eventId),
    );
    expect(assistantMessage).not.toHaveProperty("thinking");
    expect(assistantMessage).not.toHaveProperty("toolResult");
    expect(assistantMessage).not.toHaveProperty("rawEvents");
  });
});
