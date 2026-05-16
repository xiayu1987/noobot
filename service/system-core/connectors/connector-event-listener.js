/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../i18n/system-text.js";
import { logError } from "../tracking/console/logger.js";
import {
  CONNECTOR_TYPE,
  normalizeConnectorType,
} from "../config/core/enums.js";
import {
  CONNECTOR_INTERACTION_EVENT,
  CONNECTOR_INTERACTION_TYPE,
  CONNECTOR_RUNTIME_STATUS,
  CONNECTOR_TOOL_NAME,
} from "./constants.js";

function pickObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function collectNonSensitiveDefaults(connectionInfo = {}) {
  const normalizedConnectionInfo = pickObject(connectionInfo);
  const defaults = {};
  for (const [key, value] of Object.entries(normalizedConnectionInfo)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || normalizedKey.toLowerCase() === "password") continue;
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) continue;
    defaults[normalizedKey] = normalizedValue;
  }
  return defaults;
}

function resolveConnectToolName(connectorType = "") {
  const normalizedType = normalizeConnectorType(connectorType);
  if (normalizedType === CONNECTOR_TYPE.DATABASE) {
    return CONNECTOR_TOOL_NAME.CONNECT_DATABASE;
  }
  if (normalizedType === CONNECTOR_TYPE.TERMINAL) {
    return CONNECTOR_TOOL_NAME.CONNECT_TERMINAL;
  }
  return CONNECTOR_TOOL_NAME.CONNECT_EMAIL;
}

export class ConnectorEventListener {
  constructor({
    runtime = {},
    store = null,
    historyStore = null,
    rootSessionId = "",
    sessionId = "",
    dialogProcessId = "",
    allowUserInteraction = true,
    bridge = null,
  } = {}) {
    this.runtime = runtime;
    this.store = store;
    this.historyStore = historyStore;
    this.rootSessionId = String(rootSessionId || "").trim();
    this.sessionId = String(sessionId || "").trim();
    this.dialogProcessId = String(dialogProcessId || "").trim();
    this.allowUserInteraction = allowUserInteraction !== false;
    this.bridge = bridge;
  }

  _ensureRuntimeSelectedConnectors() {
    if (!this.runtime.systemRuntime || typeof this.runtime.systemRuntime !== "object") {
      this.runtime.systemRuntime = {};
    }
    if (
      !this.runtime.systemRuntime.config ||
      typeof this.runtime.systemRuntime.config !== "object"
    ) {
      this.runtime.systemRuntime.config = {};
    }
    if (
      !this.runtime.systemRuntime.config.selectedConnectors ||
      typeof this.runtime.systemRuntime.config.selectedConnectors !== "object"
    ) {
      this.runtime.systemRuntime.config.selectedConnectors = {};
    }
    return this.runtime.systemRuntime.config.selectedConnectors;
  }

  upsertSelectedConnector({ connectorType = "", connectorName = "" } = {}) {
    const normalizedType = normalizeConnectorType(connectorType);
    const normalizedName = String(connectorName || "").trim();
    if (
      ![
        CONNECTOR_TYPE.DATABASE,
        CONNECTOR_TYPE.TERMINAL,
        CONNECTOR_TYPE.EMAIL,
      ].includes(normalizedType)
    ) {
      return;
    }
    if (!normalizedName) return;
    const selectedConnectors = this._ensureRuntimeSelectedConnectors();
    this.runtime.systemRuntime.config.selectedConnectors = {
      ...selectedConnectors,
      [normalizedType]: normalizedName,
    };
  }

  syncRuntimeConnectorChannels() {
    if (!this.store || typeof this.store.getSessionConnectors !== "function") return;
    if (!this.rootSessionId) return;
    this.runtime.connectorChannels = this.store.getSessionConnectors(this.rootSessionId);
  }

  async persistConnectedHistory({
    connectorType = "",
    connectorName = "",
    connectionInfo = {},
    connectionMeta = {},
  } = {}) {
    if (
      !this.historyStore ||
      typeof this.historyStore.upsertConnectedConnector !== "function"
    ) {
      return;
    }
    await this.historyStore.upsertConnectedConnector({
      userId: String(this.runtime?.userId || "").trim(),
      sessionId: this.rootSessionId,
      connectorType: normalizeConnectorType(connectorType),
      connectorName: String(connectorName || "").trim(),
      connectionInfo,
      connectionMeta,
    });
  }

  async notifyConnectorConnected({ connectorType = "", connectorName = "" } = {}) {
    if (!this.allowUserInteraction || !this.bridge) return;
    const normalizedType = normalizeConnectorType(connectorType);
    const normalizedName = String(connectorName || "").trim();
    if (!normalizedType || !normalizedName) return;
    try {
      if (typeof this.bridge.emitNotification === "function") {
        await this.bridge.emitNotification({
          eventName: CONNECTOR_INTERACTION_EVENT.STATUS,
          data: {
            content: `${normalizedType} ${tSystem("connectors.event.connected")}: ${normalizedName}`,
            dialogProcessId: this.dialogProcessId,
            sessionId: this.sessionId,
            connectorName: normalizedName,
            connectorType: normalizedType,
            status: CONNECTOR_RUNTIME_STATUS.CONNECTED,
            interactionType: CONNECTOR_INTERACTION_TYPE.CONNECTED,
            interactionData: {
              connectorName: normalizedName,
              connectorType: normalizedType,
              status: CONNECTOR_RUNTIME_STATUS.CONNECTED,
            },
          },
        });
        return;
      }
      if (!this.bridge?.requestUserInteraction) return;
      await this.bridge.requestUserInteraction({
        content: `${normalizedType} ${tSystem("connectors.event.connected")}: ${normalizedName}`,
        fields: [],
        dialogProcessId: this.dialogProcessId,
        requireEncryption: false,
        sessionId: this.sessionId,
        toolName: resolveConnectToolName(normalizedType),
        connectorName: normalizedName,
        connectorType: normalizedType,
        interactionType: CONNECTOR_INTERACTION_TYPE.CONNECTED,
        interactionData: {
          connectorName: normalizedName,
          connectorType: normalizedType,
          status: CONNECTOR_RUNTIME_STATUS.CONNECTED,
        },
      });
    } catch (error) {
      logError("[connector-event-listener] notifyConnectorConnected requestUserInteraction failed", {
        connectorType: normalizedType,
        connectorName: normalizedName,
        error: error?.message || String(error),
      });
    }
  }

  async notifyReconnectRequired({
    connectorType = "",
    connectorName = "",
    reconnectToolName = "",
    defaultValues = {},
    message = "",
  } = {}) {
    if (!this.allowUserInteraction || !this.bridge?.requestUserInteraction) return;
    const normalizedType = normalizeConnectorType(connectorType);
    const normalizedName = String(connectorName || "").trim();
    const normalizedReconnectToolName =
      String(reconnectToolName || "").trim() || resolveConnectToolName(normalizedType);
    if (!normalizedType || !normalizedName) return;
    try {
      await this.bridge.requestUserInteraction({
        content:
          String(message || "").trim() ||
          `${tSystem("connectors.event.reconnectRequired")}: ${normalizedName}`,
        fields: [],
        dialogProcessId: this.dialogProcessId,
        requireEncryption: false,
        sessionId: this.sessionId,
        toolName: normalizedReconnectToolName,
        connectorName: normalizedName,
        connectorType: normalizedType,
        interactionType: CONNECTOR_INTERACTION_TYPE.RECONNECT_REQUIRED,
        interactionData: {
          connectorName: normalizedName,
          connectorType: normalizedType,
          reconnectToolName: normalizedReconnectToolName,
          defaultValues: collectNonSensitiveDefaults(defaultValues),
        },
      });
    } catch (error) {
      logError("[connector-event-listener] notifyReconnectRequired requestUserInteraction failed", {
        connectorType: normalizedType,
        connectorName: normalizedName,
        reconnectToolName: normalizedReconnectToolName,
        error: error?.message || String(error),
      });
    }
  }

  async onConnectorConnected({
    connectorType = "",
    connectorName = "",
    connectionInfo = {},
    connector = {},
  } = {}) {
    this.upsertSelectedConnector({ connectorType, connectorName });
    this.syncRuntimeConnectorChannels();
    await this.persistConnectedHistory({
      connectorType,
      connectorName,
      connectionInfo,
      connectionMeta:
        connector?.connectionMeta && typeof connector.connectionMeta === "object"
          ? connector.connectionMeta
          : {},
    });
    await this.notifyConnectorConnected({ connectorType, connectorName });
  }

  onConnectorAlreadyConnected({ connectorType = "", connectorName = "" } = {}) {
    this.upsertSelectedConnector({ connectorType, connectorName });
    this.syncRuntimeConnectorChannels();
  }

  onConnectorAccessed({ connectorType = "", connectorName = "" } = {}) {
    this.upsertSelectedConnector({ connectorType, connectorName });
    this.syncRuntimeConnectorChannels();
  }
}

export function createConnectorEventListener(options = {}) {
  return new ConnectorEventListener(options);
}
