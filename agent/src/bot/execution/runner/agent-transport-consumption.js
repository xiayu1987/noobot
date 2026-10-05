/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const clean = (value = "") => String(value ?? "").trim();
const stringList = (value = []) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);

const countOf = (value) => (Array.isArray(value) ? value.length : 0);

function summarizeIdentity(identity) {
  return {
    sessionId: clean(identity?.sessionId),
    parentSessionId: clean(identity?.parentSessionId),
    dialogProcessId: clean(identity?.dialogProcessId),
    parentDialogProcessId: clean(identity?.parentDialogProcessId),
    turnScopeId: clean(identity?.turnScopeId),
  };
}

function summarizeInput({
  normalizedMessage,
  requestedAttachments,
  canonicalAttachments,
  currentUserMessage,
}) {
  const requestedMessageLength = String(normalizedMessage ?? "").length;
  const persistedMessageLength = String(currentUserMessage?.content ?? "").length;
  return {
    requestedMessageLength,
    persistedMessageLength,
    messageConsumed: requestedMessageLength === persistedMessageLength,
    requestedAttachmentCount: countOf(requestedAttachments),
    canonicalAttachmentCount: countOf(canonicalAttachments),
    persistedAttachmentCount: countOf(currentUserMessage?.attachments),
  };
}

function pluginModelConfigKeys(pluginModelConfig) {
  return Object.keys(
    pluginModelConfig && typeof pluginModelConfig === "object" ? pluginModelConfig : {},
  ).sort();
}

function summarizePreferences(resolvedRunConfig) {
  return {
    allowUserInteraction: resolvedRunConfig?.allowUserInteraction !== false,
    sanitizeOutput: resolvedRunConfig?.sanitizeOutput !== false,
    streaming: Object.hasOwn(resolvedRunConfig || {}, "streaming")
      ? resolvedRunConfig.streaming === true
      : null,
    confirmationLevel: normalizeSecurityRiskLevel(resolvedRunConfig?.safeConfirmLevel),
    locale: clean(resolvedRunConfig?.locale),
    scenario: clean(resolvedRunConfig?.scenario),
    selectedModel: clean(resolvedRunConfig?.selectedModel),
    memoryModel: clean(resolvedRunConfig?.memoryModel),
    selectedPlugins: stringList(resolvedRunConfig?.selectedPlugins),
    pluginModelConfigKeys: pluginModelConfigKeys(resolvedRunConfig?.pluginModelConfig),
    selectedConnectorIds: stringList(resolvedRunConfig?.selectedConnectorIds),
  };
}

function summarizePresentation({ currentUserMessage, resolvedRunConfig, dispatchRuntime }) {
  const persistedUserMessageId = clean(currentUserMessage?.messageId || currentUserMessage?.id);
  const requestedUserMessageId = clean(resolvedRunConfig?.userMessageId);
  const requestedAssistantMessageId = clean(resolvedRunConfig?.presentationMessageId);
  const messageEventStream = dispatchRuntime?.systemRuntime?.messageEventStream;
  const boundAssistantMessageId = clean(
    messageEventStream?.presentationMessageId ||
      messageEventStream?.activePresentationMessageId ||
      requestedAssistantMessageId,
  );
  return {
    requestedUserMessageId,
    persistedUserMessageId,
    userMessageIdConsumed:
      Boolean(requestedUserMessageId) && requestedUserMessageId === persistedUserMessageId,
    requestedAssistantMessageId,
    boundAssistantMessageId,
    assistantMessageIdConsumed:
      Boolean(requestedAssistantMessageId) &&
      requestedAssistantMessageId === boundAssistantMessageId,
  };
}

function summarizeConcurrency({ resolvedRunConfig, turnCommand, committedTurnResult }) {
  const expectedAggregateVersion = resolvedRunConfig?.expectedAggregateVersion;
  return {
    commandId: clean(turnCommand?.commandId || resolvedRunConfig?.commandId),
    commandIdConsumed: Boolean(clean(turnCommand?.commandId)),
    expectedAggregateVersion: expectedAggregateVersion ?? null,
    expectedAggregateVersionConsumed:
      expectedAggregateVersion === turnCommand?.expectedAggregateVersion,
    committedAggregateVersion: Number(committedTurnResult?.aggregateVersion || 0) || null,
  };
}

export function buildAgentTransportConsumption({
  transportCommand = {},
  identity = {},
  normalizedMessage = "",
  requestedAttachments = [],
  canonicalAttachments = [],
  currentUserMessage = null,
  resolvedRunConfig = {},
  turnCommand = null,
  committedTurnResult = null,
  dispatchRuntime = null,
} = {}) {
  return {
    protocolVersion: Number(transportCommand?.protocolVersion) || null,
    commandType: clean(transportCommand?.commandType).toLowerCase(),
    commandId: clean(transportCommand?.commandId),
    consumer: "agent",
    identity: summarizeIdentity(identity),
    input: summarizeInput({
      normalizedMessage,
      requestedAttachments,
      canonicalAttachments,
      currentUserMessage,
    }),
    preferences: summarizePreferences(resolvedRunConfig),
    presentation: summarizePresentation({ currentUserMessage, resolvedRunConfig, dispatchRuntime }),
    concurrency: summarizeConcurrency({ resolvedRunConfig, turnCommand, committedTurnResult }),
  };
}
