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
  isPluginInjectedMessage,
} from "../../model/messageModel.js";
import { nowIso } from "../../model/timeFields.js";
import { RoleEnum } from "../../model/chatConstants.js";
import { isWorkflowNodeTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
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
import { text } from "@noobot/shared/value";

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
    const normalizedSessionId = text(sessionId);
    const normalizedMessageId = text(messageId);
    if (!normalizedSessionId || !normalizedMessageId) return null;
    const sessionItems = Array.isArray(sessions?.value) ? sessions.value : [];
    const targetSession = sessionItems.find((sessionItem) =>
      [sessionItem?.sessionId, sessionItem?.sessionId, sessionItem?.sessionId].some(
        (candidate) => text(candidate) === normalizedSessionId,
      ),
    );
    const messages = Array.isArray(targetSession?.messages) ? targetSession.messages : [];
    const matchingMessages = messages.filter((message) => {
      const messageIdentity = text(message?.messageId);
      const presentationIdentity = text(message?.presentationMessageId);
      return (
        messageIdentity === normalizedMessageId || presentationIdentity === normalizedMessageId
      );
    });
    if (!matchingMessages.length) return null;

    return matchingMessages[matchingMessages.length - 1] || null;
  }

  function findCanonicalMessagesById(sessionId, messageId) {
    const normalizedSessionId = text(sessionId);
    const normalizedMessageId = text(messageId);
    if (!normalizedSessionId || !normalizedMessageId) return [];
    const sessionItems = Array.isArray(sessions?.value) ? sessions.value : [];
    const targetSession = sessionItems.find(
      (sessionItem) => text(sessionItem?.sessionId) === normalizedSessionId,
    );
    const messages = Array.isArray(targetSession?.messages) ? targetSession.messages : [];
    return messages.filter(
      (message) =>
        text(message?.messageId) === normalizedMessageId ||
        text(message?.presentationMessageId) === normalizedMessageId,
    );
  }

  function upsertCanonicalAssistantMessage(messageId, identity = {}) {
    const normalizedMessageId = text(messageId);
    if (!normalizedMessageId) return null;
    const sessionId = text(
      identity?.sessionId || activeSession.value?.sessionId || activeSessionId.value,
    );
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
    const sessionId = text(envelope?.identity?.sessionId);
    const targetSession = (Array.isArray(sessions?.value) ? sessions.value : []).find(
      (sessionItem) => text(sessionItem?.sessionId) === sessionId,
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
      const messageId = text(sourceMessage.messageId);
      const existing = messages.find((message) => text(message?.messageId) === messageId);
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

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = getMessageRole(messageItem);
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    const childWorkflowMessage = isWorkflowNodeTurnScopeId(messageTurnScopeId);
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
    shouldRenderMessageInChat,
  };
}

export function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
  if (isMobileRef.value) mobileSidebarOpenRef.value = false;
}
