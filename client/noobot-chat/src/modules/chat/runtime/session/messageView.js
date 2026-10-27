/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import {
  buildAppendMessage,
  buildViewMessage,
  normalizeMessageAttachments,
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
import {
  projectTurnPresentation,
  resolveMessageViewKey,
} from "@noobot/event-protocol/message-event";
import { isPlainObject, text } from "@noobot/shared/value";

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

function createSessionMessageLookup(sessions) {
  function findSession(sessionId) {
    return sessions.value.find((sessionItem) => sessionItem.sessionId === sessionId) ?? null;
  }

  function sessionMessages(sessionId) {
    const session = findSession(sessionId);
    return session === null ? [] : session.messages;
  }

  function findMessageByViewKey(sessionId, viewKey) {
    const normalizedViewKey = text(viewKey);
    if (!normalizedViewKey) return null;
    return (
      sessionMessages(sessionId).find(
        (message) => resolveMessageViewKey(message) === normalizedViewKey,
      ) || null
    );
  }

  function findMessagesByPresentationId(sessionId, presentationMessageId) {
    const normalizedPresentationId = text(presentationMessageId);
    if (!normalizedPresentationId) return [];
    return sessionMessages(sessionId).filter(
      (message) => text(message?.presentationMessageId) === normalizedPresentationId,
    );
  }

  function findUncommittedUserMessage(sessionId, userMessageId) {
    const normalizedUserMessageId = text(userMessageId);
    if (!normalizedUserMessageId) return null;
    return (
      sessionMessages(sessionId).find(
        (message) =>
          getMessageRole(message) === RoleEnum.USER &&
          !text(message?.messageUid) &&
          text(message?.userMessageId) === normalizedUserMessageId,
      ) || null
    );
  }

  function findUserMessageForCommit(sessionId, committedUserMessage = {}) {
    return (
      findMessageByViewKey(sessionId, resolveMessageViewKey(committedUserMessage)) ||
      findUncommittedUserMessage(sessionId, committedUserMessage.userMessageId)
    );
  }

  return {
    findMessageByViewKey,
    findMessagesByPresentationId,
    findSession,
    findUserMessageForCommit,
  };
}

export function createSessionMessageView({ sessions, activeSession, activeSessionId, userId }) {
  const {
    findMessageByViewKey,
    findMessagesByPresentationId,
    findSession,
    findUserMessageForCommit,
  } = createSessionMessageLookup(sessions);

  function appendMessage(role, content, attachments, options) {
    if (typeof content !== "string") {
      throw new TypeError("appendMessage requires string content");
    }
    if (!Array.isArray(attachments)) {
      throw new TypeError("appendMessage requires attachments array");
    }
    if (!isPlainObject(options)) {
      throw new TypeError("appendMessage requires options object");
    }
    const msg = reactive(
      buildAppendMessage({
        sessionId: activeSession.value.sessionId,
        role,
        content,
        attachments,
        options,
      }),
    );
    activeSession.value.messages.push(msg);
    activeSession.value.messageCount = (activeSession.value.messageCount || 0) + 1;
    activeSession.value.lastMessage = findVisibleLastMessage(activeSession.value.messages);
    activeSession.value.updatedAt = nowIso();
    return msg;
  }

  function upsertCanonicalAssistantMessage(presentationMessageId, identity) {
    const existing = findMessageByViewKey(identity.sessionId, presentationMessageId);
    if (existing) return existing;
    return appendMessage(RoleEnum.ASSISTANT, "", [], { ...identity, presentationMessageId });
  }

  function materializeTurnPresentation(envelope) {
    const presentation = projectTurnPresentation(envelope);
    const { sessionId } = envelope.identity;
    const targetSession = findSession(sessionId);
    if (targetSession === null) return { applied: false, reason: "session_not_found" };
    const { messages } = targetSession;
    let createdCount = 0;
    for (const sourceMessage of [presentation.userMessage, presentation.assistantMessage]) {
      const existing =
        getMessageRole(sourceMessage) === RoleEnum.USER
          ? findUserMessageForCommit(sessionId, sourceMessage)
          : findMessageByViewKey(sessionId, resolveMessageViewKey(sourceMessage));
      const canonical = makeViewMessage(sourceMessage, { sessionId });
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
    targetSession.updatedAt = envelope.occurredAt;
    return { applied: true, createdCount };
  }

  function makeViewMessage(messageItem, { sessionId }) {
    return reactive(buildViewMessage(messageItem, { sessionId, userId: userId.value }));
  }

  function makeViewAttachments(attachments) {
    return normalizeMessageAttachments(attachments, { userId: userId.value });
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
        sessionId: activeSessionId.value,
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
    findMessageByViewKey,
    findMessagesByPresentationId,
    findSession,
    findUserMessageForCommit,
    materializeTurnPresentation,
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    makeViewAttachments,
    shouldRenderMessageInChat,
  };
}

export function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
  if (isMobileRef.value) mobileSidebarOpenRef.value = false;
}
