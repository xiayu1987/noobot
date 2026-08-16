/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { createSessionMessageUid } from "../../context/session/message-uid.js";
import { compactTransferEnvelopes } from "../transfer-attachment-refs.js";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol";
import { assertSessionAggregateInvariants } from "@noobot/session-protocol";
import { normalizeDialogOrderEntity } from "./dialog-order-entity.js";

function normalizeTransferEnvelopesFromMessage(message = {}) {
  const seen = new Set();
  const source = Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : [];
  return source
    .map((item) => compactTransferEnvelopes([item])[0])
    .filter((item) => {
      if (!item) return false;
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMessageUid(value = "") {
  return String(value || "").trim();
}

function normalizeSessionAttachment(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const attachmentId = String(item.attachmentId || "").trim();
  const name = String(item.name || item.fileName || item.filename || "").trim();
  const mimeType = String(item.mimeType || item.type || item.mime || "").trim();
  if (!attachmentId || !name || !mimeType) return null;
  const normalized = { attachmentId, name, mimeType };
  for (const key of [
    "size",
    "attachmentSource",
    "sessionId",
    "relativePath",
    "sandboxPath",
    "path",
    "previewUrl",
    "downloadUrl",
    "isSandbox",
    "generationSource",
    "parsedResult",
  ]) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "")
      normalized[key] = item[key];
  }
  if (item.owner && typeof item.owner === "object" && !Array.isArray(item.owner)) {
    const type = String(item.owner.type || "").trim();
    const id = String(item.owner.id || "").trim();
    if (type || id) normalized.owner = { ...(type ? { type } : {}), ...(id ? { id } : {}) };
  }
  return normalized;
}

export { createSessionMessageUid };

export function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object" ? selectedConnectors : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => connectorType),
  );
}

export function normalizeMessageEntity(message = {}, now = () => new Date().toISOString()) {
  const attachmentKeys = new Set();
  const normalizedAttachments = Array.isArray(message?.attachments)
    ? message.attachments.map(normalizeSessionAttachment).filter((item) => {
        if (!item) return false;
        const key = `${item.sessionId || ""}:${item.attachmentSource || ""}:${item.attachmentId}`;
        if (attachmentKeys.has(key)) return false;
        attachmentKeys.add(key);
        return true;
      })
    : [];
  // Provider/runtime IDs may be scoped to one model run. They are retained for
  // streaming correlation, while messageUid is the persistence identity.
  const messageUid = normalizeMessageUid(message?.messageUid);
  const runtimeMessageId = String(
    message?.messageId ||
      message?.id ||
      message?.additional_kwargs?.noobotMessageId ||
      message?.additional_kwargs?.messageId ||
      message?.lc_kwargs?.noobotMessageId ||
      message?.lc_kwargs?.messageId ||
      message?.lc_kwargs?.additional_kwargs?.noobotMessageId ||
      message?.lc_kwargs?.additional_kwargs?.messageId ||
      messageUid ||
      "",
  ).trim();
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
  if (messageUid) normalizedMessage.messageUid = messageUid;
  if (runtimeMessageId) {
    normalizedMessage.id = runtimeMessageId;
    normalizedMessage.messageId = runtimeMessageId;
  }
  if (
    message?.turnCommit &&
    typeof message.turnCommit === "object" &&
    !Array.isArray(message.turnCommit)
  ) {
    const action = String(message.turnCommit.action || "")
      .trim()
      .toLowerCase();
    const commandId = String(message.turnCommit.commandId || "").trim();
    const runState = String(message.turnCommit.runState || "")
      .trim()
      .toLowerCase();
    if (commandId) {
      normalizedMessage.turnCommit = {
        action: action === "continue" ? "continue" : "send",
        commandId,
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
  const noobotInternalMessageType = String(
    message?.noobotInternalMessageType ||
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      "",
  ).trim();
  if (noobotInternalMessageType) {
    normalizedMessage.noobotInternalMessageType = noobotInternalMessageType;
  }
  if (String(message?.injectedBy || "").trim()) {
    normalizedMessage.injectedBy = String(message.injectedBy || "").trim();
  }
  if (String(message?.injectedMessageType || "").trim()) {
    normalizedMessage.injectedMessageType = String(message.injectedMessageType).trim();
  }
  if (message?.frontendUserMessage === true) {
    normalizedMessage.frontendUserMessage = true;
  }
  const messageOrigin = String(message?.messageOrigin || "")
    .trim()
    .toLowerCase();
  if (messageOrigin === "user" || messageOrigin === "internal") {
    normalizedMessage.messageOrigin = messageOrigin;
  }
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (presentationMessageId) normalizedMessage.presentationMessageId = presentationMessageId;
  if (message?.chatPresentation === true || message?.chatPresentation === false) {
    normalizedMessage.chatPresentation = message.chatPresentation === true;
  }
  if (Array.isArray(message?.activityTimeline)) {
    normalizedMessage.activityTimeline = message.activityTimeline;
  }
  if (Array.isArray(message?.toolTimeline)) {
    normalizedMessage.toolTimeline = message.toolTimeline;
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
  for (const key of ["done", "pending", "error"]) {
    if (message?.[key] !== undefined) normalizedMessage[key] = message[key];
  }
  const toolCallId = String(message?.tool_call_id || "").trim();
  const toolName = String(message?.toolName || message?.tool_name || "").trim();
  if (toolCallId) normalizedMessage.tool_call_id = toolCallId;
  if (toolName) normalizedMessage.toolName = toolName;
  if (Array.isArray(message?.tool_calls)) {
    normalizedMessage.tool_calls = message.tool_calls;
  }
  if (normalizedMessage.type === "tool_call" && !Array.isArray(normalizedMessage.tool_calls)) {
    normalizedMessage.tool_calls = [];
  }
  return normalizedMessage;
}

export function normalizeMessagesEntity(
  messages = [],
  now = () => new Date().toISOString(),
  { sessionId = "" } = {},
) {
  return (messages || []).map((messageItem, index) => {
    const normalized = normalizeMessageEntity(messageItem, now);
    if (!normalized.messageUid) {
      const error = new TypeError(`session message is missing messageUid at index ${index}`);
      error.code = "SESSION_MESSAGE_UID_MISSING";
      throw error;
    }
    return normalized;
  });
}

export function assertSessionMessageIdentityInvariants(messages = []) {
  const seen = new Set();
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    const messageUid = normalizeMessageUid(message?.messageUid);
    if (!messageUid) {
      const error = new Error(`session message is missing messageUid at index ${index}`);
      error.code = "SESSION_MESSAGE_UID_MISSING";
      throw error;
    }
    if (seen.has(messageUid)) {
      const error = new Error(`duplicate session messageUid: ${messageUid}`);
      error.code = "SESSION_MESSAGE_UID_DUPLICATE";
      error.messageUid = messageUid;
      throw error;
    }
    seen.add(messageUid);
  }
  return true;
}

export function normalizeTurnTimingEntity(timing = {}) {
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) return null;
  const turnScopeId = String(timing?.turnScopeId || "").trim();
  const dialogProcessId = resolveMessageDialogProcessId(timing);
  if (!turnScopeId) return null;
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
    const key = normalized.turnScopeId;
    byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
  }
  return [...byKey.values()];
}

function normalizeTurnSummaryCheckpoints(checkpoints = {}, messages = []) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) return {};
  const normalized = {};
  for (const [scopeKey, value] of Object.entries(checkpoints)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const turnScopeId = String(value.turnScopeId || scopeKey || "").trim();
    const dialogProcessId = String(value.dialogProcessId || "").trim();
    if (!turnScopeId || !dialogProcessId) continue;
    const checkpointRevision = Math.max(0, Number(value.checkpointRevision) || 0);
    const sessionMessages = Array.isArray(messages) ? messages : [];
    const allMessageUids = new Set(
      sessionMessages.map((message) => String(message?.messageUid || "").trim()).filter(Boolean),
    );
    const ownedMessageUids = new Set(
      sessionMessages
        .filter(
          (message) =>
            resolveMessageDialogProcessId(message) === dialogProcessId &&
            String(message?.turnScopeId || "").trim() === turnScopeId,
        )
        .map((message) => String(message?.messageUid || "").trim())
        .filter(Boolean),
    );
    if (!ownedMessageUids.size) continue;
    const receipts = (Array.isArray(value.receipts) ? value.receipts : [])
      .map((receipt) => {
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
        const checkpointId = String(receipt.checkpointId || "").trim();
        const requestHash = String(receipt.requestHash || "").trim();
        if (!checkpointId || !requestHash) return null;
        const persistedMessageUids = [
          ...new Set(
            (Array.isArray(receipt.persistedMessageUids) ? receipt.persistedMessageUids : [])
              .map((uid) => String(uid || "").trim())
              .filter(Boolean),
          ),
        ];
        const summarizedMessageUids = [
          ...new Set(
            (Array.isArray(receipt.summarizedMessageUids) ? receipt.summarizedMessageUids : [])
              .map((uid) => String(uid || "").trim())
              .filter(Boolean),
          ),
        ];
        if (persistedMessageUids.some((uid) => !ownedMessageUids.has(uid))) return null;
        if (summarizedMessageUids.some((uid) => !allMessageUids.has(uid))) return null;
        return {
          checkpointId,
          checkpointRevision: Math.max(0, Number(receipt.checkpointRevision) || 0),
          requestHash,
          persistedMessageUids,
          summarizedMessageUids,
          markedCount: Math.max(0, Number(receipt.markedCount) || 0),
          committedAt: String(receipt.committedAt || "").trim(),
        };
      })
      .filter(Boolean)
      .slice(-50);
    normalized[turnScopeId] = {
      dialogProcessId,
      turnScopeId,
      checkpointRevision,
      receipts,
    };
  }
  return normalized;
}

export function normalizeSessionEntity(
  session = {},
  { now = () => new Date().toISOString(), sessionId = "", parentSessionId = "" } = {},
) {
  if ("version" in session || "revision" in session) {
    throw new TypeError(
      "legacy session version fields are not supported; run the session protocol migration",
    );
  }
  assertSessionAggregateInvariants(session);
  const nowValue = now();
  const normalizedSessionId = String(session?.sessionId || sessionId || "").trim();
  const normalizedParentSessionId = String(
    session?.parentSessionId || parentSessionId || "",
  ).trim();
  const normalizedShortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  const normalizedCustomTitle = String(session?.customTitle || "").trim();
  const normalizedMessages = normalizeMessagesEntity(session?.messages || [], now, {
    sessionId: normalizedSessionId,
  });
  const normalizedTurnSummaryCheckpoints = normalizeTurnSummaryCheckpoints(
    session?.turnSummaryCheckpoints || {},
    normalizedMessages,
  );
  const normalizedSession = {
    ...(session && typeof session === "object" ? session : {}),
    sessionId: normalizedSessionId,
    parentSessionId: normalizedParentSessionId,
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    caller: String(session?.caller || "user").trim() || "user",
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: String(session?.currentTaskId || "").trim(),
    shortMemoryCheckpoint: Number.isFinite(normalizedShortMemoryCheckpoint)
      ? normalizedShortMemoryCheckpoint
      : 0,
    messages: normalizedMessages,
    dialogOrder: normalizeDialogOrderEntity(session?.dialogOrder || [], normalizedMessages),
    turnTimings: normalizeTurnTimingsEntity(session?.turnTimings || []),
    turnLifecycle: normalizeTurnLifecycleEntity(session?.turnLifecycle || {}),
    authorityEventOutbox: normalizeAuthorityEventOutbox(session?.authorityEventOutbox || []),
    selectedConnectors: normalizeSelectedConnectors(session?.selectedConnectors || {}),
    createdAt: String(session?.createdAt || "").trim() || nowValue,
    updatedAt: String(session?.updatedAt || "").trim() || nowValue,
  };
  if (normalizedCustomTitle) normalizedSession.customTitle = normalizedCustomTitle;
  else delete normalizedSession.customTitle;
  if (Object.keys(normalizedTurnSummaryCheckpoints).length) {
    normalizedSession.turnSummaryCheckpoints = normalizedTurnSummaryCheckpoints;
  } else {
    delete normalizedSession.turnSummaryCheckpoints;
  }
  delete normalizedSession.turnTerminalCommits;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree = {}, now = () => new Date().toISOString()) {
  const nodes = tree?.nodes && typeof tree.nodes === "object" ? { ...tree.nodes } : {};
  for (const [nodeId, node] of Object.entries(nodes)) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId) {
      delete nodes[nodeId];
      continue;
    }
    const normalizedChildren = Array.isArray(node?.children)
      ? Array.from(
          new Set(node.children.map((childId) => String(childId || "").trim()).filter(Boolean)),
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
