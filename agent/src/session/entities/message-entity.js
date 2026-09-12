/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageOrigin,
  resolveContextUserMetaMaterialized,
} from "@noobot/context-protocol/message/codec";
import { compactTransferEnvelopes } from "../transfer-attachment-refs.js";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import {
  copyPresentFields,
  firstTextField,
  normalizeTextField,
} from "./entity-primitives.js";
import {
  dedupeAttachmentsByIdentity,
  parseAttachmentRelations,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function normalizeTransferEnvelopesFromMessage(message = {}) {
  return normalizeTransferEnvelopes(compactTransferEnvelopes(message?.transferEnvelopes || []));
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
  const internalType = readContextMessageField(message, "noobotInternalMessageType");
  if (internalType) target.noobotInternalMessageType = internalType;
  const injectedBy = String(message?.injectedBy || "").trim();
  const injectedMessageType = String(message?.injectedMessageType || "").trim();
  if (injectedBy) target.injectedBy = injectedBy;
  if (injectedMessageType) target.injectedMessageType = injectedMessageType;
  const relayCorrelationId = String(message?.relayCorrelationId || "").trim();
  if (relayCorrelationId) target.relayCorrelationId = relayCorrelationId;
}

function applyMessageOrigin(target, message) {
  const origin = resolveContextMessageOrigin(message);
  if (origin === "natural" || origin === "internal") target.messageOrigin = origin;
}

function applyUserMetaMaterialized(target, message) {
  if (target.role === "user")
    target.userMetaMaterialized = resolveContextUserMetaMaterialized(message);
}

function applyPresentationIdentity(target, message) {
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (presentationMessageId) target.presentationMessageId = presentationMessageId;
}

function applyChatPresentation(target, message) {
  if (typeof message?.chatPresentation === "boolean") {
    target.chatPresentation = message.chatPresentation;
  } else if (target.type === "context_control") {
    target.chatPresentation = false;
  }
}

function applyMessageTimelines(target, message) {
  if (Array.isArray(message?.activityTimeline)) target.activityTimeline = message.activityTimeline;
  if (Array.isArray(message?.toolTimeline)) target.toolTimeline = message.toolTimeline;
}

function applyMessageMonotonicity(target, message) {
  if (message?.isMonotonic === true || message?.monotonic === true) {
    target.isMonotonic = true;
    target.monotonic = true;
  }
}

function applyMessagePresentation(target, message) {
  applyMessageOrigin(target, message);
  applyUserMetaMaterialized(target, message);
  applyPresentationIdentity(target, message);
  applyChatPresentation(target, message);
  applyMessageTimelines(target, message);
  applyMessageMonotonicity(target, message);
}

function applyMessageThinkingTiming(target, message) {
  const thinkingStartedAt = String(message?.thinkingStartedAt || "").trim();
  const thinkingFinishedAt = String(message?.thinkingFinishedAt || "").trim();
  if (thinkingStartedAt) target.thinkingStartedAt = thinkingStartedAt;
  if (thinkingFinishedAt) target.thinkingFinishedAt = thinkingFinishedAt;
}

function applyMessagePluginFields(target, message) {
  if (message?.pluginMessage === true) target.pluginMessage = true;
  if (
    message?.pluginMeta &&
    typeof message.pluginMeta === "object" &&
    !Array.isArray(message.pluginMeta)
  ) {
    target.pluginMeta = message.pluginMeta;
  }
}

function applyAnthropicMessageContent(target, message) {
  if (target.role === "assistant" && Array.isArray(message?.rawModelContent)) {
    target.rawModelContent = message.rawModelContent.map((block) =>
      block && typeof block === "object" ? { ...block } : block,
    );
  }
}

function applyOpenAiMessageMetadata(target, message) {
  if (
    target.role === "assistant" &&
    message?.modelAdditionalKwargs?.reasoning &&
    typeof message.modelAdditionalKwargs.reasoning === "object" &&
    !Array.isArray(message.modelAdditionalKwargs.reasoning) &&
    message.modelAdditionalKwargs.reasoning.type === "reasoning"
  ) {
    target.modelAdditionalKwargs = {
      reasoning: { ...message.modelAdditionalKwargs.reasoning },
    };
  }
  if (
    target.role === "assistant" &&
    Array.isArray(message?.modelResponseMetadata?.output) &&
    message.modelResponseMetadata.output.every(
      (item) => item && typeof item === "object" && typeof item.type === "string",
    )
  ) {
    target.modelResponseMetadata = {
      output: message.modelResponseMetadata.output.map((item) => ({ ...item })),
    };
  }
}

function applyMessageCompletionFields(target, message) {
  for (const key of ["done", "pending", "error"]) {
    if (message?.[key] !== undefined) target[key] = message[key];
  }
}

function applyMessageRuntimeFields(target, message) {
  applyMessageThinkingTiming(target, message);
  applyMessagePluginFields(target, message);
  applyAnthropicMessageContent(target, message);
  applyOpenAiMessageMetadata(target, message);
  applyMessageCompletionFields(target, message);
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


export function normalizeMessageEntity(message = {}, now = () => new Date().toISOString()) {
  const normalizedAttachments = Array.isArray(message?.attachments)
    ? dedupeAttachmentsByIdentity(
        message.attachments.map(normalizeSessionAttachment).filter(Boolean),
      )
    : [];

  const messageUid = normalizeTextField(message?.messageUid);
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
    const messageUid = normalizeTextField(message?.messageUid);
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
