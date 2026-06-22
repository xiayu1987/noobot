/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveForceToolCall } from "#agent/utils";
import { HTTP_STATUS } from "#agent/constants";
import { hasOwnConfigKey, normalizeBooleanLike, resolveTimeMs } from "#agent/config";

export function createChatRunService({
  getBot,
  normalizeLocale,
  defaultLocale,
  translateText,
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

  function normalizeSelectedModel(input = "") {
    return String(input || "").trim();
  }

  function normalizePluginModelConfig(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const normalized = {};
    for (const [scopeKey, scopeValue] of Object.entries(input)) {
      const normalizedScopeKey = String(scopeKey || "").trim();
      if (!normalizedScopeKey) continue;
      if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) continue;
      normalized[normalizedScopeKey] = { ...scopeValue };
    }
    return Object.keys(normalized).length ? normalized : undefined;
  }

  function normalizeRunConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const allowUserInteractionRaw = input?.allowUserInteraction;
    const allowUserInteraction =
      allowUserInteractionRaw === undefined ? true : Boolean(allowUserInteractionRaw);
    const forceTool = resolveForceToolCall(source);
    const locale = normalizeLocale(input?.locale || defaultLocale);
    const hasScenarioField = Object.prototype.hasOwnProperty.call(source, "scenario");
    const scenario = hasScenarioField ? String(source?.scenario || "").trim() : undefined;
    const hasStreamingField = hasOwnConfigKey(source, "streaming");
    const streaming = hasStreamingField
      ? normalizeBooleanLike(source?.streaming, false)
      : undefined;
    const hasRunTimeout =
      Object.prototype.hasOwnProperty.call(source, "runTimeoutMs") ||
      Object.prototype.hasOwnProperty.call(source, "run_timeout_ms");
    const runTimeoutMs = hasRunTimeout
      ? resolveTimeMs(source, {
          key: "runTimeoutMs",
          legacyKeys: ["run_timeout_ms"],
          sourceTag: "service.chat-run-service",
          warnLegacy: true,
          fallback: 0,
          min: 1,
        })
      : 0;
    const selectedModel = normalizeSelectedModel(source?.selectedModel);
    const pluginModelConfig = normalizePluginModelConfig(source?.pluginModelConfig);
    const normalizedTurnScopeId = String(source?.turnScopeId || "").trim();
    const compatConfig = {
      ...(hasScenarioField ? { scenario } : {}),
      ...(selectedModel ? { selectedModel } : {}),
      ...(pluginModelConfig ? { pluginModelConfig } : {}),
    };
    return {
      allowUserInteraction,
      forceTool,
      ...(hasStreamingField ? { streaming } : {}),
      locale,
      scenario,
      ...(selectedModel ? { selectedModel } : {}),
      ...(pluginModelConfig ? { pluginModelConfig } : {}),
      ...(Object.keys(compatConfig).length ? { config: compatConfig } : {}),
      ...(Number.isFinite(runTimeoutMs) && runTimeoutMs > 0
        ? { runTimeoutMs: Math.floor(runTimeoutMs) }
        : {}),
      selectedConnectors: normalizeSelectedConnectors(input?.selectedConnectors),
      selectedPlugins: normalizeStringArray(input?.selectedPlugins),
      plugins: normalizePlugins(source?.plugins, input?.selectedPlugins),
      ...(normalizedTurnScopeId ? { turnScopeId: normalizedTurnScopeId } : {}),
      ...(source?.reuseExistingUserTurn === true ? {
        reuseExistingUserTurn: true,
        existingUserTurnId: String(source?.existingUserTurnId || "").trim(),
        existingUserMessageId: String(source?.existingUserMessageId || "").trim(),
      } : {}),
    };
  }

  async function handleChat(req, res) {
    try {
      const {
        userId,
        sessionId,
        parentSessionId = "",
        parentDialogProcessId = "",
        message,
        attachments = [],
        config = {},
        turnScopeId = "",
      } = req.body;
      if (!userId || !sessionId || !message) {
        throw new Error(translateText("common.userSessionMessageRequired", req.locale));
      }
      const bot = getBot();
      const result = await bot.runSession({
        userId,
        sessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: "user",
        message,
        attachments,
        runConfig: {
          ...normalizeRunConfig(config),
          turnScopeId: String(turnScopeId || config?.turnScopeId || "").trim(),
        },
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ ok: false, error: error.message });
    }
  }

  return {
    normalizeSelectedConnectors,
    normalizeRunConfig,
    handleChat,
  };
}
