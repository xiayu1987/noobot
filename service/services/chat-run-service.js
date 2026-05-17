/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveForceToolCall } from "#agent/utils";
import { HTTP_STATUS } from "#agent/constants";

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

  function normalizeRunConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const allowUserInteractionRaw = input?.allowUserInteraction;
    const allowUserInteraction =
      allowUserInteractionRaw === undefined ? true : Boolean(allowUserInteractionRaw);
    const forceTool = resolveForceToolCall(source);
    const locale = normalizeLocale(input?.locale || defaultLocale);
    const hasScenarioField = Object.prototype.hasOwnProperty.call(source, "scenario");
    const scenario = hasScenarioField ? String(source?.scenario || "").trim() : undefined;
    const runTimeoutRaw = source?.runTimeoutMs ?? source?.run_timeout_ms;
    const runTimeoutMs = Number(runTimeoutRaw);
    return {
      allowUserInteraction,
      forceTool,
      locale,
      scenario,
      ...(Number.isFinite(runTimeoutMs) && runTimeoutMs > 0
        ? { runTimeoutMs: Math.floor(runTimeoutMs) }
        : {}),
      selectedConnectors: normalizeSelectedConnectors(input?.selectedConnectors),
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
        runConfig: normalizeRunConfig(config),
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
