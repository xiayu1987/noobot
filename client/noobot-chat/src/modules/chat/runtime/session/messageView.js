/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import {
  buildAppendMessage,
  buildViewMessage,
  findVisibleLastMessage,
  foldConversationMessages,
  isPluginInjectedMessage,
} from "../../model/messageModel.js";
import { nowIso } from "../../model/timeFields.js";
import { RoleEnum } from "../../model/chatConstants.js";
import {
  getMessageInternalType,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { projectTurnPresentation } from "@noobot/event-protocol/message-event";

const PRESENTATION_RUNTIME_FIELDS = Object.freeze([
  "messageEventState",
  "toolTimeline",
  "activityTimeline",
  "state",
  "status",
  "channelState",
  "pending",
]);

function isInternalControlMessage(messageItem = {}) {
  return Boolean(getMessageInternalType(messageItem));
}

export function createSessionMessageView({
  sessions,
  activeSession,
  activeSessionId,
  userId,
  isImageMime,
}) {
  function appendMessage(role, content = "", attachments = [], options = {}) {
    const msg = reactive(buildAppendMessage(role, content, attachments, options));
    activeSession.value.messages.push(msg);
    activeSession.value.messageCount = (activeSession.value.messageCount || 0) + 1;
    activeSession.value.lastMessage = findVisibleLastMessage(activeSession.value.messages);
    activeSession.value.updatedAt = nowIso();
    return msg;
  }

  function findCanonicalMessageById(sessionId, messageId) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedSessionId || !normalizedMessageId) return null;
    const sessionItems = Array.isArray(sessions?.value) ? sessions.value : [];
    const targetSession = sessionItems.find((sessionItem) =>
      [sessionItem?.sessionId, sessionItem?.sessionId, sessionItem?.sessionId].some(
        (candidate) => String(candidate || "").trim() === normalizedSessionId,
      ),
    );
    const messages = Array.isArray(targetSession?.messages) ? targetSession.messages : [];
    const matchingMessages = messages.filter((message) => {
      const messageIdentity = String(message?.messageId || "").trim();
      const presentationIdentity = String(message?.presentationMessageId || "").trim();
      return (
        messageIdentity === normalizedMessageId || presentationIdentity === normalizedMessageId
      );
    });
    if (!matchingMessages.length) return null;
    // A presentation identity can span the hidden tool-call record and the
    // visible assistant record. Runtime artifacts must land on the visible
    // canonical projection so the live UI and folded history share one target.
    return matchingMessages[matchingMessages.length - 1] || null;
  }

  function findCanonicalMessagesById(sessionId, messageId) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedSessionId || !normalizedMessageId) return [];
    const sessionItems = Array.isArray(sessions?.value) ? sessions.value : [];
    const targetSession = sessionItems.find(
      (sessionItem) => String(sessionItem?.sessionId || "").trim() === normalizedSessionId,
    );
    const messages = Array.isArray(targetSession?.messages) ? targetSession.messages : [];
    return messages.filter(
      (message) =>
        String(message?.messageId || "").trim() === normalizedMessageId ||
        String(message?.presentationMessageId || "").trim() === normalizedMessageId,
    );
  }

  function upsertCanonicalAssistantMessage(messageId, identity = {}) {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) return null;
    const sessionId = String(
      identity?.sessionId || activeSession.value?.sessionId || activeSessionId.value || "",
    ).trim();
    const existing = findCanonicalMessageById(sessionId, normalizedMessageId);
    if (existing) return existing;
    return appendMessage(RoleEnum.ASSISTANT, "", [], {
      ...identity,
      id: normalizedMessageId,
      messageId: normalizedMessageId,
    });
  }

  function materializeTurnPresentation(envelope = {}) {
    const presentation = projectTurnPresentation(envelope?.payload);
    const sessionId = String(envelope?.identity?.sessionId || "").trim();
    const targetSession = (Array.isArray(sessions?.value) ? sessions.value : []).find(
      (sessionItem) => String(sessionItem?.sessionId || "").trim() === sessionId,
    );
    if (!presentation || !targetSession) {
      return { applied: false, reason: presentation ? "session_not_found" : "not_presentation" };
    }
    const messages = Array.isArray(targetSession.messages)
      ? targetSession.messages
      : (targetSession.messages = []);
    let createdCount = 0;
    for (const source of [presentation.userMessage, presentation.assistantMessage]) {
      const sourceMessage = {
        ...source,
        sessionId,
        ts: source.ts || source.createdAt || envelope.occurredAt,
      };
      const messageId = String(sourceMessage.messageId || sourceMessage.id || "").trim();
      const existing = messages.find(
        (message) => String(message?.messageId || message?.id || "").trim() === messageId,
      );
      const canonical = makeViewMessage(sourceMessage);
      if (existing) {
        const runtime = Object.fromEntries(
          PRESENTATION_RUNTIME_FIELDS.filter((field) => existing[field] !== undefined).map(
            (field) => [field, existing[field]],
          ),
        );
        Object.assign(existing, canonical, runtime);
      } else {
        messages.push(canonical);
        createdCount += 1;
      }
    }
    targetSession.messageCount = messages.length;
    targetSession.lastMessage = findVisibleLastMessage(messages);
    targetSession.updatedAt = envelope.occurredAt || targetSession.updatedAt;
    return { applied: true, createdCount };
  }

  function makeViewMessage(messageItem = {}) {
    return reactive(buildViewMessage(messageItem, { userId: userId.value, isImageMime }));
  }

  function foldMessagesForView(messages = []) {
    return foldConversationMessages(messages, makeViewMessage);
  }

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = getMessageRole(messageItem);
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    const childWorkflowMessage = messageTurnScopeId.startsWith("workflow-node:");
    const shouldRender =
      messageRole !== RoleEnum.TOOL &&
      !isPluginInjectedMessage(messageItem) &&
      !isInternalControlMessage(messageItem) &&
      !childWorkflowMessage;
    const summary = summarizeWorkflowMessage(messageItem);
    if (
      summary.type === "workflow" ||
      summary.pluginSource === "workflow-plugin" ||
      childWorkflowMessage
    ) {
      logWorkflowDiagnostics("frontend.workflowRender.messageVisibilityEvaluated", () => ({
        sessionId: String(activeSession.value?.sessionId || activeSessionId.value || ""),
        dialogProcessId: summary.dialogProcessId,
        turnScopeId: summary.turnScopeId,
        workflowRunId: summary.workflowRunId,
        shouldRender,
        childWorkflowMessage,
        message: summary,
      }));
    }
    return shouldRender;
  }

  return {
    appendMessage,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    foldMessagesForView,
    shouldRenderMessageInChat,
  };
}

export function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
  if (isMobileRef.value) mobileSidebarOpenRef.value = false;
}
