/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { AGENT_COMMAND, createTurnRunCommand } from "@noobot/agent-transport-protocol";
import { buildAgentCommandIdentity } from "./commandIdentity.js";
import { isPlainObject } from "@noobot/shared/value";

function normalizeSelectedPluginKeys(selectedPlugins) {
  return selectedPlugins.value
    .map((pluginKey) => normalizeTrimmedString(pluginKey))
    .filter(Boolean);
}

const plainObjectOrNull = (source) => (isPlainObject(source.value) ? source.value : null);

function buildPreferences(options) {
  const scenario = normalizeTrimmedString(options.botScenario.value);
  const selectedModel = normalizeTrimmedString(options.selectedModel.value);
  const memoryModel = normalizeTrimmedString(options.memoryModel.value);
  const pluginModelConfig = plainObjectOrNull(options.pluginModelConfig);
  const summaryPolicy = plainObjectOrNull(options.summaryPolicy);
  return {
    allowUserInteraction: options.allowUserInteraction.value,
    safeConfirm: options.safeConfirm.value,
    sanitizeOutput: options.sanitizeOutput.value,
    safeConfirmLevel: options.safeConfirmLevel.value,
    streaming: options.requestedTextStreaming,
    frontendThresholdsEnabled: options.frontendThresholdsEnabled.value,
    ...(scenario ? { scenario } : {}),
    ...(selectedModel ? { selectedModel } : {}),
    ...(memoryModel ? { memoryModel } : {}),
    ...(pluginModelConfig ? { pluginModelConfig } : {}),
    ...(summaryPolicy ? { summaryPolicy } : {}),
    locale: normalizeTrimmedString(options.locale.value),
    selectedPlugins: normalizeSelectedPluginKeys(options.selectedPlugins),
  };
}

function buildSessionBlock({ activeSession, commandType }) {
  const createsLocalSession =
    commandType === AGENT_COMMAND.SEND && activeSession.value.isLocal === true;
  return {
    createIfAbsent: createsLocalSession,
    selectedConnectorIds: createsLocalSession
      ? activeSession.value.connectorPanelState.selectedConnectorIds
      : [],
  };
}

function buildIdentity({ activeSession, request }) {
  return buildAgentCommandIdentity(request.commandType, {
    channel: activeSession.value,
    turn: { dialogProcessId: request.dialogProcessId, turnScopeId: request.turnScopeId },
  });
}

export function buildChatPayload({
  request,
  activeSession,
  attachments,
  requestedTextStreaming,
  expectedAggregateVersion,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  frontendThresholdsEnabled,
  summaryPolicy,
  locale,
  selectedPlugins,
}) {
  const { commandType } = request;
  return createTurnRunCommand({
    commandType,
    identity: buildIdentity({ activeSession, request }),
    input: { message: request.messageText, attachments },
    preferences: buildPreferences({
      allowUserInteraction,
      safeConfirm,
      safeConfirmLevel,
      sanitizeOutput,
      requestedTextStreaming,
      frontendThresholdsEnabled,
      botScenario,
      selectedModel,
      memoryModel,
      pluginModelConfig,
      summaryPolicy,
      locale,
      selectedPlugins,
    }),
    presentation: {
      userMessageId: request.userMessageId,
      presentationMessageId: request.presentationMessageId,
    },
    concurrency: {
      expectedTurnRevision: 0,
      expectedAggregateVersion,
    },
    session: buildSessionBlock({ activeSession, commandType }),
    ...(commandType === AGENT_COMMAND.CONTINUE ? { continuation: request.continuation } : {}),
  });
}
