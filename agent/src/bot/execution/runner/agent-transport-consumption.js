/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const clean = (value = "") => String(value ?? "").trim();
const stringList = (value = []) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);

function selectedModelValue(value) {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.value || value.alias || value.key || value.model);
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
  const persistedUserMessageId = clean(currentUserMessage?.messageId || currentUserMessage?.id);
  const requestedUserMessageId = clean(resolvedRunConfig?.userMessageId);
  const requestedAssistantMessageId = clean(resolvedRunConfig?.presentationMessageId);
  const boundAssistantMessageId = clean(
    dispatchRuntime?.systemRuntime?.messageEventStream?.presentationMessageId ||
      dispatchRuntime?.systemRuntime?.messageEventStream?.activePresentationMessageId ||
      requestedAssistantMessageId,
  );
  const requestedMessageLength = String(normalizedMessage ?? "").length;
  const persistedMessageLength = String(currentUserMessage?.content ?? "").length;
  const expectedAggregateVersion = resolvedRunConfig?.expectedAggregateVersion;
  const commandExpectedAggregateVersion = turnCommand?.expectedAggregateVersion;

  return {
    protocolVersion: Number(transportCommand?.protocolVersion) || null,
    commandType: clean(transportCommand?.commandType).toLowerCase(),
    commandId: clean(transportCommand?.commandId),
    consumer: "agent",
    identity: {
      sessionId: clean(identity?.sessionId),
      parentSessionId: clean(identity?.parentSessionId),
      dialogProcessId: clean(identity?.dialogProcessId),
      parentDialogProcessId: clean(identity?.parentDialogProcessId),
      turnScopeId: clean(identity?.turnScopeId),
    },
    input: {
      requestedMessageLength,
      persistedMessageLength,
      messageConsumed: requestedMessageLength === persistedMessageLength,
      requestedAttachmentCount: Array.isArray(requestedAttachments)
        ? requestedAttachments.length
        : 0,
      canonicalAttachmentCount: Array.isArray(canonicalAttachments)
        ? canonicalAttachments.length
        : 0,
      persistedAttachmentCount: Array.isArray(currentUserMessage?.attachments)
        ? currentUserMessage.attachments.length
        : 0,
    },
    preferences: {
      allowUserInteraction: resolvedRunConfig?.allowUserInteraction !== false,
      sanitizeOutput: resolvedRunConfig?.sanitizeOutput !== false,
      streaming: Object.hasOwn(resolvedRunConfig || {}, "streaming")
        ? resolvedRunConfig.streaming === true
        : null,
      confirmationLevel: normalizeSecurityRiskLevel(resolvedRunConfig?.safeConfirmLevel),
      locale: clean(resolvedRunConfig?.locale),
      scenario: clean(resolvedRunConfig?.scenario),
      selectedModel: selectedModelValue(resolvedRunConfig?.selectedModel),
      memoryModel: clean(resolvedRunConfig?.memoryModel),
      selectedPlugins: stringList(resolvedRunConfig?.selectedPlugins),
      pluginModelConfigKeys: Object.keys(
        resolvedRunConfig?.pluginModelConfig &&
          typeof resolvedRunConfig.pluginModelConfig === "object"
          ? resolvedRunConfig.pluginModelConfig
          : {},
      ).sort(),
      selectedConnectorIds: stringList(resolvedRunConfig?.selectedConnectorIds),
    },
    presentation: {
      requestedUserMessageId,
      persistedUserMessageId,
      userMessageIdConsumed:
        Boolean(requestedUserMessageId) && requestedUserMessageId === persistedUserMessageId,
      requestedAssistantMessageId,
      boundAssistantMessageId,
      assistantMessageIdConsumed:
        Boolean(requestedAssistantMessageId) &&
        requestedAssistantMessageId === boundAssistantMessageId,
    },
    concurrency: {
      commandId: clean(turnCommand?.commandId || resolvedRunConfig?.commandId),
      commandIdConsumed: Boolean(clean(turnCommand?.commandId)),
      expectedAggregateVersion: expectedAggregateVersion ?? null,
      expectedAggregateVersionConsumed:
        expectedAggregateVersion === commandExpectedAggregateVersion,
      committedAggregateVersion: Number(committedTurnResult?.aggregateVersion || 0) || null,
    },
  };
}
