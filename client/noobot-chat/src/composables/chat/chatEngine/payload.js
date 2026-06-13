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
  locale,
  selectedPlugins,
  uploadHint = "",
} = {}) {
  const normalizedScenario = normalizeTrimmedString(botScenario?.value ?? botScenario);
  return {
    userId: userId?.value ?? userId,
    sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.id,
    message: message || uploadHint,
    attachments,
    config: {
      allowUserInteraction: allowUserInteraction?.value === false ? false : true,
      forceTool: forceTool?.value === true,
      streaming: requestedTextStreaming,
      ...(normalizedScenario ? { scenario: normalizedScenario } : {}),
      locale: normalizeTrimmedString(locale?.value ?? locale),
      selectedConnectors: normalizeSelectedConnectors(
        activeSession?.value?.connectorPanelState?.selectedConnectors || {},
      ),
      selectedPlugins: (Array.isArray(selectedPlugins?.value) ? selectedPlugins.value : [])
        .map((pluginKey) => normalizeTrimmedString(pluginKey))
        .filter(Boolean),
    },
  };
}
