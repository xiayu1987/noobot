/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isDeepStrictEqual } from "node:util";
import {
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { projectResourceRef } from "@noobot/path-resolver";
import { assertMutationRef } from "@noobot/file-mutation-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { SessionCommitInputError } from "@noobot/session-protocol/session-changes";
import {
  assertSessionMessageEntity,
  assertSessionMessageMetadata,
  normalizeTurnCommitMetadata,
  projectSessionMessageRecordIdentity,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { deepFreeze, isDeepFrozen } from "@noobot/shared/deep-freeze";
import { isObjectLike, isPlainObject, text } from "@noobot/shared/value";

function normalizeTransferEnvelopesFromMessage(message) {
  return normalizeTransferEnvelopes(compactTransferEnvelopes(message.transferEnvelopes));
}

function createBaseMessageEntity(message) {
  return {
    role: text(message?.role),
    content: message.content,
    type: text(message?.type),
    userName: text(message?.userName),
    sessionId: message.sessionId,
    parentSessionId: text(message?.parentSessionId),
    dialogProcessId: resolveSessionMessageRecordDialogProcessId(message),
    parentDialogProcessId: text(message?.parentDialogProcessId),
    turnScopeId: text(message?.turnScopeId),
    modelAlias: text(message?.modelAlias),
    modelName: text(message?.modelName),
    summarized: message?.summarized === true,
    ts: message.ts,
  };
}

function applyMessageArtifacts(target, message, attachments) {
  target.attachments = attachments;
  const transferEnvelopes = normalizeTransferEnvelopesFromMessage(message);
  if (transferEnvelopes.length) target.transferEnvelopes = transferEnvelopes;
  applyMessageMutationRefs(target, message);
  if (message?.resourceRefs === undefined) return;
  if (!Array.isArray(message.resourceRefs)) {
    throw new SessionCommitInputError("session message resourceRefs must be an array");
  }
  if (message.resourceRefs.length) {
    target.resourceRefs = message.resourceRefs.map((item) => projectResourceRef(item));
  }
}

function applyMessageMutationRefs(target, message) {
  if (message?.mutationRefs === undefined) return;
  if (!Array.isArray(message.mutationRefs)) {
    throw new SessionCommitInputError("session message mutationRefs must be an array");
  }
  if (message.mutationRefs.length) {
    target.mutationRefs = message.mutationRefs.map((item) => assertMutationRef(item));
  }
}

function applyMessageInjection(target, message) {
  if (message?.injectedMessage === true) target.injectedMessage = true;
  const internalType = text(message?.noobotInternalMessageType);
  if (internalType) target.noobotInternalMessageType = internalType;
  const injectedBy = text(message?.injectedBy);
  const injectedMessageType = text(message?.injectedMessageType);
  if (injectedBy) target.injectedBy = injectedBy;
  if (injectedMessageType) target.injectedMessageType = injectedMessageType;
  const relayCorrelationId = text(message?.relayCorrelationId);
  if (relayCorrelationId) target.relayCorrelationId = relayCorrelationId;
  const { interjectionSequence } = message;
  if (interjectionSequence === undefined) return;
  if (!Number.isInteger(interjectionSequence) || interjectionSequence <= 0) {
    throw new SessionCommitInputError("interjectionSequence must be a positive integer");
  }
  target.interjectionSequence = interjectionSequence;
}

function applyMessageOrigin(target, message) {
  if (Object.hasOwn(message, "messageOrigin")) target.messageOrigin = message.messageOrigin;
}

function applyUserMetaParsedResults(target, message) {
  if (target.role !== "user") return;
  if (Array.isArray(message?.userMetaParsedResults) && message.userMetaParsedResults.length) {
    target.userMetaParsedResults = message.userMetaParsedResults;
  }
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
  if (message?.isMonotonic === true) target.isMonotonic = true;
}

function applyMessagePresentation(target, message) {
  applyMessageOrigin(target, message);
  applyUserMetaParsedResults(target, message);
  applyPresentationIdentity(target, message);
  applyChatPresentation(target, message);
  if (message.workspaceRootDirectory !== undefined)
    target.workspaceRootDirectory = message.workspaceRootDirectory;
  applyMessageTimelines(target, message);
  applyMessageMonotonicity(target, message);
}

function applyMessagePluginFields(target, message) {
  if (message?.pluginMessage === true) target.pluginMessage = true;
  if (isPlainObject(message?.pluginMeta)) {
    target.pluginMeta = message.pluginMeta;
  }
}

function applyAnthropicMessageContent(target, message) {
  if (target.role === "assistant" && Array.isArray(message?.rawModelContent)) {
    target.rawModelContent = message.rawModelContent.map((block) =>
      isObjectLike(block) ? { ...block } : block,
    );
  }
}

function applyOpenAiMessageMetadata(target, message) {
  if (
    target.role === "assistant" &&
    isPlainObject(message?.modelAdditionalKwargs?.reasoning) &&
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
      (item) => isObjectLike(item) && typeof item.type === "string",
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
  applyMessagePluginFields(target, message);
  applyAnthropicMessageContent(target, message);
  applyOpenAiMessageMetadata(target, message);
  applyMessageCompletionFields(target, message);
}

function applyMessageToolFields(target, message) {
  const toolCallId = text(message?.tool_call_id);
  const toolName = text(message?.toolName);
  const contextPolicy = resolveToolContextPolicy(message);
  if (toolCallId) target.tool_call_id = toolCallId;
  if (toolName) target.toolName = toolName;
  if (contextPolicy) target.contextPolicy = contextPolicy;
  if (Object.hasOwn(message, "tool_calls")) target.tool_calls = message.tool_calls;
}

function buildMessageEntity(message) {
  const normalizedAttachments = dedupeSessionAttachmentRefs(message.attachments);
  const identity = projectSessionMessageRecordIdentity(message);
  const normalizedMessage = Object.assign(createBaseMessageEntity(message), identity);
  const turnCommit = normalizeTurnCommitMetadata(message?.turnCommit);
  if (turnCommit) normalizedMessage.turnCommit = turnCommit;
  applyMessageArtifacts(normalizedMessage, message, normalizedAttachments);
  applyMessageInjection(normalizedMessage, message);
  applyMessagePresentation(normalizedMessage, message);
  applyMessageRuntimeFields(normalizedMessage, message);
  applyMessageToolFields(normalizedMessage, message);
  return normalizedMessage;
}

export function normalizeMessageMetadataEntity({ value, parts }) {
  assertSessionMessageMetadata({ value, parts });
  const normalized = { ...value, message: buildMessageEntity(value.message) };
  for (const { path } of parts) normalized.message[path[1]] = value.message[path[1]];
  assertSessionMessageMetadata({ value: normalized, parts });
  return normalized;
}

const normalizedImmutableMessages = new WeakMap();

export function normalizeMessageEntity(message) {
  if (!isDeepFrozen(message)) return assertSessionMessageEntity(buildMessageEntity(message));
  let normalized = normalizedImmutableMessages.get(message);
  if (!normalized) {
    normalized = assertSessionMessageEntity(buildMessageEntity(message));
    if (
      isDeepStrictEqual(normalized, message) &&
      JSON.stringify(normalized) === JSON.stringify(message)
    )
      normalized = message;
    else normalized = deepFreeze(normalized);
    normalizedImmutableMessages.set(message, normalized);
    normalizedImmutableMessages.set(normalized, normalized);
  }
  return normalized;
}

export function normalizeMessagesEntity(messages) {
  return messages.map((messageItem) => normalizeMessageEntity(messageItem));
}
