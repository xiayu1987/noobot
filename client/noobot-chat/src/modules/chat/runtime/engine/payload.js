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

const unwrap = (source) => source?.value ?? source;
const trueUnlessFalse = (source) => unwrap(source) !== false;
const plainObjectOrNull = (source) => {
  const value = unwrap(source);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
};

function resolveCommandType({ continueFromStopped, reuseExistingUserTurn }) {
  if (continueFromStopped) return AGENT_COMMAND.CONTINUE;
  if (reuseExistingUserTurn) return AGENT_COMMAND.RESEND;
  return AGENT_COMMAND.SEND;
}

function buildPreferences(options) {
  const scenario = normalizeTrimmedString(unwrap(options.botScenario));
  const selectedModel = normalizeTrimmedString(unwrap(options.selectedModel));
  const memoryModel = normalizeTrimmedString(unwrap(options.memoryModel));
  const pluginModelConfig = plainObjectOrNull(options.pluginModelConfig);
  const summaryPolicy = plainObjectOrNull(options.summaryPolicy);
  return {
    allowUserInteraction: trueUnlessFalse(options.allowUserInteraction),
    safeConfirm: trueUnlessFalse(options.safeConfirm),
    sanitizeOutput: trueUnlessFalse(options.sanitizeOutput),
    confirmationLevel: normalizeSecurityRiskLevel(
      unwrap(options.safeConfirmLevel),
      SECURITY_RISK_LEVEL.LOW,
    ),
    streaming: options.requestedTextStreaming,
    frontendThresholdsEnabled: unwrap(options.frontendThresholdsEnabled) === true,
    ...(scenario ? { scenario } : {}),
    ...(selectedModel ? { selectedModel } : {}),
    ...(memoryModel ? { memoryModel } : {}),
    ...(pluginModelConfig ? { pluginModelConfig } : {}),
    ...(summaryPolicy ? { summaryPolicy } : {}),
    locale: normalizeTrimmedString(unwrap(options.locale)),
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
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  const commandType = resolveCommandType({ continueFromStopped, reuseExistingUserTurn });
  return createTurnRunCommand({
    commandType,
    commandId: normalizeTrimmedString(commandId) || normalizedTurnScopeId,
    identity: buildIdentity({
      activeSession,
      dialogProcessId,
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
      assistantMessageId: normalizeTrimmedString(assistantMessageId),
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
