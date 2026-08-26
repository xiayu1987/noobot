/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { persistSessionArtifactSnapshot } from "../../session/session-artifact-store.js";
import { resolveMessageRole } from "@noobot/context-protocol/policy/message";
import {
  projectContextMessageIdentityMetadata,
  resolveContextMessageContent,
  resolveContextMessageFlags,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";
import { getTransferAttachments } from "../../transfer-adapter/storage/consumer.js";
import {
  getMessageId,
  isInjectedMessage,
  readMessageField,
  resolveInjectedMessageType,
} from "@noobot/context-protocol";

export function normalizePluginSelectorSet(keys = []) {
  return new Set(normalizeTrimmedStringList(keys));
}

export function resolvePluginOptionsFromConfig(sourceConfig = {}, pluginSelectors = new Set()) {
  const plugins =
    sourceConfig?.plugins && typeof sourceConfig.plugins === "object" ? sourceConfig.plugins : {};
  const merged = {};
  for (const selector of pluginSelectors) {
    const item = plugins?.[selector];
    if (!item || typeof item !== "object") continue;
    Object.assign(merged, item);
  }
  return merged;
}

export function normalizeMessageForModelRuntime(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (!role) return null;
  const content = resolveContextMessageContent(messageItem);
  const normalized = {
    role,
    content: role === "tool" ? compactToolResultTextForModel(content) : content,
    summarized: resolveContextMessageFlags(messageItem).summarized,
  };
  const noobotMessageId = getMessageId(messageItem);
  if (noobotMessageId) {
    normalized.additional_kwargs = {
      ...(normalized.additional_kwargs || {}),
      noobotMessageId,
    };
  }
  const toolCalls = resolveContextToolCalls(messageItem);
  if (toolCalls.length) normalized.tool_calls = toolCalls;
  const toolCallId = resolveContextToolCallId(messageItem);
  if (toolCallId) normalized.tool_call_id = toolCallId;
  const internalType = String(
    messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.metadata?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType) {
    normalized.additional_kwargs = {
      ...(normalized.additional_kwargs || {}),
      noobotInternalMessageType: internalType,
    };
  }
  Object.assign(normalized, projectContextMessageIdentityMetadata(messageItem));
  return applyNormalizedMessageFlags(normalized, messageItem);
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveTransferEnvelopesFromMessage(message = {}) {
  return resolveTransferEnvelopeListFromMessage(message);
}

export function resolveTransferEnvelopeListFromMessage(message = {}) {
  const transferEnvelopes = [
    ...(Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : []),
    ...(Array.isArray(message?.lc_kwargs?.transferEnvelopes)
      ? message.lc_kwargs.transferEnvelopes
      : []),
  ].filter(isPlainObject);
  return transferEnvelopes;
}

export function resolvePreferredAttachments(message = {}) {
  const transferAttachments = getTransferAttachments(resolveTransferEnvelopesFromMessage(message));
  if (transferAttachments.length) return transferAttachments;
  if (Array.isArray(message?.attachments)) return message.attachments;
  if (Array.isArray(message?.lc_kwargs?.attachments)) return message.lc_kwargs.attachments;
  return [];
}

export function normalizeTrimmedStringList(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function applyNormalizedMessageFlags(normalized = {}, messageItem = {}) {
  if (isInjectedMessage(messageItem)) {
    normalized.injectedMessage = true;
  }
  const injectedBy = readMessageField(messageItem, "injectedBy");
  if (injectedBy) normalized.injectedBy = injectedBy;
  const injectedMessageType = resolveInjectedMessageType(messageItem);
  if (injectedMessageType) normalized.injectedMessageType = injectedMessageType;
  if (readMessageField(messageItem, "messageOrigin").toLowerCase() === "natural") {
    normalized.messageOrigin = "natural";
    normalized.userMetaMaterialized =
      messageItem?.userMetaMaterialized === true ||
      readMessageField(messageItem, "userMetaMaterialized").toLowerCase() === "true";
  }
  return normalized;
}

export function selectHookManager({ runConfig = {}, managerKey = "", createManager = null } = {}) {
  if (runConfig?.[managerKey] && typeof runConfig[managerKey] === "object") {
    return runConfig[managerKey];
  }
  return typeof createManager === "function" ? createManager() : null;
}

export async function persistSnapshotJsonFiles({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionPayload = {},
  metadata = null,
  now = undefined,
  mutationCoordinator = undefined,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  return persistSessionArtifactSnapshot({
    outputDir,
    sessionPayload,
    taskPayload,
    executionPayload,
    metadata,
    mutationCoordinator,
    mutationLockDir,
    assertSessionWritable,
    ...(typeof now === "function" ? { now } : {}),
  });
}
