/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";

export function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => connectorType),
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
    dialogProcessId: resolveMessageDialogProcessId(message),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    summarized: message?.summarized === true,
    ts: String(message?.ts || "").trim() || now(),
  };
  if (normalizedAttachmentMetas.length) {
    normalizedMessage.attachmentMetas = normalizedAttachmentMetas;
  }
  if (message?.transferEnvelope && typeof message.transferEnvelope === "object" && !Array.isArray(message.transferEnvelope)) {
    normalizedMessage.transferEnvelope = message.transferEnvelope;
  }
  if (Array.isArray(message?.transferEnvelopes) && message.transferEnvelopes.length) {
    normalizedMessage.transferEnvelopes = message.transferEnvelopes.filter(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (message?.injectedMessage === true) {
    normalizedMessage.injectedMessage = true;
  }
  if (String(message?.injectedBy || "").trim()) {
    normalizedMessage.injectedBy = String(message.injectedBy || "").trim();
  }
  if (String(message?.injectedMessageType || message?.injected_message_type || "").trim()) {
    normalizedMessage.injectedMessageType = String(
      message.injectedMessageType || message.injected_message_type || "",
    ).trim();
  }
  if (message?.frontendUserMessage === true) {
    normalizedMessage.frontendUserMessage = true;
  }
  if (message?.workflowMessage === true) {
    normalizedMessage.workflowMessage = true;
  }
  if (
    message?.workflowMeta &&
    typeof message.workflowMeta === "object" &&
    !Array.isArray(message.workflowMeta)
  ) {
    normalizedMessage.workflowMeta = message.workflowMeta;
  }

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

export function normalizeSessionEntity(
  session = {},
  {
    now = () => new Date().toISOString(),
    sessionId = "",
    parentSessionId = "",
  } = {},
) {
  const nowValue = now();
  const normalizedSessionId = String(session?.sessionId || sessionId || "").trim();
  const normalizedParentSessionId = String(
    session?.parentSessionId || parentSessionId || "",
  ).trim();
  const normalizedShortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
    ...(session && typeof session === "object" ? session : {}),
    sessionId: normalizedSessionId,
    parentSessionId: normalizedParentSessionId,
    caller: String(session?.caller || "user").trim() || "user",
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: String(session?.currentTaskId || "").trim(),
    shortMemoryCheckpoint: Number.isFinite(normalizedShortMemoryCheckpoint)
      ? normalizedShortMemoryCheckpoint
      : 0,
    messages: normalizeMessagesEntity(session?.messages || [], now),
    selectedConnectors: normalizeSelectedConnectors(session?.selectedConnectors || {}),
    createdAt: String(session?.createdAt || "").trim() || nowValue,
    updatedAt: String(session?.updatedAt || "").trim() || nowValue,
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
