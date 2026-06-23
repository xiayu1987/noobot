/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "./messageIdentity";
import { getMessageTimestamp, nowIso, parseTimeMs } from "./timeFields";

function logKey(item = {}) {
  return `${item.sessionId || ""}|${item.turnScopeId || ""}|${item.toolCallId || ""}|${item.type || ""}|${item.event || ""}|${item.text || ""}|${item.ts || ""}`;
}

function buildTurnScopeGroupKey(sessionId = "", turnScopeId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
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

function buildSessionTreeOrder(sessionDocuments = []) {
  const sessionById = new Map();
  const childSessionIdsByParentId = new Map();
  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "").trim();
    if (!sessionId) continue;
    sessionById.set(sessionId, sessionDocument);
    const parentSessionId = String(sessionDocument?.parentSessionId || "").trim();
    if (!parentSessionId) continue;
    const currentChildSessionIds =
      childSessionIdsByParentId.get(parentSessionId) || [];
    childSessionIdsByParentId.set(parentSessionId, [
      ...currentChildSessionIds,
      sessionId,
    ]);
  }

  function sortSessionIdsByCreatedAt(sessionIds = []) {
    return [...(sessionIds || [])].sort((leftSessionId, rightSessionId) => {
      const leftSessionDocument = sessionById.get(leftSessionId) || {};
      const rightSessionDocument = sessionById.get(rightSessionId) || {};
      const leftCreatedAt = parseTimeMs(leftSessionDocument?.createdAt);
      const rightCreatedAt = parseTimeMs(rightSessionDocument?.createdAt);
      if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
      return String(leftSessionId || "").localeCompare(String(rightSessionId || ""));
    });
  }

  const rootSessionDocument = pickRootSessionDocument(sessionDocuments);
  const rootSessionId = String(rootSessionDocument?.sessionId || "").trim();
  const rootSessionIds = rootSessionId ? [rootSessionId] : [];
  const additionalRootSessionIds = [];
  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "").trim();
    if (!sessionId || rootSessionIds.includes(sessionId)) continue;
    const parentSessionId = String(sessionDocument?.parentSessionId || "").trim();
    if (!parentSessionId || !sessionById.has(parentSessionId)) {
      additionalRootSessionIds.push(sessionId);
    }
  }
  const orderedRootSessionIds = [
    ...rootSessionIds,
    ...sortSessionIdsByCreatedAt(additionalRootSessionIds),
  ];

  const visitedSessionIds = new Set();
  const orderedSessionIds = [];
  function traverseSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || visitedSessionIds.has(normalizedSessionId)) return;
    visitedSessionIds.add(normalizedSessionId);
    orderedSessionIds.push(normalizedSessionId);
    const childSessionIds = sortSessionIdsByCreatedAt(
      childSessionIdsByParentId.get(normalizedSessionId) || [],
    );
    for (const childSessionId of childSessionIds) {
      traverseSession(childSessionId);
    }
  }
  for (const sessionId of orderedRootSessionIds) {
    traverseSession(sessionId);
  }
  for (const sessionId of sessionById.keys()) {
    if (visitedSessionIds.has(sessionId)) continue;
    traverseSession(sessionId);
  }
  return new Map(
    orderedSessionIds.map((sessionId, sessionIndex) => [sessionId, sessionIndex]),
  );
}

function sortLogsBySessionTree(logs = [], sessionOrderById = new Map()) {
  const logTypeOrder = { tool_call: 1, tool_result: 2 };
  return [...(logs || [])].sort((leftLog, rightLog) => {
    const leftSessionOrder = Number(
      sessionOrderById.get(String(leftLog?.sessionId || "").trim()),
    );
    const rightSessionOrder = Number(
      sessionOrderById.get(String(rightLog?.sessionId || "").trim()),
    );
    const normalizedLeftSessionOrder = Number.isFinite(leftSessionOrder)
      ? leftSessionOrder
      : Number.MAX_SAFE_INTEGER;
    const normalizedRightSessionOrder = Number.isFinite(rightSessionOrder)
      ? rightSessionOrder
      : Number.MAX_SAFE_INTEGER;
    if (normalizedLeftSessionOrder !== normalizedRightSessionOrder) {
      return normalizedLeftSessionOrder - normalizedRightSessionOrder;
    }

    const leftTime = parseTimeMs(leftLog?.ts);
    const rightTime = parseTimeMs(rightLog?.ts);
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftType = String(leftLog?.type || "").trim();
    const rightType = String(rightLog?.type || "").trim();
    const leftTypeOrder = Number(logTypeOrder[leftType] || 99);
    const rightTypeOrder = Number(logTypeOrder[rightType] || 99);
    if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder;

    return String(leftLog?.text || "").localeCompare(String(rightLog?.text || ""));
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
      const messageRole = getMessageRole(messageItem);
      const messageType = String(messageItem?.type || "");
      const messageTime = String(getMessageTimestamp(messageItem) || nowIso());
      const dialogProcessId = getMessageDialogProcessId(messageItem);
      const parentDialogProcessId = getMessageParentDialogProcessId(messageItem);
      const turnScopeId = getMessageTurnScopeId(messageItem);

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
            turnScopeId,
            dialogProcessId,
            parentDialogProcessId,
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
          turnScopeId,
          dialogProcessId,
          parentDialogProcessId,
        });
      }
    }
  }
  collectedLogs.sort(
    (leftLog, rightLog) =>
      parseTimeMs(leftLog.ts) -
      parseTimeMs(rightLog.ts),
  );
  return collectedLogs;
}

function buildToolLogsByTurnScope(sessionDocuments = []) {
  const groupedLogs = new Map();
  const sessionOrderById = buildSessionTreeOrder(sessionDocuments);
  const childSessionIdsByParentId = new Map();

  for (const sessionDocument of sessionDocuments || []) {
    const sessionId = String(sessionDocument?.sessionId || "");
    if (!sessionId) continue;
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
  const rootSessionDocument = pickRootSessionDocument(sessionDocuments);
  const rootSessionId = String(rootSessionDocument?.sessionId || "").trim();
  const rootSessionMessages = Array.isArray(rootSessionDocument?.messages)
    ? rootSessionDocument.messages
    : [];

  function collectDescendantSessionIds(sessionId, outputSet) {
    if (!sessionId || outputSet.has(sessionId)) return;
    outputSet.add(sessionId);
    const childSessionIds = childSessionIdsByParentId.get(sessionId) || [];
    for (const childSessionId of childSessionIds) {
      collectDescendantSessionIds(childSessionId, outputSet);
    }
  }

  const relatedSessionIds = new Set();
  if (rootSessionId) collectDescendantSessionIds(rootSessionId, relatedSessionIds);

  const relevantLogs = allToolLogs.filter((toolLog) => {
    const sessionId = String(toolLog?.sessionId || "").trim();
    if (!sessionId) return false;
    if (!relatedSessionIds.size) return true;
    return relatedSessionIds.has(sessionId);
  });

  const logsByTurnScopeKey = new Map();
  const logsByDialogProcessId = new Map();
  for (const toolLog of relevantLogs) {
    const sessionId = String(toolLog?.sessionId || "").trim();
    const turnScopeId = getMessageTurnScopeId(toolLog);
    const turnScopeKey = buildTurnScopeGroupKey(sessionId, turnScopeId);
    if (turnScopeKey) {
      const existingLogs = logsByTurnScopeKey.get(turnScopeKey) || [];
      logsByTurnScopeKey.set(turnScopeKey, [...existingLogs, toolLog]);
    }

    // Legacy fallback for old snapshots without turnScopeId.  New ownership is
    // sessionId + turnScopeId; dialogProcessId is not used when turnScopeId exists.
    const dialogProcessId = getMessageDialogProcessId(toolLog);
    if (!turnScopeKey && dialogProcessId) {
      const existingLogs = logsByDialogProcessId.get(dialogProcessId) || [];
      logsByDialogProcessId.set(dialogProcessId, [...existingLogs, toolLog]);
    }
  }

  for (const messageItem of rootSessionMessages) {
    if (getMessageRole(messageItem) !== "assistant") continue;
    const sessionId = rootSessionId || String(messageItem?.sessionId || messageItem?.session_id || "").trim();
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const turnScopeKey = buildTurnScopeGroupKey(sessionId, turnScopeId);
    if (turnScopeKey) {
      groupedLogs.set(turnScopeKey, sortLogsBySessionTree(
        mergeUniqueLogs([], logsByTurnScopeKey.get(turnScopeKey) || []),
        sessionOrderById,
      ));
      continue;
    }

    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (dialogProcessId) {
      groupedLogs.set(dialogProcessId, sortLogsBySessionTree(
        mergeUniqueLogs([], logsByDialogProcessId.get(dialogProcessId) || []),
        sessionOrderById,
      ));
    }
  }

  return groupedLogs;
}

function applyCompletedToolLogsToMessages(messages = [], sessionDocuments = []) {
  const groupedLogs = buildToolLogsByTurnScope(sessionDocuments);
  const rootSessionDocument = pickRootSessionDocument(sessionDocuments);
  const rootSessionId = String(rootSessionDocument?.sessionId || "");
  for (const messageItem of messages || []) {
    if (getMessageRole(messageItem) !== "assistant") continue;
    const sessionId = rootSessionId || String(messageItem?.sessionId || messageItem?.session_id || "").trim();
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const turnScopeKey = buildTurnScopeGroupKey(sessionId, turnScopeId);
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    const matchedToolLogs = (groupedLogs.get(turnScopeKey || dialogProcessId) || []).filter(
      (toolLogItem) => {
        if (turnScopeKey) {
          return buildTurnScopeGroupKey(toolLogItem?.sessionId, toolLogItem?.turnScopeId) === turnScopeKey;
        }
        return (
          String(toolLogItem?.sessionId || "") !== rootSessionId ||
          String(toolLogItem?.dialogProcessId || "") === dialogProcessId
        );
      },
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
