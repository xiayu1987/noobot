/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HTTP_STATUS } from "#agent/constants";
import {
  AGENT_COMMAND,
  RUN_COMMAND_TYPES,
  parseAgentCommand,
} from "@noobot/agent-transport-protocol";
import { recordServiceAgentTransportDebug } from "../runtime-events/agent-transport-debug.js";

function summarizeDebugAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { kind: attachments === undefined ? "undefined" : "non-array", count: 0, items: [] };
  }
  return {
    kind: "array",
    count: attachments.length,
    items: attachments.slice(0, 8).map((attachment = {}) => ({
      id: String(attachment.id || attachment.fileId || attachment.attachmentId || ""),
      name: String(attachment.name || attachment.fileName || attachment.filename || ""),
      type: String(attachment.type || attachment.mimeType || attachment.mime || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      url: attachment.url ? "present" : "",
    })),
  };
}

export function createChatRunService({
  getBot,
  normalizeLocale,
  defaultLocale,
  translateText,
  sessionLogConfig,
} = {}) {
  function normalizeSelectedConnectors(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const normalizeConnectorName = (value = "") => String(value || "").trim();
    return {
      database: normalizeConnectorName(source?.database),
      terminal: normalizeConnectorName(source?.terminal),
      email: normalizeConnectorName(source?.email),
    };
  }

  function normalizeStringArray(input = []) {
    return Array.isArray(input)
      ? input.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  }

  function normalizePlugins(inputPlugins = {}, selectedPlugins = []) {
    const sourcePlugins =
      inputPlugins && typeof inputPlugins === "object" && !Array.isArray(inputPlugins)
        ? inputPlugins
        : {};
    const normalizedPlugins = {};
    for (const [pluginKey, pluginValue] of Object.entries(sourcePlugins)) {
      const normalizedPluginKey = String(pluginKey || "").trim();
      if (!normalizedPluginKey) continue;
      const sourcePlugin =
        pluginValue && typeof pluginValue === "object" && !Array.isArray(pluginValue)
          ? pluginValue
          : {};
      const normalizedMode = String(sourcePlugin?.mode ?? "off")
        .trim()
        .toLowerCase();
      normalizedPlugins[normalizedPluginKey] = {
        ...sourcePlugin,
        mode: normalizedMode === "on" ? "on" : "off",
      };
    }
    for (const pluginKey of normalizeStringArray(selectedPlugins)) {
      const current =
        normalizedPlugins[pluginKey] && typeof normalizedPlugins[pluginKey] === "object"
          ? normalizedPlugins[pluginKey]
          : {};
      if (current?.enabled === false) continue;
      normalizedPlugins[pluginKey] = {
        ...current,
        enabled: true,
        mode: "on",
      };
    }
    return normalizedPlugins;
  }

  function mapAgentRunCommand(command, { userId = "" } = {}) {
    const identity = command.identity;
    const preferences = command.preferences;
    const selectedPlugins = normalizeStringArray(preferences.selectedPlugins);
    const runConfig = {
      allowUserInteraction: preferences.allowUserInteraction,
      safeConfirm: true,
      safeConfirmLevel: preferences.confirmationLevel,
      sanitizeOutput: preferences.sanitizeOutput,
      ...(Object.prototype.hasOwnProperty.call(preferences, "streaming")
        ? { streaming: preferences.streaming }
        : {}),
      locale: normalizeLocale(preferences.locale || defaultLocale),
      ...(preferences.scenario ? { scenario: preferences.scenario } : {}),
      ...(preferences.selectedModel ? { selectedModel: preferences.selectedModel } : {}),
      ...(preferences.memoryModel ? { memoryModel: preferences.memoryModel } : {}),
      ...(preferences.pluginModelConfig ? { pluginModelConfig: preferences.pluginModelConfig } : {}),
      selectedConnectors: normalizeSelectedConnectors(preferences.selectedConnectors),
      selectedPlugins,
      plugins: normalizePlugins({}, selectedPlugins),
      turnScopeId: identity.turnScopeId,
      userMessageId: String(command.presentation?.userMessageId || "").trim(),
      presentationMessageId: String(command.presentation?.assistantMessageId || "").trim(),
      idempotencyKey: String(command.concurrency?.idempotencyKey || command.commandId).trim(),
      expectedVersion: command.concurrency?.expectedRevision,
      transportCommand: {
        protocolVersion: command.protocolVersion,
        commandType: command.commandType,
        commandId: command.commandId,
      },
      ...(command.commandType === AGENT_COMMAND.RESEND ? { reuseExistingUserTurn: true } : {}),
      ...(command.commandType === AGENT_COMMAND.CONTINUE ? {
        resumeFromStoppedSnapshot: true,
        resumeDialogProcessId: command.continuation.dialogProcessId,
        resumeTurnScopeId: command.continuation.turnScopeId,
      } : {}),
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
      expectedRevision: command.concurrency?.expectedRevision,
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
      const request = mapAgentRunCommand(command, { userId: req.auth?.userId });
      const bot = getBot();
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
    normalizeSelectedConnectors,
    mapAgentRunCommand,
    handleChat,
  };
}
