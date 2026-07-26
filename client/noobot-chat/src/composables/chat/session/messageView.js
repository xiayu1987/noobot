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
  isHarnessInjectedMessage,
} from "../../infra/messageModel";
import { nowIso } from "../../infra/timeFields";
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { getMessageRole, getMessageTurnScopeId } from "../../infra/messageIdentity";
import { logWorkflowDiagnostics, summarizeWorkflowMessage } from "../debug/workflowDiagnosticsLogger";

export function createSessionMessageView({
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
      !isHarnessInjectedMessage(messageItem) &&
      !childWorkflowMessage;
    const summary = summarizeWorkflowMessage(messageItem);
    if (summary.type === "workflow" || summary.pluginSource === "workflow-plugin" || childWorkflowMessage) {
      logWorkflowDiagnostics("frontend.workflowRender.messageVisibilityEvaluated", {
        sessionId: String(activeSession.value?.backendSessionId || activeSessionId.value || ""),
        dialogProcessId: summary.dialogProcessId,
        turnScopeId: summary.turnScopeId,
        workflowRunId: summary.workflowRunId,
        shouldRender,
        childWorkflowMessage,
        message: summary,
      });
    }
    return shouldRender;
  }

  return { appendMessage, makeViewMessage, foldMessagesForView, shouldRenderMessageInChat };
}

export function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
  if (isMobileRef.value) mobileSidebarOpenRef.value = false;
}
