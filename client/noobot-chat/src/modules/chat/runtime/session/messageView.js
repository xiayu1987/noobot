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
import { getMessageRole, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { logWorkflowDiagnostics, summarizeWorkflowMessage } from "../../../debug/loggers/workflowDiagnosticsLogger.js";

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
    const targetSession = sessionItems.find((sessionItem) => [
      sessionItem?.sessionId,
      sessionItem?.sessionId,
      sessionItem?.sessionId,
    ].some((candidate) => String(candidate || "").trim() === normalizedSessionId));
    const messages = Array.isArray(targetSession?.messages)
      ? targetSession.messages
      : [];
    return messages.find((message) => {
      const messageIdentity = String(message?.messageId || "").trim();
      const presentationIdentity = String(message?.presentationMessageId || "").trim();
      return messageIdentity === normalizedMessageId || presentationIdentity === normalizedMessageId;
    }) || null;
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
    const shouldRender = messageRole !== RoleEnum.TOOL &&
      !isPluginInjectedMessage(messageItem) &&
      !childWorkflowMessage;
    const summary = summarizeWorkflowMessage(messageItem);
    if (summary.type === "workflow" || summary.pluginSource === "workflow-plugin" || childWorkflowMessage) {
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
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    foldMessagesForView,
    shouldRenderMessageInChat,
  };
}

export function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
  if (isMobileRef.value) mobileSidebarOpenRef.value = false;
}
