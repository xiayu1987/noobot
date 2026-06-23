/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../../../shared/models/sessionModel";
import { normalizeTrimmedString } from "./utils";

export function buildChatPayload({
  userId,
  activeSession,
  message,
  attachments = [],
  allowUserInteraction,
  forceTool,
  requestedTextStreaming = true,
  botScenario,
  selectedModel,
  pluginModelConfig,
  locale,
  selectedPlugins,
  uploadHint = "",
  reuseExistingUserTurn = false,
  existingUserTurnId = "",
  existingUserMessageId = "",
  turnScopeId = "",
} = {}) {
  const normalizedScenario = normalizeTrimmedString(botScenario?.value ?? botScenario);
  const normalizedSelectedModel = normalizeTrimmedString(selectedModel?.value ?? selectedModel);
  const normalizedPluginModelConfig = pluginModelConfig?.value ?? pluginModelConfig;
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  return {
    userId: userId?.value ?? userId,
    sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.sessionId || activeSession?.value?.id,
    turnScopeId: normalizedTurnScopeId,
    message: message || uploadHint,
    attachments,
    config: {
      allowUserInteraction: allowUserInteraction?.value === false ? false : true,
      forceTool: forceTool?.value === true,
      streaming: requestedTextStreaming,
      ...(normalizedScenario ? { scenario: normalizedScenario } : {}),
      ...(normalizedSelectedModel ? { selectedModel: normalizedSelectedModel } : {}),
      ...(normalizedPluginModelConfig && typeof normalizedPluginModelConfig === "object" && !Array.isArray(normalizedPluginModelConfig)
        ? { pluginModelConfig: normalizedPluginModelConfig }
        : {}),
      locale: normalizeTrimmedString(locale?.value ?? locale),
      selectedConnectors: normalizeSelectedConnectors(
        activeSession?.value?.connectorPanelState?.selectedConnectors || {},
      ),
      selectedPlugins: (Array.isArray(selectedPlugins?.value) ? selectedPlugins.value : [])
        .map((pluginKey) => normalizeTrimmedString(pluginKey))
        .filter(Boolean),
      ...(reuseExistingUserTurn ? {
        reuseExistingUserTurn: true,
        existingUserTurnId: normalizeTrimmedString(existingUserTurnId),
        existingUserMessageId: normalizeTrimmedString(existingUserMessageId),
      } : {}),
    },
  };
}
