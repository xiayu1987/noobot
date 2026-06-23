/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeRouteText(value = "") {
  return String(value || "").trim();
}

export function isHarnessInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    normalizeRouteText(messageItem?.injectedBy) === "harness-plugin"
  );
}

export function isToolOrThinkingMessage(messageItem = {}) {
  const role = normalizeRouteText(messageItem?.role).toLowerCase();
  const type = normalizeRouteText(messageItem?.type).toLowerCase();
  return (
    role === "tool" ||
    type === "tool_call" ||
    type === "tool_result" ||
    Array.isArray(messageItem?.realtimeLogs) ||
    Array.isArray(messageItem?.completedToolLogs)
  );
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

export function buildToolLogFromMessage(messageItem = {}, fallbackIndex = 0) {
  const role = normalizeRouteText(messageItem?.role).toLowerCase();
  const type = normalizeRouteText(messageItem?.type).toLowerCase();
  const event = type === "tool_result" || role === "tool" ? "tool_result" : "tool_call";
  return {
    sessionId: normalizeRouteText(messageItem?.sessionId),
    depth: Number(messageItem?.depth || 1),
    dialogProcessId: normalizeRouteText(messageItem?.dialogProcessId),
    turnScopeId: normalizeRouteText(messageItem?.turnScopeId),
    type: event,
    event,
    text: typeof messageItem?.content === "string"
      ? messageItem.content
      : JSON.stringify(messageItem?.content ?? `tool_${fallbackIndex + 1}`),
    ts: messageItem?.ts || messageItem?.createdAt || "",
  };
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
    (isHarnessInjectedMessage(item) || isToolOrThinkingMessage(item) || item === rootMessage)
  );
  const toolLogs = scopedMessages
    .filter((item = {}) => isToolOrThinkingMessage(item))
    .flatMap((item = {}, index) => {
      const completed = Array.isArray(item?.completedToolLogs) ? item.completedToolLogs : [];
      if (completed.length) return completed;
      const realtime = Array.isArray(item?.realtimeLogs) ? item.realtimeLogs : [];
      if (realtime.length) return realtime;
      return [buildToolLogFromMessage(item, index)];
    });
  const injectedMessages = scopedMessages.filter((item = {}) => isHarnessInjectedMessage(item));
  const messageItem = {
    ...rootMessage,
    hasThinkingDetails: toolLogs.length > 0 || injectedMessages.length > 0,
    thinkingDetailCount: toolLogs.length,
    executionLogTotal: toolLogs.length,
    completedToolLogs: toolLogs,
  };
  return {
    exists: Boolean(rootMessage?.role || scopedMessages.length),
    sessionId: fullResult?.sessionId || sessionItem?.sessionId || "",
    messageItem,
    allMessages: scopedMessages,
    counts: {
      executionLogCount: toolLogs.length,
      injectedMessageCount: injectedMessages.length,
      messageCount: scopedMessages.length,
    },
  };
}
