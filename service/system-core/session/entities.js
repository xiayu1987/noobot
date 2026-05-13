/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Session entity normalization.
 * Execution log entity moved to ../tracking/execution-log/execution-log-entities.js
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
    summarized: message?.summarized === true,
    attachmentMetas: normalizedAttachmentMetas,
    ts: String(message?.ts || "").trim() || now(),
  };
  const toolCallId = String(message?.tool_call_id || "").trim();
  const toolName = String(message?.toolName || message?.tool_name || "").trim();
  if (toolCallId) normalizedMessage.tool_call_id = toolCallId;
  if (toolName) normalizedMessage.toolName = toolName;
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

// Backward-compatible re-export from tracking module
export { normalizeExecutionLogEntity } from "../tracking/execution-log/execution-log-entities.js";

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
