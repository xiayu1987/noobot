/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { text } from "@noobot/shared/value";

export async function resolveAuthoritativeConnectorSelection({
  bot,
  connectorAccessPort,
  request,
} = {}) {
  const userId = text(request?.userId);
  const sessionId = text(request?.sessionId);
  if (
    !userId ||
    !sessionId ||
    typeof bot?.session?.getRootSessionSelectedConnectorIds !== "function"
  ) {
    throw new Error("connector selection authority is unavailable");
  }
  let selectedConnectorIds;
  if (request?.createSessionIfAbsent === true) {
    selectedConnectorIds = normalizeSelectedConnectorIds(request?.initialSelectedConnectorIds);
    const connectors = await connectorAccessPort?.listUserConnectors?.(userId);
    const connectedConnectorIds = new Set(
      (Array.isArray(connectors) ? connectors : [])
        .filter((connector) => connector?.status === "connected")
        .map((connector) => text(connector?.connectorId))
        .filter(Boolean),
    );
    const invalidIds = selectedConnectorIds.filter((id) => !connectedConnectorIds.has(id));
    if (invalidIds.length) {
      const error = new Error(`selected connector is unavailable: ${invalidIds.join(", ")}`);
      error.code = "connector_selection_invalid";
      throw error;
    }
  } else {
    selectedConnectorIds = normalizeSelectedConnectorIds(
      await bot.session.getRootSessionSelectedConnectorIds({ userId, sessionId }),
    );
  }
  return {
    ...request,
    runConfig: {
      ...(request.runConfig || {}),
      selectedConnectorIds,
    },
  };
}

export function createChatRunService({ normalizeLocale, defaultLocale } = {}) {
  function normalizeStringArray(input = []) {
    return Array.isArray(input) ? input.map((item) => text(item)).filter(Boolean) : [];
  }

  function mapAgentRunCommand(command, { userId = "" } = {}) {
    const identity = command.identity;
    const preferences = command.preferences;
    const selectedPlugins = normalizeStringArray(preferences.selectedPlugins);
    const runConfig = {
      allowUserInteraction: preferences.allowUserInteraction,
      safeConfirm: preferences.safeConfirm,
      safeConfirmLevel: preferences.confirmationLevel,
      sanitizeOutput: preferences.sanitizeOutput,
      ...(Object.prototype.hasOwnProperty.call(preferences, "streaming")
        ? { streaming: preferences.streaming }
        : {}),
      frontendThresholdsEnabled: preferences.frontendThresholdsEnabled === true,
      locale: normalizeLocale(preferences.locale, defaultLocale),
      ...(preferences.scenario ? { scenario: preferences.scenario } : {}),
      ...(preferences.selectedModel ? { selectedModel: preferences.selectedModel } : {}),
      ...(preferences.memoryModel ? { memoryModel: preferences.memoryModel } : {}),
      ...(preferences.pluginModelConfig
        ? { pluginModelConfig: preferences.pluginModelConfig }
        : {}),
      ...(preferences.summaryPolicy ? { summaryPolicy: preferences.summaryPolicy } : {}),
      selectedPlugins,
      userMessageId: text(command.presentation?.userMessageId),
      presentationMessageId: text(command.presentation?.assistantMessageId),
      commandId: String(command.commandId).trim(),
      expectedAggregateVersion: command.concurrency.expectedAggregateVersion,
      transportCommand: {
        protocolVersion: command.protocolVersion,
        commandType: command.commandType,
        commandId: command.commandId,
      },
      ...(command.commandType === AGENT_COMMAND.RESEND ? { reuseExistingUserTurn: true } : {}),
      ...(command.commandType === AGENT_COMMAND.CONTINUE
        ? {
            resumeFromStoppedSnapshot: true,
            resumeDialogProcessId: command.continuation.dialogProcessId,
            resumeTurnScopeId: command.continuation.turnScopeId,
          }
        : {}),
    };
    return {
      userId: text(userId),
      sessionId: identity.sessionId,
      parentSessionId: identity.parentSessionId,
      dialogProcessId: identity.dialogProcessId,
      parentDialogProcessId: identity.parentDialogProcessId,
      turnScopeId: identity.turnScopeId,
      commandId: command.commandId,
      message: command.input.message,
      attachments: command.input.attachments,
      expectedRevision: command.concurrency.expectedTurnRevision,
      createSessionIfAbsent: command.session?.createIfAbsent === true,
      initialSelectedConnectorIds: normalizeSelectedConnectorIds(
        command.session?.selectedConnectorIds,
      ),
      runConfig,
    };
  }

  return {
    mapAgentRunCommand,
  };
}
