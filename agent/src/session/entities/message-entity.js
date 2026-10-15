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
import { normalizeTurnCommitMetadata } from "@noobot/session-protocol";
import { copyPresentFields } from "./entity-primitives.js";
import {
  dedupeAttachmentsByIdentity,
  parseAttachmentRelations,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { firstText, text } from "@noobot/shared/value";

function normalizeTransferEnvelopesFromMessage(message = {}) {
  return normalizeTransferEnvelopes(compactTransferEnvelopes(message?.transferEnvelopes || []));
}

function normalizeSessionAttachment(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const identity = projectAttachmentIdentity(item);
  const name = text(item.name);
  const mimeType = text(item.mimeType);
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
  const type = text(owner.type);
  const id = text(owner.id);
  if (!type && !id) return null;
  return { ...(type ? { type } : {}), ...(id ? { id } : {}) };
}

function resolveRuntimeMessageId(message = {}, messageUid = "") {
  return firstText(
    message?.messageId,
    message?.additional_kwargs?.noobotMessageId,
    message?.additional_kwargs?.messageId,
    message?.lc_kwargs?.noobotMessageId,
    message?.lc_kwargs?.messageId,
    message?.lc_kwargs?.additional_kwargs?.noobotMessageId,
    message?.lc_kwargs?.additional_kwargs?.messageId,
    messageUid,
  );
}

function createBaseMessageEntity(message, now) {
  return {
    role: text(message?.role),
    content: message?.content || "",
    type: text(message?.type),
    userName: text(message?.userName),
    sessionId: text(message?.sessionId),
    parentSessionId: text(message?.parentSessionId),
    dialogProcessId: resolveContextMessageDialogProcessId(message),
    parentDialogProcessId: text(message?.parentDialogProcessId),
    turnScopeId: text(message?.turnScopeId),
    taskId: text(message?.taskId),
    taskStatus: text(message?.taskStatus),
    modelAlias: text(message?.modelAlias),
    modelName: text(message?.modelName),
    summarized: message?.summarized === true,
    ts: text(message?.ts) || now(),
  };
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
  const injectedBy = text(message?.injectedBy);
  const injectedMessageType = text(message?.injectedMessageType);
  if (injectedBy) target.injectedBy = injectedBy;
  if (injectedMessageType) target.injectedMessageType = injectedMessageType;
  const relayCorrelationId = text(message?.relayCorrelationId);
  if (relayCorrelationId) target.relayCorrelationId = relayCorrelationId;
  const interjectionSequence = Number(message?.interjectionSequence || 0);
  if (Number.isInteger(interjectionSequence) && interjectionSequence > 0) {
    target.interjectionSequence = interjectionSequence;
  }
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
  const presentationMessageId = text(message?.presentationMessageId);
  if (presentationMessageId) target.presentationMessageId = presentationMessageId;
}

function applyChatPresentation(target, message) {
  if (typeof message?.chatPresentation === "boolean") {
    target.chatPresentation = message.chatPresentation;
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
  const thinkingStartedAt = text(message?.thinkingStartedAt);
  const thinkingFinishedAt = text(message?.thinkingFinishedAt);
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
  const toolCallId = text(message?.tool_call_id);
  const toolName = text(message?.toolName || message?.tool_name);
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

  const messageUid = text(message?.messageUid);
  const runtimeMessageId = resolveRuntimeMessageId(message, messageUid);
  const normalizedMessage = createBaseMessageEntity(message, now);
  if (messageUid) normalizedMessage.messageUid = messageUid;
  if (runtimeMessageId) normalizedMessage.messageId = runtimeMessageId;
  const turnCommit = normalizeTurnCommitMetadata(message?.turnCommit);
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
    const messageUid = text(message?.messageUid);
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
