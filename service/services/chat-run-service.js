/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HTTP_STATUS } from "#agent/constants";
import { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
import {
  AGENT_COMMAND,
  RUN_COMMAND_TYPES,
  parseAgentCommand,
} from "@noobot/agent-transport-protocol";
import { recordServiceAgentTransportDebug } from "../runtime-events/agent-transport-debug.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";

export async function resolveAuthoritativeConnectorSelection({
  bot,
  connectorAccessPort,
  request,
} = {}) {
  const userId = String(request?.userId || "").trim();
  const sessionId = String(request?.sessionId || "").trim();
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
        .map((connector) => String(connector?.connectorId || "").trim())
        .filter(Boolean),
    );
    const invalidIds = selectedConnectorIds.filter((id) => !connectedConnectorIds.has(id));
    if (invalidIds.length) {
      const error = new Error(`selected connector is unavailable: ${invalidIds.join(", ")}`);
      error.errorCode = "connector_selection_invalid";
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

export function createChatRunService({
  getBot,
  normalizeLocale,
  defaultLocale,
  translateText,
  sessionLogConfig,
  connectorAccessPort,
} = {}) {
  function normalizeStringArray(input = []) {
    return Array.isArray(input)
      ? input.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
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
      locale: normalizeLocale(preferences.locale || defaultLocale),
      ...(preferences.scenario ? { scenario: preferences.scenario } : {}),
      ...(preferences.selectedModel ? { selectedModel: preferences.selectedModel } : {}),
      ...(preferences.memoryModel ? { memoryModel: preferences.memoryModel } : {}),
      ...(preferences.pluginModelConfig
        ? { pluginModelConfig: preferences.pluginModelConfig }
        : {}),
      ...(preferences.summaryPolicy ? { summaryPolicy: preferences.summaryPolicy } : {}),
      selectedPlugins,
      turnScopeId: identity.turnScopeId,
      userMessageId: String(command.presentation?.userMessageId || "").trim(),
      presentationMessageId: String(command.presentation?.assistantMessageId || "").trim(),
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
      userId: String(userId || "").trim(),
      sessionId: identity.sessionId,
      parentSessionId: identity.parentSessionId || "",
      dialogProcessId: identity.dialogProcessId || "",
      parentDialogProcessId: identity.parentDialogProcessId || "",
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

  async function handleChat(req, res) {
    let acceptedCommand = null;
    try {
      const command = parseAgentCommand(req.body);
      if (!RUN_COMMAND_TYPES.includes(command.commandType)) throw new Error("run_command_required");
      acceptedCommand = command;
      void recordServiceAgentTransportDebug({
        sessionLogConfig,
        event: "service.agentTransport.httpCommandReceived",
        command,
        userId: req.auth?.userId,
        data: { accepted: true, transport: "http" },
      });
      const bot = getBot();
      const request = await resolveAuthoritativeConnectorSelection({
        bot,
        connectorAccessPort,
        request: mapAgentRunCommand(command, { userId: req.auth?.userId }),
      });
      bot?.emitRuntimeEvent?.("debug_resend_http_received", {
        sessionId: request.sessionId,
        parentSessionId: request.parentSessionId,
        turnScopeId: request.turnScopeId,
        reuseExistingUserTurn: request.runConfig.reuseExistingUserTurn === true,
        attachments: summarizeDebugAttachments(request.attachments),
      });
      const result = await bot.runSession({
        ...request,
        caller: "user",
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      void recordServiceAgentTransportDebug({
        sessionLogConfig,
        event: acceptedCommand
          ? "service.agentTransport.httpCommandProcessingFailed"
          : "service.agentTransport.httpCommandRejected",
        command: acceptedCommand || req.body,
        userId: req.auth?.userId,
        data: {
          accepted: Boolean(acceptedCommand),
          processed: false,
          transport: "http",
          errorType: String(error?.name || "Error"),
          errorCode: String(error?.errorCode || error?.code || ""),
          validationErrors: Array.isArray(error?.errors) ? error.errors.slice(0, 20) : [],
        },
      });
      res.status(HTTP_STATUS.BAD_REQUEST).json({ ok: false, error: error.message });
    }
  }

  return {
    mapAgentRunCommand,
    handleChat,
  };
}
