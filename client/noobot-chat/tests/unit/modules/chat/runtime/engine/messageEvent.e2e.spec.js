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
  return store.reduceSubSessionMessageEvent(canonicalMessageEvent({
    ...data,
    eventType: data?.eventType || eventName,
    eventId: data?.eventId,
    sequence: data?.sequence,
  }), { source: "test" });
}

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent(canonicalWorkflowSessionSnapshot({
      aggregateVersion: 1,
      authoritySessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      ...sessionDoc,
  }), { source: "test_snapshot" });
}

function deliverPacketToStore(store, envelope) {
  const wireEnvelope = JSON.parse(JSON.stringify(envelope));
  expect(shouldProjectSubSessionEvent(
    wireEnvelope.identity.eventType,
    wireEnvelope,
  )).toBe(true);
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
    produced.push(await emitMessageEvent(listener, runtime, "main_model_content", {
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
    produced.push(await emitMessageEvent(listener, runtime, "tool_call_end", {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      toolCallId: "call-1",
      toolResult: { tool_call_id: "call-1", output: "ok" },
      success: true,
    }));

    expect(frames).toHaveLength(2);
    frames.forEach((frame, index) => {
      expect(frame).toEqual(produced[index]);
      expect(frame.identity.eventType).toBe("message_event");
      expect(frame.ordering.scopeId).toBe(messageId);
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
      produced.map((event) => event.identity.eventId),
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
      produced.map((event) => event.identity.eventId),
    );
    expect(session.messages[0]).not.toHaveProperty("thinking");
    expect(session.messages[0]).not.toHaveProperty("toolResult");
    expect(session.messages[0]).not.toHaveProperty("rawEvents");
  });
});
