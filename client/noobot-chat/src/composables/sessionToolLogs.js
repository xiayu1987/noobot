/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function logKey(item = {}) {
  return `${item.sessionId || ""}|${item.toolCallId || ""}|${item.type || ""}|${item.event || ""}|${item.text || ""}|${item.ts || ""}`;
}

function mergeUniqueLogs(existing = [], incoming = []) {
  const out = [...(existing || [])];
  const seen = new Set(out.map(logKey));
  for (const item of incoming || []) {
    const itemKey = logKey(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    out.push(item);
  }
  return out;
}

function pickRootSessionDocument(sessionDocuments = []) {
  return (
    (sessionDocuments || []).find(
      (sessionDocument) =>
        String(sessionDocument?.caller || "") === "user" &&
        Number(sessionDocument?.depth || 0) === 1,
    ) ||
    (sessionDocuments || []).find(
      (sessionDocument) => Number(sessionDocument?.depth || 0) === 1,
    ) ||
    sessionDocuments[0] ||
    {}
  );
}

function formatToolLogsTree(logs = []) {
  return (logs || []).map((logItem) => {
    const depth = Number(logItem.depth || 0);
    const nodeDepth = logItem.subAgentCall ? Math.max(depth, 1) : depth;
    return {
      ...logItem,
      indent: Math.max(0, nodeDepth) * 22,
    };
  });
}

function buildToolLogsFromSessions(sessionDocuments = []) {
  const sessionById = new Map();
  const resolvedDepthBySessionId = new Map();
  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "");
    if (!sessionId) continue;
    sessionById.set(sessionId, sessionDocument);
  }

  function resolveSessionDepth(sessionId, trail = new Set()) {
    if (!sessionId) return 0;
    if (resolvedDepthBySessionId.has(sessionId)) {
      return resolvedDepthBySessionId.get(sessionId);
    }
    const sessionDocument = sessionById.get(sessionId);
    if (!sessionDocument) return 0;

    const fallbackDepth = Math.max(1, Number(sessionDocument?.depth || 1));
    const parentSessionId = String(sessionDocument?.parentSessionId || "");
    if (
      !parentSessionId ||
      !sessionById.has(parentSessionId) ||
      trail.has(sessionId)
    ) {
      resolvedDepthBySessionId.set(sessionId, fallbackDepth);
      return fallbackDepth;
    }

    trail.add(sessionId);
    const parentDepth = resolveSessionDepth(parentSessionId, trail);
    trail.delete(sessionId);
    const resolvedDepth = Math.max(fallbackDepth, parentDepth + 1);
    resolvedDepthBySessionId.set(sessionId, resolvedDepth);
    return resolvedDepth;
  }

  const collectedLogs = [];
  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "");
    const sessionDepth = resolveSessionDepth(sessionId);
    const messageList = Array.isArray(sessionDocument?.messages)
      ? sessionDocument.messages
      : [];
    const toolNameByCallId = new Map();

    for (const messageItem of messageList) {
      const messageRole = String(messageItem?.role || "");
      const messageType = String(messageItem?.type || "");
      const messageTime = String(messageItem?.ts || new Date().toISOString());
      const dialogProcessId = String(messageItem?.dialogProcessId || "");

      if (
        messageType === "tool_call" ||
        (messageRole === "assistant" &&
          Array.isArray(messageItem?.tool_calls) &&
          messageItem.tool_calls.length)
      ) {
        const toolCalls = Array.isArray(messageItem?.tool_calls)
          ? messageItem.tool_calls
          : [];
        for (const toolCall of toolCalls) {
          const toolCallId = String(toolCall?.id || "");
          const toolName =
            String(toolCall?.function?.name || toolCall?.name || "") ||
            "unknown_tool";
          const toolArguments =
            toolCall?.function?.arguments ?? toolCall?.args ?? "{}";
          if (toolCallId) toolNameByCallId.set(toolCallId, toolName);
          collectedLogs.push({
            event: "tool_call",
            type: "tool_call",
            text: `${toolName} ${typeof toolArguments === "string" ? toolArguments : JSON.stringify(toolArguments)}`.trim(),
            ts: messageTime,
            sessionId,
            depth: sessionDepth,
            toolCallId,
            dialogProcessId,
          });
        }
      }

      if (messageRole === "tool" || messageType === "tool_result") {
        const toolCallId = String(messageItem?.tool_call_id || "");
        const toolName = toolNameByCallId.get(toolCallId) || "tool_result";
        collectedLogs.push({
          event: "tool_result",
          type: "tool_result",
          text: `${toolName} ${String(messageItem?.content || "")}`.trim(),
          ts: messageTime,
          sessionId,
          depth: sessionDepth,
          toolCallId,
          dialogProcessId,
        });
      }
    }
  }
  collectedLogs.sort(
    (leftLog, rightLog) =>
      new Date(leftLog.ts || 0).getTime() -
      new Date(rightLog.ts || 0).getTime(),
  );
  return collectedLogs;
}

function buildToolLogsByDialogProcessId(sessionDocuments = []) {
  const groupedLogs = new Map();
  const sessionById = new Map();
  const childSessionIdsByParentId = new Map();

  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "");
    if (!sessionId) continue;
    sessionById.set(sessionId, sessionDocument);
    const parentSessionId = String(sessionDocument?.parentSessionId || "");
    if (!parentSessionId) continue;
    const siblingSessionIds =
      childSessionIdsByParentId.get(parentSessionId) || [];
    childSessionIdsByParentId.set(parentSessionId, [
      ...siblingSessionIds,
      sessionId,
    ]);
  }

  const allToolLogs = buildToolLogsFromSessions(sessionDocuments);
  for (const toolLog of allToolLogs) {
    const dialogProcessId = String(toolLog?.dialogProcessId || "");
    if (!dialogProcessId) continue;
    const previousLogs = groupedLogs.get(dialogProcessId) || [];
    groupedLogs.set(dialogProcessId, [...previousLogs, toolLog]);
  }

  const rootSessionDocument = pickRootSessionDocument(sessionDocuments);
  const rootSessionMessages = Array.isArray(rootSessionDocument?.messages)
    ? rootSessionDocument.messages
    : [];

  function collectSessionIdsFromObject(value, outputSet) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectSessionIdsFromObject(item, outputSet);
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = String(key || "").toLowerCase();
      if (
        (normalizedKey === "sessionid" ||
          normalizedKey === "subagentsessionid") &&
        typeof nestedValue === "string" &&
        nestedValue.trim()
      ) {
        outputSet.add(nestedValue.trim());
      }
      collectSessionIdsFromObject(nestedValue, outputSet);
    }
  }

  function parseToolResultSessionIds(contentText = "") {
    const sessionIds = new Set();
    const normalizedContentText = String(contentText || "").trim();
    if (!normalizedContentText) return sessionIds;
    try {
      const parsed = JSON.parse(normalizedContentText);
      collectSessionIdsFromObject(parsed, sessionIds);
    } catch {
      // ignore non-json content
    }
    return sessionIds;
  }

  function collectDescendantSessionIds(sessionId, outputSet) {
    if (!sessionId || outputSet.has(sessionId)) return;
    outputSet.add(sessionId);
    const childSessionIds = childSessionIdsByParentId.get(sessionId) || [];
    for (const childSessionId of childSessionIds) {
      collectDescendantSessionIds(childSessionId, outputSet);
    }
  }

  const relatedSessionIdsByDialogProcessId = new Map();
  for (const messageItem of rootSessionMessages) {
    if (String(messageItem?.role || "") !== "tool") continue;
    const dialogProcessId = String(messageItem?.dialogProcessId || "");
    if (!dialogProcessId) continue;
    const existingSessionIds =
      relatedSessionIdsByDialogProcessId.get(dialogProcessId) || new Set();
    const parsedSessionIds = parseToolResultSessionIds(
      messageItem?.content || "",
    );
    for (const parsedSessionId of parsedSessionIds) {
      collectDescendantSessionIds(parsedSessionId, existingSessionIds);
    }
    relatedSessionIdsByDialogProcessId.set(dialogProcessId, existingSessionIds);
  }

  for (const [
    dialogProcessId,
    relatedSessionIds,
  ] of relatedSessionIdsByDialogProcessId.entries()) {
    const additionalLogs = [];
    for (const relatedSessionId of relatedSessionIds) {
      if (!sessionById.has(relatedSessionId)) continue;
      for (const toolLog of allToolLogs) {
        if (String(toolLog?.sessionId || "") !== relatedSessionId) continue;
        additionalLogs.push(toolLog);
      }
    }
    const currentLogs = groupedLogs.get(dialogProcessId) || [];
    groupedLogs.set(
      dialogProcessId,
      mergeUniqueLogs(currentLogs, additionalLogs),
    );
  }

  return groupedLogs;
}

function applyCompletedToolLogsToMessages(messages = [], sessionDocuments = []) {
  const groupedLogs = buildToolLogsByDialogProcessId(sessionDocuments);
  const rootSessionDocument = pickRootSessionDocument(sessionDocuments);
  const rootSessionId = String(rootSessionDocument?.sessionId || "");
  for (const messageItem of messages || []) {
    if (String(messageItem?.role || "") !== "assistant") continue;
    const dialogProcessId = String(messageItem?.dialogProcessId || "");
    const matchedToolLogs = (groupedLogs.get(dialogProcessId) || []).filter(
      (toolLogItem) =>
        String(toolLogItem?.sessionId || "") !== rootSessionId ||
        String(toolLogItem?.dialogProcessId || "") === dialogProcessId,
    );
    const mergedToolLogs = mergeUniqueLogs([], matchedToolLogs);
    messageItem.completedToolLogs = formatToolLogsTree(mergedToolLogs);
  }
}

export {
  mergeUniqueLogs,
  pickRootSessionDocument,
  applyCompletedToolLogsToMessages,
};
