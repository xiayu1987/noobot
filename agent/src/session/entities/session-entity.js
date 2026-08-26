/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { createSessionMessageUid } from "../../context/session/message-uid.js";
import { compactTransferEnvelopes } from "../transfer-attachment-refs.js";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol";
import { assertSessionAggregateInvariants } from "@noobot/session-protocol";
import { normalizeDialogOrderEntity } from "./dialog-order-entity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import {
  dedupeAttachmentsByIdentity,
  parseAttachmentRelations,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function normalizeTransferEnvelopesFromMessage(message = {}) {
  return normalizeTransferEnvelopes(compactTransferEnvelopes(message?.transferEnvelopes || []));
}

function normalizeMessageUid(value = "") {
  return String(value || "").trim();
}

function normalizeTextField(value = "") {
  return String(value || "").trim();
}

function firstTextField(values = []) {
  for (const value of values) {
    const normalized = normalizeTextField(value);
    if (normalized) return normalized;
  }
  return "";
}

function objectRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeSessionAttachment(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const identity = projectAttachmentIdentity(item);
  const name = String(item.name || "").trim();
  const mimeType = String(item.mimeType || "").trim();
  if (!name || !mimeType) return null;
  const normalized = { ...identity, name, mimeType };
  copyPresentFields(normalized, item, [
    "size",
    "relativePath",
    "sandboxPath",
    "path",
    "previewUrl",
    "downloadUrl",
    "isSandbox",
    "generationSource",
  ]);
  const relations = parseAttachmentRelations(item.relations);
  if (relations.length) normalized.relations = relations;
  const owner = normalizeAttachmentOwner(item.owner);
  if (owner) normalized.owner = owner;
  return normalized;
}

function copyPresentFields(target, source, keys = []) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      target[key] = source[key];
    }
  }
}

function normalizeAttachmentOwner(owner = null) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return null;
  const type = String(owner.type || "").trim();
  const id = String(owner.id || "").trim();
  if (!type && !id) return null;
  return { ...(type ? { type } : {}), ...(id ? { id } : {}) };
}

function resolveRuntimeMessageId(message = {}, messageUid = "") {
  return firstTextField([
    message?.messageId || message?.id,
    message?.additional_kwargs?.noobotMessageId,
    message?.additional_kwargs?.messageId,
    message?.lc_kwargs?.noobotMessageId,
    message?.lc_kwargs?.messageId,
    message?.lc_kwargs?.additional_kwargs?.noobotMessageId,
    message?.lc_kwargs?.additional_kwargs?.messageId,
    messageUid,
  ]);
}

function createBaseMessageEntity(message, now) {
  return {
    role: normalizeTextField(message?.role),
    content: message?.content || "",
    type: normalizeTextField(message?.type),
    userName: normalizeTextField(message?.userName),
    sessionId: normalizeTextField(message?.sessionId),
    parentSessionId: normalizeTextField(message?.parentSessionId),
    dialogProcessId: resolveContextMessageDialogProcessId(message),
    parentDialogProcessId: normalizeTextField(message?.parentDialogProcessId),
    turnScopeId: normalizeTextField(message?.turnScopeId),
    taskId: normalizeTextField(message?.taskId),
    taskStatus: normalizeTextField(message?.taskStatus),
    modelAlias: normalizeTextField(message?.modelAlias),
    modelName: normalizeTextField(message?.modelName),
    summarized: message?.summarized === true,
    ts: normalizeTextField(message?.ts) || now(),
  };
}

function normalizeTurnCommit(turnCommit = null) {
  if (!turnCommit || typeof turnCommit !== "object" || Array.isArray(turnCommit)) return null;
  const commandId = String(turnCommit.commandId || "").trim();
  if (!commandId) return null;
  const action = String(turnCommit.action || "")
    .trim()
    .toLowerCase();
  const runState = String(turnCommit.runState || "")
    .trim()
    .toLowerCase();
  const normalized = {
    action: action === "continue" ? "continue" : "send",
    commandId,
    runState: runState || "pending_start",
  };
  const requestHash = String(turnCommit.requestHash || "").trim();
  if (requestHash) normalized.requestHash = requestHash;
  for (const key of ["resumeDialogProcessId", "resumeTurnScopeId"]) {
    const value = String(turnCommit[key] || "").trim();
    if (value) normalized[key] = value;
  }
  return normalized;
}

function applyMessageArtifacts(target, message, attachments) {
  if (attachments.length) target.attachments = attachments;
  const transferEnvelopes = normalizeTransferEnvelopesFromMessage(message);
  if (transferEnvelopes.length) target.transferEnvelopes = transferEnvelopes;
}

function applyMessageInjection(target, message) {
  if (message?.injectedMessage === true) target.injectedMessage = true;
  const internalType = String(
    message?.noobotInternalMessageType ||
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType) target.noobotInternalMessageType = internalType;
  const injectedBy = String(message?.injectedBy || "").trim();
  const injectedMessageType = String(message?.injectedMessageType || "").trim();
  if (injectedBy) target.injectedBy = injectedBy;
  if (injectedMessageType) target.injectedMessageType = injectedMessageType;
}

function applyMessagePresentation(target, message) {
  const origin = String(message?.messageOrigin || "")
    .trim()
    .toLowerCase();
  if (origin === "natural" || origin === "internal") target.messageOrigin = origin;
  if (target.role === "user") target.userMetaMaterialized = message?.userMetaMaterialized === true;
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (presentationMessageId) target.presentationMessageId = presentationMessageId;
  if (typeof message?.chatPresentation === "boolean") {
    target.chatPresentation = message.chatPresentation;
  } else if (target.type === "context_control") {
    // Context-control messages are model-only by protocol. Keep the
    // invariant when normalizing artifacts written before the field was
    // persisted by the turn message service.
    target.chatPresentation = false;
  }
  if (Array.isArray(message?.activityTimeline)) target.activityTimeline = message.activityTimeline;
  if (Array.isArray(message?.toolTimeline)) target.toolTimeline = message.toolTimeline;
  if (message?.isMonotonic === true || message?.monotonic === true) {
    target.isMonotonic = true;
    target.monotonic = true;
  }
}

function applyMessageRuntimeFields(target, message) {
  const thinkingStartedAt = String(message?.thinkingStartedAt || "").trim();
  const thinkingFinishedAt = String(message?.thinkingFinishedAt || "").trim();
  if (thinkingStartedAt) target.thinkingStartedAt = thinkingStartedAt;
  if (thinkingFinishedAt) target.thinkingFinishedAt = thinkingFinishedAt;
  if (message?.pluginMessage === true) target.pluginMessage = true;
  if (
    message?.pluginMeta &&
    typeof message.pluginMeta === "object" &&
    !Array.isArray(message.pluginMeta)
  ) {
    target.pluginMeta = message.pluginMeta;
  }
  for (const key of ["done", "pending", "error"]) {
    if (message?.[key] !== undefined) target[key] = message[key];
  }
}

function applyMessageToolFields(target, message) {
  const toolCallId = String(message?.tool_call_id || "").trim();
  const toolName = String(message?.toolName || message?.tool_name || "").trim();
  const contextPolicy = resolveToolContextPolicy(message);
  if (toolCallId) target.tool_call_id = toolCallId;
  if (toolName) target.toolName = toolName;
  if (contextPolicy) target.contextPolicy = contextPolicy;
  if (Array.isArray(message?.tool_calls)) target.tool_calls = message.tool_calls;
  if (target.type === "tool_call" && !Array.isArray(target.tool_calls)) target.tool_calls = [];
}

export { createSessionMessageUid };

export function normalizeMessageEntity(message = {}, now = () => new Date().toISOString()) {
  const normalizedAttachments = Array.isArray(message?.attachments)
    ? dedupeAttachmentsByIdentity(
        message.attachments.map(normalizeSessionAttachment).filter(Boolean),
      )
    : [];
  // Provider/runtime IDs may be scoped to one model run. They are retained for
  // streaming correlation, while messageUid is the persistence identity.
  const messageUid = normalizeMessageUid(message?.messageUid);
  const runtimeMessageId = resolveRuntimeMessageId(message, messageUid);
  const normalizedMessage = createBaseMessageEntity(message, now);
  if (messageUid) normalizedMessage.messageUid = messageUid;
  if (runtimeMessageId) {
    normalizedMessage.id = runtimeMessageId;
    normalizedMessage.messageId = runtimeMessageId;
  }
  const turnCommit = normalizeTurnCommit(message?.turnCommit);
  if (turnCommit) normalizedMessage.turnCommit = turnCommit;
  applyMessageArtifacts(normalizedMessage, message, normalizedAttachments);
  applyMessageInjection(normalizedMessage, message);
  applyMessagePresentation(normalizedMessage, message);
  applyMessageRuntimeFields(normalizedMessage, message);
  applyMessageToolFields(normalizedMessage, message);
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
  const dialogProcessId = resolveContextMessageDialogProcessId(timing);
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
            resolveContextMessageDialogProcessId(message) === dialogProcessId &&
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

function resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId }) {
  const nowValue = now();
  const shortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
    nowValue,
    sessionId: firstTextField([session?.sessionId, sessionId]),
    parentSessionId: firstTextField([session?.parentSessionId, parentSessionId]),
    customTitle: normalizeTextField(session?.customTitle),
    shortMemoryCheckpoint: Number.isFinite(shortMemoryCheckpoint) ? shortMemoryCheckpoint : 0,
  };
}

function createNormalizedSessionEntity(session, context, messages) {
  return {
    ...objectRecord(session),
    sessionId: context.sessionId,
    parentSessionId: context.parentSessionId,
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    caller: firstTextField([session?.caller, "user"]),
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: normalizeTextField(session?.currentTaskId),
    shortMemoryCheckpoint: context.shortMemoryCheckpoint,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session?.dialogOrder || [], messages),
    turnTimings: normalizeTurnTimingsEntity(session?.turnTimings || []),
    turnLifecycle: normalizeTurnLifecycleEntity(session?.turnLifecycle || {}),
    authorityEventOutbox: normalizeAuthorityEventOutbox(session?.authorityEventOutbox || []),
    selectedConnectorIds: normalizeSelectedConnectorIds(session?.selectedConnectorIds),
    createdAt: firstTextField([session?.createdAt, context.nowValue]),
    updatedAt: firstTextField([session?.updatedAt, context.nowValue]),
  };
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
  const context = resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId });
  const normalizedMessages = normalizeMessagesEntity(session?.messages || [], now, {
    sessionId: context.sessionId,
  });
  const normalizedTurnSummaryCheckpoints = normalizeTurnSummaryCheckpoints(
    session?.turnSummaryCheckpoints || {},
    normalizedMessages,
  );
  const normalizedSession = createNormalizedSessionEntity(session, context, normalizedMessages);
  if (context.customTitle) normalizedSession.customTitle = context.customTitle;
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
