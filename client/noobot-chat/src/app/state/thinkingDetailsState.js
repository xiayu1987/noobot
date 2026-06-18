export function getThinkingDetailsCount(messageItem = {}) {
  if (Array.isArray(messageItem?.completedToolLogs)) {
    return messageItem.completedToolLogs.length;
  }
  if (Array.isArray(messageItem?.toolCalls)) {
    return messageItem.toolCalls.length;
  }
  if (Array.isArray(messageItem?.realtimeLogs)) {
    return messageItem.realtimeLogs.filter((logItem = {}) => {
      const event = String(logItem?.event || logItem?.type || "").toLowerCase();
      return event.includes("tool") || event.includes("function");
    }).length;
  }
  return 0;
}

export function getThinkingDetailsTitle(messageItem = {}, translate) {
  return translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) });
}

export function resolveFallbackThinkingDetailsPayload(activeSession = {}) {
  const messages = activeSession?.rawMessages || activeSession?.messages || [];
  const messageItem = [...messages].reverse().find((item = {}) =>
    item?.role === "assistant" && (item?.pending || Array.isArray(item?.realtimeLogs) || Array.isArray(item?.completedToolLogs))
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
