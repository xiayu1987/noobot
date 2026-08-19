/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalMessageEvent } from "../helpers/messageEventFixture.js";
import { canonicalWorkflowSessionSnapshot } from "../helpers/workflowRuntimeEventFixture.js";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";

export function resetChatStore() {
  setActivePinia(createPinia());
  useChatStore().resetChatStore();
}

export function applyMessageEvent(store, envelope) {
  return store.reduceSubSessionMessageEvent(envelope, { source: "test" });
}

export function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent(
    canonicalWorkflowSessionSnapshot({
      aggregateVersion: 1,
      parentSessionId: "main-session-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      ...sessionDoc,
    }),
    { source: "test_snapshot" },
  );
}

export function createSubSessionEvent(overrides = {}) {
  const { sequence = 1, ...eventOverrides } = overrides;
  const eventType = overrides.eventType || "llm_delta";
  const messageId = overrides.messageId || "msg-assistant-1";
  return canonicalMessageEvent({
    sessionId: "sub-session-1",
    parentSessionId: "main-session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    workflowRunId: "workflow-1",
    nodeExecutionId: "node-1",
    sequence: sequence + 1,
    revision: 1,
    eventId: "event-1",
    messageId,
    presentationMessageId: overrides.presentationMessageId || messageId,
    eventType,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...(eventType === "llm_delta"
      ? { text: String(overrides.text ?? overrides.content ?? "") }
      : {}),
    ...eventOverrides,
  });
}

export function commitPresentation(store, identity = {}) {
  const sessionId = identity.sessionId || "sub-session-1";
  const turnScopeId = identity.turnScopeId || "turn-1";
  const assistantMessageId = identity.messageId || "msg-assistant-1";
  return applyMessageEvent(
    store,
    canonicalMessageEvent({
      sessionId,
      parentSessionId: identity.parentSessionId || "main-session-1",
      dialogProcessId: identity.dialogProcessId || "dialog-1",
      turnScopeId,
      workflowRunId: identity.workflowRunId || "workflow-1",
      nodeExecutionId: identity.nodeExecutionId || "node-1",
      sequence: 1,
      revision: 1,
      eventId: `${turnScopeId}:${assistantMessageId}:presentation`,
      messageId: assistantMessageId,
      presentationMessageId: assistantMessageId,
      eventType: "turn_presentation_committed",
      presentation: {
        userMessage: {
          id: identity.userMessageId || `${turnScopeId}:user`,
          messageId: identity.userMessageId || `${turnScopeId}:user`,
          role: "user",
          sessionId,
          turnScopeId,
          content: identity.userContent || "question",
          attachments: [],
        },
        assistantMessage: {
          id: assistantMessageId,
          messageId: assistantMessageId,
          presentationMessageId: assistantMessageId,
          role: "assistant",
          sessionId,
          turnScopeId,
          content: "",
          attachments: [],
          pending: true,
        },
      },
    }),
  );
}

export function assistantMessages(store, sessionId = "sub-session-1") {
  return (store.selectSubSessionMessages(sessionId)?.messages || []).filter(
    (message) => message.role === "assistant",
  );
}
