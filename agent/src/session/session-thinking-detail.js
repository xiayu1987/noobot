/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeRouteText(value = "") {
  return String(value || "").trim();
}

export function isInjectedMessage(messageItem = {}) {
  return messageItem?.injectedMessage === true;
}

export function isToolOrThinkingMessage(messageItem = {}) {
  return Array.isArray(messageItem?.toolTimeline) || Array.isArray(messageItem?.activityTimeline);
}

export function isSameThinkingRound(rootMessage = {}, candidateMessage = {}, filters = {}) {
  const turnScopeId = normalizeRouteText(filters.turnScopeId || rootMessage?.turnScopeId);
  if (turnScopeId) {
    return normalizeRouteText(candidateMessage?.turnScopeId) === turnScopeId;
  }
  const dialogProcessId = normalizeRouteText(filters.dialogProcessId || rootMessage?.dialogProcessId);
  if (dialogProcessId && normalizeRouteText(candidateMessage?.dialogProcessId) !== dialogProcessId) {
    return false;
  }
  return true;
}

export function buildThinkingDetailPayload(fullResult = {}, filters = {}) {
  const sessions = Array.isArray(fullResult?.sessions) ? fullResult.sessions : [];
  const sessionItem = sessions[0] || {};
  const messages = Array.isArray(sessionItem?.rawMessages)
    ? sessionItem.rawMessages
    : Array.isArray(sessionItem?.messages)
      ? sessionItem.messages
      : [];
  const dialogProcessId = normalizeRouteText(filters.dialogProcessId);
  const turnScopeId = normalizeRouteText(filters.turnScopeId);
  const rootMessage = messages.find((item = {}) => {
    if (normalizeRouteText(item?.role) !== "assistant") return false;
    if (normalizeRouteText(item?.type || "message") !== "message") return false;
    return isSameThinkingRound({ dialogProcessId, turnScopeId }, item, filters);
  }) || {};
  const scopedMessages = messages.filter((item = {}) =>
    isSameThinkingRound(rootMessage?.role ? rootMessage : { dialogProcessId, turnScopeId }, item, filters) &&
    (isInjectedMessage(item) || isToolOrThinkingMessage(item) || item === rootMessage)
  );
  const injectedMessages = scopedMessages.filter((item = {}) => isInjectedMessage(item));
  const toolTimeline = Array.isArray(rootMessage?.toolTimeline) ? rootMessage.toolTimeline : [];
  const activityTimeline = Array.isArray(rootMessage?.activityTimeline) ? rootMessage.activityTimeline : [];
  const thinkingDetailCount = toolTimeline.length + activityTimeline.length;
  const sessionId = fullResult?.sessionId || sessionItem?.sessionId || "";
  const messageItem = {
    ...rootMessage,
    sessionId: normalizeRouteText(rootMessage?.sessionId || sessionId),
    toolTimeline,
    activityTimeline,
    hasThinkingDetails: thinkingDetailCount > 0 || injectedMessages.length > 0,
    thinkingDetailCount,
  };
  return {
    exists: Boolean(rootMessage?.role || scopedMessages.length),
    sessionId,
    messageItem,
    allMessages: scopedMessages,
    counts: {
      executionLogCount: toolTimeline.length,
      injectedMessageCount: injectedMessages.length,
      messageCount: scopedMessages.length,
    },
  };
}
