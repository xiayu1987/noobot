/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../../../shared/models/sessionModel";
import { normalizeTrimmedString } from "./utils";

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
  userId,
  activeSession,
  message,
  attachments = [],
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  requestedTextStreaming = true,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  locale,
  selectedPlugins,
  uploadHint = "",
  reuseExistingUserTurn = false,
  turnScopeId = "",
  action = "",
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
  thinkingStartedAt = "",
  expectedVersion = undefined,
  idempotencyKey = "",
} = {}) {
  const normalizedScenario = normalizeTrimmedString(botScenario?.value ?? botScenario);
  const normalizedSelectedModel = normalizeTrimmedString(selectedModel?.value ?? selectedModel);
  const normalizedMemoryModel = normalizeTrimmedString(memoryModel?.value ?? memoryModel);
  const normalizedPluginModelConfig = pluginModelConfig?.value ?? pluginModelConfig;
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  const normalizedAction = normalizeTrimmedString(action);
  const normalizedResumeDialogProcessId = normalizeTrimmedString(resumeDialogProcessId);
  const normalizedResumeTurnScopeId = normalizeTrimmedString(resumeTurnScopeId);
  const normalizedThinkingStartedAt = normalizeTrimmedString(thinkingStartedAt);
  return {
    ...(normalizedAction ? { action: normalizedAction } : {}),
    userId: userId?.value ?? userId,
    sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.sessionId || activeSession?.value?.id,
    turnScopeId: normalizedTurnScopeId,
    idempotencyKey: normalizeTrimmedString(idempotencyKey) || normalizedTurnScopeId,
    ...(expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "" ? { expectedVersion } : {}),
    message: message || uploadHint,
    attachments,
    config: {
      allowUserInteraction: (allowUserInteraction?.value ?? allowUserInteraction) === false ? false : true,
      safeConfirm: (safeConfirm?.value ?? safeConfirm) === false ? false : true,
      sanitizeOutput: (sanitizeOutput?.value ?? sanitizeOutput) === false ? false : true,
      safeConfirmLevel: ["low", "medium", "high", "critical"].includes(String((safeConfirmLevel?.value ?? safeConfirmLevel) || "").trim().toLowerCase())
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
      ...(normalizedThinkingStartedAt ? { thinkingStartedAt: normalizedThinkingStartedAt } : {}),
      ...(normalizedResumeDialogProcessId ? { resumeDialogProcessId: normalizedResumeDialogProcessId } : {}),
      ...(normalizedResumeTurnScopeId ? {
        resumeTurnScopeId: normalizedResumeTurnScopeId,
        stoppedTurnScopeId: normalizedResumeTurnScopeId,
      } : {}),
      ...(reuseExistingUserTurn ? {
        reuseExistingUserTurn: true,
      } : {}),
    },
  };
}
