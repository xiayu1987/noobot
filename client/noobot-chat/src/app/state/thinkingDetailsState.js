export function getThinkingDetailsCount(messageItem = {}) {
  const completedToolLogs = Array.isArray(messageItem?.processCompletedToolLogs)
    ? messageItem.processCompletedToolLogs
    : Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  if (completedToolLogs.length > 0) {
    return completedToolLogs.length;
  }
  const summaryThinkingDetailsCount = getSummaryThinkingDetailsCount(messageItem);
  if (summaryThinkingDetailsCount > 0) return summaryThinkingDetailsCount;
  const toolCalls = Array.isArray(messageItem?.toolCalls)
    ? messageItem.toolCalls
    : Array.isArray(messageItem?.tool_calls)
    ? messageItem.tool_calls
    : [];
  if (toolCalls.length > 0) {
    return toolCalls.length;
  }
  const realtimeLogs = Array.isArray(messageItem?.processRealtimeLogs)
    ? messageItem.processRealtimeLogs
    : Array.isArray(messageItem?.realtimeLogs)
    ? messageItem.realtimeLogs
    : [];
  if (realtimeLogs.length > 0) {
    const realtimeThinkingDetailCount = realtimeLogs.filter((logItem = {}) => {
      const event = String(logItem?.event || logItem?.type || "").toLowerCase();
      return event.includes("tool") || event.includes("function");
    }).length;
    if (realtimeThinkingDetailCount > 0) return realtimeThinkingDetailCount;
  }
  return 0;
}

function getSummaryThinkingDetailsCount(messageItem = {}) {
  const count = Number(messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function hasThinkingDetails(messageItem = {}) {
  return messageItem?.hasThinkingDetails === true || getSummaryThinkingDetailsCount(messageItem) > 0;
}

export function getThinkingDetailsTitle(messageItem = {}, translate) {
  return translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) });
}

export function resolveFallbackThinkingDetailsPayload(activeSession = {}) {
  const messages = activeSession?.rawMessages || activeSession?.messages || [];
  const messageItem = [...messages].reverse().find((item = {}) =>
    item?.role === "assistant" && (item?.pending || Array.isArray(item?.realtimeLogs) || Array.isArray(item?.completedToolLogs) || hasThinkingDetails(item))
  );
  return { messageItem: messageItem || null, allMessages: messages };
}

export function resolveThinkingDetailsPanelPayload(payload = {}, fallbackPayload = {}) {
  return {
    messageItem: payload?.messageItem || fallbackPayload.messageItem || null,
    allMessages: Array.isArray(payload?.allMessages)
      ? payload.allMessages
      : fallbackPayload.allMessages || [],
  };
}

export function buildThinkingDetailsRoute(sessionId, thinkingDetailsPanel) {
  return {
    sessionId,
    panel: thinkingDetailsPanel,
  };
}
