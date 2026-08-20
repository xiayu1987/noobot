/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { AGENT_COMMAND, createTurnRunCommand } from "@noobot/agent-transport-protocol";
import {
  SECURITY_RISK_LEVEL,
  normalizeSecurityRiskLevel,
} from "@noobot/security-assessment-protocol";

function normalizeSelectedPluginKeys(selectedPlugins) {
  const source = Array.isArray(selectedPlugins?.value)
    ? selectedPlugins.value
    : Array.isArray(selectedPlugins)
      ? selectedPlugins
      : [];
  return source.map((pluginKey) => normalizeTrimmedString(pluginKey)).filter(Boolean);
}

export function buildChatPayload({
  activeSession,
  message,
  attachments = [],
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  requestedTextStreaming = false,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  frontendThresholdsEnabled = false,
  summaryPolicy,
  locale,
  selectedPlugins,
  uploadHint = "",
  reuseExistingUserTurn = false,
  dialogProcessId = "",
  turnScopeId = "",
  userMessageId = "",
  assistantMessageId = "",
  continueFromStopped = false,
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
  expectedAggregateVersion = 0,
  commandId = "",
} = {}) {
  const normalizedScenario = normalizeTrimmedString(botScenario?.value ?? botScenario);
  const normalizedSelectedModel = normalizeTrimmedString(selectedModel?.value ?? selectedModel);
  const normalizedMemoryModel = normalizeTrimmedString(memoryModel?.value ?? memoryModel);
  const normalizedPluginModelConfig = pluginModelConfig?.value ?? pluginModelConfig;
  const normalizedSummaryPolicy = summaryPolicy?.value ?? summaryPolicy;
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  const normalizedUserMessageId = normalizeTrimmedString(userMessageId);
  const normalizedAssistantMessageId = normalizeTrimmedString(assistantMessageId);
  const normalizedResumeDialogProcessId = normalizeTrimmedString(resumeDialogProcessId);
  const normalizedResumeTurnScopeId = normalizeTrimmedString(resumeTurnScopeId);
  const commandType = continueFromStopped
    ? AGENT_COMMAND.CONTINUE
    : reuseExistingUserTurn
      ? AGENT_COMMAND.RESEND
      : AGENT_COMMAND.SEND;
  return createTurnRunCommand({
    commandType,
    commandId: normalizeTrimmedString(commandId) || normalizedTurnScopeId,
    identity: {
      sessionId: activeSession?.value?.sessionId,
      parentSessionId: activeSession?.value?.parentSessionId,
      dialogProcessId: normalizeTrimmedString(dialogProcessId),
      parentDialogProcessId: activeSession?.value?.parentDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
    },
    input: { message: message || uploadHint, attachments },
    preferences: {
      allowUserInteraction:
        (allowUserInteraction?.value ?? allowUserInteraction) === false ? false : true,
      safeConfirm: (safeConfirm?.value ?? safeConfirm) === false ? false : true,
      sanitizeOutput: (sanitizeOutput?.value ?? sanitizeOutput) === false ? false : true,
      confirmationLevel: normalizeSecurityRiskLevel(
        safeConfirmLevel?.value ?? safeConfirmLevel,
        SECURITY_RISK_LEVEL.LOW,
      ),
      streaming: requestedTextStreaming,
      frontendThresholdsEnabled:
        (frontendThresholdsEnabled?.value ?? frontendThresholdsEnabled) === true,
      ...(normalizedScenario ? { scenario: normalizedScenario } : {}),
      ...(normalizedSelectedModel ? { selectedModel: normalizedSelectedModel } : {}),
      ...(normalizedMemoryModel ? { memoryModel: normalizedMemoryModel } : {}),
      ...(normalizedPluginModelConfig &&
      typeof normalizedPluginModelConfig === "object" &&
      !Array.isArray(normalizedPluginModelConfig)
        ? { pluginModelConfig: normalizedPluginModelConfig }
        : {}),
      ...(normalizedSummaryPolicy &&
      typeof normalizedSummaryPolicy === "object" &&
      !Array.isArray(normalizedSummaryPolicy)
        ? { summaryPolicy: normalizedSummaryPolicy }
        : {}),
      locale: normalizeTrimmedString(locale?.value ?? locale),
      selectedPlugins: normalizeSelectedPluginKeys(selectedPlugins),
    },
    presentation: {
      userMessageId: normalizedUserMessageId,
      assistantMessageId: normalizedAssistantMessageId,
    },
    concurrency: {
      expectedTurnRevision: 0,
      expectedAggregateVersion,
    },
    session: {
      createIfAbsent: commandType === AGENT_COMMAND.SEND && activeSession?.value?.isLocal === true,
    },
    continuation: {
      dialogProcessId: normalizedResumeDialogProcessId,
      turnScopeId: normalizedResumeTurnScopeId,
    },
  });
}
