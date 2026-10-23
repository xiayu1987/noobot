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
import { initializeCurrentTurnMessageEventProjection } from "../../../../../../../../agent/src/events/current-turn-message-event-projection.js";
import { createRuntimeContext } from "../../../../../../../../agent/src/runtime/runtime-context-factory.js";
import { createRunEventListener } from "../../../../../../../../service/ws/chat-websocket/run-event-listener.js";
import { isWorkflowNodeMessageEvent } from "@noobot/event-protocol/message-event";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { canonicalWorkflowSessionSnapshot } from "../../helpers/workflowRuntimeEventFixture.js";

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent(
    canonicalWorkflowSessionSnapshot({
      eventId: "workflow-session-snapshot-1",
      executionId: "agent-execution-child-session",
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
  expect(isWorkflowNodeMessageEvent(wireEnvelope)).toBe(true);
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
    const runtime = createRuntimeContext({
      basePath: "",
      globalConfig: {},
      userConfig: {},
      eventListener: null,
      attachmentService: null,
      botManager: null,
      userInteractionBridge: null,
      abortSignal: new AbortController().signal,
      runtimeModel: "",
      allEnabledProviders: {},
      userMessageAttachments: [],
      sharedTools: {},
      systemRuntime: {
        userId: "user-1",
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
        persistenceScope: null,
      },
      runConfig: {
        hookManager: null,
        executionId: "child-execution",
        commandId: "child-command",
      },
      sessionManager: {
        commitMessageEvent: async ({ payload, sessionId, turnScopeId }) => ({
          committed: true,
          envelope: canonicalMessageEvent({
            ...payload,
            eventId: `${payload.presentationMessageId}:${payload.eventType}:${produced.length + 1}`,
            sessionId,
            turnScopeId,
            sequence: produced.length + 1,
          }),
        }),
      },
    });
    initializeCurrentTurnMessageEventProjection(runtime);
    const listener = createRunEventListener({
      sessionId: "parent-session",
      onAuthorityEventCommitted(envelope) {
        frames.push(envelope);
        return true;
      },
    });

    const presentationMessageId = "child-turn-presentation";
    bindAssistantMessageEventStream(runtime, {
      presentationMessageId,
      parentSessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
    });
    const modelMessageId = beginAssistantMessageEventStream(runtime, { turn: 1 });
    expect(modelMessageId).not.toBe(presentationMessageId);
    produced.push(
      await emitMessageEvent(listener, runtime, "turn_presentation_committed", {
        presentation: {
          userMessage: {
            messageUid: "child-turn-user",
            userMessageId: "child-turn-user",
            role: "user",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            content: "run the workflow node",
            attachments: [],
          },
          assistantMessage: {
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
      await emitMessageEvent(listener, runtime, "model_analysis_delta", {
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
      expect(frame.ordering.scopeId).toBe(presentationMessageId);
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    let session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    let assistantMessage = session.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      presentationMessageId,
      role: "assistant",
    });
    expect(assistantMessage.activityTimeline).toEqual([
      expect.objectContaining({
        eventType: "model_analysis_delta",
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
      nodeSessionId: "child-session",
      messages: [
        {
          messageUid: presentationMessageId,
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
      presentationMessageId,
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
