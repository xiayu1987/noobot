/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig, normalizeConnectorType } from "../../../config/index.js";
import { resolveDialogProcessIdFromContext } from "../../../context/session/dialog-process-id-resolver.js";
import { resolveToolLocale } from "../../core/tool-i18n.js";
import { collectNonSensitiveDefaults } from "./connector-fields.js";

function resolveRuntimeLocale(runtime = {}) {
  return resolveToolLocale(runtime, "zh-CN");
}

function createConnectorToolContext(agentContext = {}) {
  const runtime = agentContext?.runtime || {};
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  const rootSessionId = String(systemRuntime?.rootSessionId || "").trim();
  const dialogProcessId = resolveDialogProcessIdFromContext({ runtime });
  const allowUserInteraction = systemRuntime?.config?.allowUserInteraction !== false;
  const bridge = runtime?.userInteractionBridge || null;
  const store = runtime?.sharedTools?.connectorChannelStore || null;
  const historyStore = runtime?.sharedTools?.connectorHistoryStore || null;
  const connectorEventListener = runtime?.sharedTools?.connectorEventListener || null;
  const maxAccessOutputChars = Number(
    effectiveConfig?.tools?.maxOutputChars ?? 8000,
  );
  return {
    runtime,
    effectiveConfig,
    sessionId,
    rootSessionId,
    dialogProcessId,
    allowUserInteraction,
    bridge,
    store,
    historyStore,
    connectorEventListener,
    maxAccessOutputChars,
  };
}

async function resolveRememberedConnectorInfo({
  historyStore = null,
  userId = "",
  rootSessionId = "",
  connectorType = "",
  connectorName = "",
} = {}) {
  if (
    !historyStore ||
    typeof historyStore.listSessionConnectors !== "function"
  ) {
    return {};
  }
  const normalizedUserId = String(userId || "").trim();
  const normalizedRootSessionId = String(rootSessionId || "").trim();
  const normalizedConnectorType = normalizeConnectorType(connectorType);
  const normalizedConnectorName = String(connectorName || "").trim();
  if (
    !normalizedUserId ||
    !normalizedRootSessionId ||
    !normalizedConnectorType ||
    !normalizedConnectorName
  ) {
    return {};
  }
  const groupedHistory = await historyStore.listSessionConnectors({
    userId: normalizedUserId,
    sessionId: normalizedRootSessionId,
  });
  const historyList = Array.isArray(groupedHistory?.[normalizedConnectorType])
    ? groupedHistory[normalizedConnectorType]
    : [];
  const hitConnector =
    historyList.find(
      (connectorItem) =>
        String(connectorItem?.connector_name || "").trim() ===
        normalizedConnectorName,
    ) || null;
  const defaults =
    hitConnector?.connection_defaults &&
    typeof hitConnector.connection_defaults === "object"
      ? hitConnector.connection_defaults
      : {};
  return collectNonSensitiveDefaults(defaults);
}

export {
  resolveRuntimeLocale,
  createConnectorToolContext,
  resolveRememberedConnectorInfo,
};
