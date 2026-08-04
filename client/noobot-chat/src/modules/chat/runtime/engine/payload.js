/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../../../session/model/sessionModel.js";
import { normalizeTrimmedString } from "./utils.js";
import {
  AGENT_COMMAND,
  createTurnRunCommand,
} from "@noobot/agent-transport-protocol";

function normalizeSelectedPluginKeys(selectedPlugins) {
  const source = Array.isArray(selectedPlugins?.value)
    ? selectedPlugins.value
    : Array.isArray(selectedPlugins)
      ? selectedPlugins
      : [];
  return source
    .map((pluginKey) => normalizeTrimmedString(pluginKey))
    .filter(Boolean);
}

export function buildChatPayload({
  activeSession,
  message,
  attachments = [],
  allowUserInteraction,
  safeConfirmLevel,
  sanitizeOutput,
  requestedTextStreaming = false,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  locale,
  selectedPlugins,
  uploadHint = "",
  reuseExistingUserTurn = false,
  turnScopeId = "",
  userMessageId = "",
  assistantMessageId = "",
  continueFromStopped = false,
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
  expectedSessionVersion = 0,
  idempotencyKey = "",
} = {}) {
  const normalizedScenario = normalizeTrimmedString(botScenario?.value ?? botScenario);
  const normalizedSelectedModel = normalizeTrimmedString(selectedModel?.value ?? selectedModel);
  const normalizedMemoryModel = normalizeTrimmedString(memoryModel?.value ?? memoryModel);
  const normalizedPluginModelConfig = pluginModelConfig?.value ?? pluginModelConfig;
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
    commandId: normalizeTrimmedString(idempotencyKey) || normalizedTurnScopeId,
    identity: {
      sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.sessionId || activeSession?.value?.id,
      parentSessionId: activeSession?.value?.parentSessionId,
      parentDialogProcessId: activeSession?.value?.parentDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
    },
    input: { message: message || uploadHint, attachments },
    preferences: {
      allowUserInteraction: (allowUserInteraction?.value ?? allowUserInteraction) === false ? false : true,
      sanitizeOutput: (sanitizeOutput?.value ?? sanitizeOutput) === false ? false : true,
      confirmationLevel: ["low", "medium", "high", "critical"].includes(String((safeConfirmLevel?.value ?? safeConfirmLevel) || "").trim().toLowerCase())
        ? String(safeConfirmLevel?.value ?? safeConfirmLevel).trim().toLowerCase()
        : "low",
      streaming: requestedTextStreaming,
      ...(normalizedScenario ? { scenario: normalizedScenario } : {}),
      ...(normalizedSelectedModel ? { selectedModel: normalizedSelectedModel } : {}),
      ...(normalizedMemoryModel ? { memoryModel: normalizedMemoryModel } : {}),
      ...(normalizedPluginModelConfig && typeof normalizedPluginModelConfig === "object" && !Array.isArray(normalizedPluginModelConfig)
        ? { pluginModelConfig: normalizedPluginModelConfig }
        : {}),
      locale: normalizeTrimmedString(locale?.value ?? locale),
      selectedConnectors: normalizeSelectedConnectors(
        activeSession?.value?.connectorPanelState?.selectedConnectors || {},
      ),
      selectedPlugins: normalizeSelectedPluginKeys(selectedPlugins),
    },
    presentation: {
      userMessageId: normalizedUserMessageId,
      assistantMessageId: normalizedAssistantMessageId,
    },
    concurrency: {
      idempotencyKey: normalizeTrimmedString(idempotencyKey) || normalizedTurnScopeId,
      expectedTurnRevision: 0,
      expectedSessionVersion,
    },
    session: {
      createIfAbsent: !normalizeTrimmedString(activeSession?.value?.backendSessionId),
    },
    continuation: {
      dialogProcessId: normalizedResumeDialogProcessId,
      turnScopeId: normalizedResumeTurnScopeId,
    },
  });
}
