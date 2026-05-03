/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  return Object.fromEntries(
    Object.entries(source).map(([connectorType, connectorName]) => [
      String(connectorType || "").trim(),
      String(connectorName || "").trim(),
    ]).filter(([connectorType]) => connectorType),
  );
}

export function normalizeMessageEntity(
  message = {},
  now = () => new Date().toISOString(),
) {
  const normalizedAttachmentMetas = Array.isArray(message?.attachmentMetas)
    ? message.attachmentMetas
    : [];
  const normalizedMessage = {
    role: String(message?.role || "").trim(),
    content: message?.content || "",
    type: String(message?.type || "").trim(),
    dialogProcessId: String(message?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    attachmentMetas: normalizedAttachmentMetas,
    ts: String(message?.ts || "").trim() || now(),
  };
  const toolCallId = String(message?.tool_call_id || "").trim();
  if (toolCallId) normalizedMessage.tool_call_id = toolCallId;
  if (Array.isArray(message?.tool_calls)) {
    normalizedMessage.tool_calls = message.tool_calls;
  }
  if (
    normalizedMessage.type === "tool_call" &&
    !Array.isArray(normalizedMessage.tool_calls)
  ) {
    normalizedMessage.tool_calls = [];
  }
  return normalizedMessage;
}

export function normalizeMessagesEntity(
  messages = [],
  now = () => new Date().toISOString(),
) {
  return (messages || []).map((messageItem) =>
    normalizeMessageEntity(messageItem, now),
  );
}

export function normalizeTaskEntity(task = {}) {
  const taskId = String(task?.taskId || "").trim();
  const taskStatus = String(task?.taskStatus || "").trim();
  return {
    taskId,
    skillName: String(task?.skillName || "").trim(),
    taskName: String(task?.taskName || "").trim(),
    taskStatus:
      taskStatus === "start" || taskStatus === "completed" ? taskStatus : "",
    startedAt: String(task?.startedAt || "").trim(),
    endedAt: String(task?.endedAt || "").trim(),
    result: String(task?.result || "").trim(),
    meta: task?.meta && typeof task.meta === "object" ? task.meta : {},
  };
}

export function normalizeExecutionLogEntity(
  executionLog = {},
  now = () => new Date().toISOString(),
) {
  return {
    dialogProcessId: String(executionLog?.dialogProcessId || "").trim(),
    event: String(executionLog?.event || "").trim(),
    category: String(executionLog?.category || "").trim(),
    type: String(executionLog?.type || "").trim(),
    data:
      executionLog?.data && typeof executionLog.data === "object"
        ? executionLog.data
        : {},
    ts: String(executionLog?.ts || "").trim() || now(),
  };
}

export function normalizeSessionTreeEntity(
  tree = {},
  now = () => new Date().toISOString(),
) {
  const nodes =
    tree?.nodes && typeof tree.nodes === "object" ? { ...tree.nodes } : {};
  for (const [nodeId, node] of Object.entries(nodes)) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId) {
      delete nodes[nodeId];
      continue;
    }
    const normalizedChildren = Array.isArray(node?.children)
      ? Array.from(
          new Set(
            node.children
              .map((childId) => String(childId || "").trim())
              .filter(Boolean),
          ),
        )
      : [];
    nodes[normalizedNodeId] = {
      ...node,
      sessionId: normalizedNodeId,
      parentSessionId: String(node?.parentSessionId || "").trim(),
      children: normalizedChildren,
    };
    if (normalizedNodeId !== nodeId) delete nodes[nodeId];
  }

  const roots = Object.values(nodes)
    .filter((node) => !String(node?.parentSessionId || "").trim())
    .map((node) => String(node?.sessionId || "").trim())
    .filter(Boolean);

  return {
    roots: Array.from(new Set(roots)),
    nodes,
    updatedAt: tree?.updatedAt || now(),
  };
}
