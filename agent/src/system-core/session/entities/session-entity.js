/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { compactAttachmentRef, compactTransferEnvelopes, dedupeAttachmentRefs } from "../transfer-attachment-refs.js";
import { normalizeTurnStatusesEntity } from "./turn-status-entity.js";

function normalizeTransferEnvelopesFromMessage(message = {}) {
  const seen = new Set();
  const source = Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : [];
  return source.map((item) => compactTransferEnvelopes([item])[0]).filter((item) => {
    if (!item) return false;
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  const normalizedAttachments = Array.isArray(message?.attachments)
    ? dedupeAttachmentRefs(message.attachments.map((item) => compactAttachmentRef(item)).filter(Boolean))
    : [];
  const normalizedMessage = {
    role: String(message?.role || "").trim(),
    content: message?.content || "",
    type: String(message?.type || "").trim(),
    userName: String(message?.userName || "").trim(),
    sessionId: String(message?.sessionId || "").trim(),
    parentSessionId: String(message?.parentSessionId || "").trim(),
    dialogProcessId: resolveMessageDialogProcessId(message),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    turnScopeId: String(message?.turnScopeId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    summarized: message?.summarized === true,
    ts: String(message?.ts || "").trim() || now(),
  };
  if (message?.turnCommit && typeof message.turnCommit === "object" && !Array.isArray(message.turnCommit)) {
    const action = String(message.turnCommit.action || "").trim().toLowerCase();
    const idempotencyKey = String(message.turnCommit.idempotencyKey || "").trim();
    const runState = String(message.turnCommit.runState || "").trim().toLowerCase();
    if (idempotencyKey) {
      normalizedMessage.turnCommit = {
        action: action === "continue" ? "continue" : "send",
        idempotencyKey,
        runState: runState || "pending_start",
      };
      const requestHash = String(message.turnCommit.requestHash || "").trim();
      if (requestHash) normalizedMessage.turnCommit.requestHash = requestHash;
      for (const key of ["resumeDialogProcessId", "resumeTurnScopeId"]) {
        const value = String(message.turnCommit[key] || "").trim();
        if (value) normalizedMessage.turnCommit[key] = value;
      }
    }
  }
  if (normalizedAttachments.length) {
    normalizedMessage.attachments = normalizedAttachments;
  }
  const normalizedTransferEnvelopes = normalizeTransferEnvelopesFromMessage(message);
  if (normalizedTransferEnvelopes.length) {
    normalizedMessage.transferEnvelopes = normalizedTransferEnvelopes;
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
  const messageOrigin = String(message?.messageOrigin || "").trim().toLowerCase();
  if (messageOrigin === "user" || messageOrigin === "internal") {
    normalizedMessage.messageOrigin = messageOrigin;
  }
  if (message?.isMonotonic === true || message?.monotonic === true) {
    normalizedMessage.isMonotonic = true;
    normalizedMessage.monotonic = true;
  }
  const thinkingStartedAt = String(message?.thinkingStartedAt || "").trim();
  if (thinkingStartedAt) normalizedMessage.thinkingStartedAt = thinkingStartedAt;
  const thinkingFinishedAt = String(message?.thinkingFinishedAt || "").trim();
  if (thinkingFinishedAt) normalizedMessage.thinkingFinishedAt = thinkingFinishedAt;
  if (message?.pluginMessage === true) {
    normalizedMessage.pluginMessage = true;
  }
  if (
    message?.pluginMeta &&
    typeof message.pluginMeta === "object" &&
    !Array.isArray(message.pluginMeta)
  ) {
    normalizedMessage.pluginMeta = message.pluginMeta;
  }
  if (Array.isArray(message?.realtimeLogs)) {
    normalizedMessage.realtimeLogs = message.realtimeLogs;
  }
  if (Array.isArray(message?.completedToolLogs)) {
    normalizedMessage.completedToolLogs = message.completedToolLogs;
  }
  for (const key of ["id", "done", "pending", "error"]) {
    if (message?.[key] !== undefined) normalizedMessage[key] = message[key];
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

export function normalizeTurnTimingEntity(timing = {}) {
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) return null;
  const turnScopeId = String(timing?.turnScopeId || "").trim();
  const dialogProcessId = resolveMessageDialogProcessId(timing);
  if (!turnScopeId && !dialogProcessId) return null;
  const thinkingStartedAt = String(timing?.thinkingStartedAt || "").trim();
  const thinkingFinishedAt = String(timing?.thinkingFinishedAt || "").trim();
  const normalized = { turnScopeId, dialogProcessId };
  if (thinkingStartedAt) normalized.thinkingStartedAt = thinkingStartedAt;
  if (thinkingFinishedAt) normalized.thinkingFinishedAt = thinkingFinishedAt;
  return normalized;
}

export function normalizeTurnTimingsEntity(turnTimings = []) {
  const source = Array.isArray(turnTimings)
    ? turnTimings
    : Object.values(turnTimings && typeof turnTimings === "object" ? turnTimings : {});
  const byKey = new Map();
  for (const item of source) {
    const normalized = normalizeTurnTimingEntity(item);
    if (!normalized) continue;
    const key = normalized.turnScopeId || normalized.dialogProcessId;
    byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
  }
  return [...byKey.values()];
}

function normalizeMutationReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : []).map((receipt) => {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
    const operation = String(receipt.operation || "").trim();
    const idempotencyKey = String(receipt.idempotencyKey || "").trim();
    if (!operation || !idempotencyKey) return null;
    return {
      operation,
      idempotencyKey,
      version: Number(receipt.version || 0),
      requestHash: String(receipt.requestHash || "").trim(),
      result: receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result)
        ? receipt.result
        : {},
      committedAt: String(receipt.committedAt || "").trim(),
    };
  }).filter(Boolean).slice(-100);
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
  const normalizedCustomTitle = String(session?.customTitle || "").trim();
  const normalizedMutationReceipts = normalizeMutationReceipts(session?.mutationReceipts || []);
  const normalizedSession = {
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
    turnTimings: normalizeTurnTimingsEntity(session?.turnTimings || []),
    turnStatuses: normalizeTurnStatusesEntity(session?.turnStatuses || [], now),
    selectedConnectors: normalizeSelectedConnectors(session?.selectedConnectors || {}),
    createdAt: String(session?.createdAt || "").trim() || nowValue,
    updatedAt: String(session?.updatedAt || "").trim() || nowValue,
  };
  if (normalizedCustomTitle) normalizedSession.customTitle = normalizedCustomTitle;
  else delete normalizedSession.customTitle;
  if (normalizedMutationReceipts.length) normalizedSession.mutationReceipts = normalizedMutationReceipts;
  else delete normalizedSession.mutationReceipts;
  return normalizedSession;
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
