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
import { isPlainObject } from "@noobot/shared/value";

function normalizeSelectedPluginKeys(selectedPlugins) {
  return selectedPlugins.value
    .map((pluginKey) => normalizeTrimmedString(pluginKey))
    .filter(Boolean);
}

const trueUnlessFalse = (source) => source.value !== false;
const plainObjectOrNull = (source) => (isPlainObject(source.value) ? source.value : null);

function resolveCommandType({ continueFromStopped, reuseExistingUserTurn }) {
  if (continueFromStopped) return AGENT_COMMAND.CONTINUE;
  if (reuseExistingUserTurn) return AGENT_COMMAND.RESEND;
  return AGENT_COMMAND.SEND;
}

function buildPreferences(options) {
  const scenario = normalizeTrimmedString(options.botScenario.value);
  const selectedModel = normalizeTrimmedString(options.selectedModel.value);
  const memoryModel = normalizeTrimmedString(options.memoryModel.value);
  const pluginModelConfig = plainObjectOrNull(options.pluginModelConfig);
  const summaryPolicy = plainObjectOrNull(options.summaryPolicy);
  return {
    allowUserInteraction: trueUnlessFalse(options.allowUserInteraction),
    safeConfirm: trueUnlessFalse(options.safeConfirm),
    sanitizeOutput: trueUnlessFalse(options.sanitizeOutput),
    confirmationLevel: normalizeSecurityRiskLevel(
      options.safeConfirmLevel.value,
      SECURITY_RISK_LEVEL.LOW,
    ),
    streaming: options.requestedTextStreaming,
    frontendThresholdsEnabled: options.frontendThresholdsEnabled.value === true,
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
    commandType === AGENT_COMMAND.SEND && activeSession?.value?.isLocal === true;
  return {
    createIfAbsent: createsLocalSession,
    selectedConnectorIds: createsLocalSession
      ? activeSession.value.connectorPanelState?.selectedConnectorIds || []
      : [],
  };
}

function buildIdentity({ activeSession, dialogProcessId, turnScopeId }) {
  return {
    sessionId: activeSession?.value?.sessionId,
    parentSessionId: activeSession?.value?.parentSessionId,
    dialogProcessId: normalizeTrimmedString(dialogProcessId),
    parentDialogProcessId: activeSession?.value?.parentDialogProcessId,
    turnScopeId,
  };
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
  frontendThresholdsEnabled,
  summaryPolicy,
  locale,
  selectedPlugins,
  uploadHint = "",
  reuseExistingUserTurn = false,
  dialogProcessId = "",
  turnScopeId = "",
  userMessageId = "",
  presentationMessageId = "",
  continueFromStopped = false,
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
  expectedAggregateVersion,
} = {}) {
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  const commandType = resolveCommandType({ continueFromStopped, reuseExistingUserTurn });
  return createTurnRunCommand({
    commandType,
    identity: buildIdentity({
      activeSession,
      dialogProcessId: commandType === AGENT_COMMAND.RESEND ? dialogProcessId : "",
      turnScopeId: normalizedTurnScopeId,
    }),
    input: { message: message || uploadHint, attachments },
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
      userMessageId: normalizeTrimmedString(userMessageId),
      presentationMessageId: normalizeTrimmedString(presentationMessageId),
    },
    concurrency: {
      expectedTurnRevision: 0,
      expectedAggregateVersion,
    },
    session: buildSessionBlock({ activeSession, commandType }),
    continuation: {
      dialogProcessId: normalizeTrimmedString(resumeDialogProcessId),
      turnScopeId: normalizeTrimmedString(resumeTurnScopeId),
    },
  });
}
