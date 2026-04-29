/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeConnectorType(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (value === "database" || value === "db") return "database";
  if (value === "terminal" || value === "server_terminal" || value === "shell") {
    return "terminal";
  }
  if (value === "email" || value === "mail" || value === "smtp_imap") {
    return "email";
  }
  return "";
}

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
  if (normalizedType === "database") return "database_connect_connector";
  if (normalizedType === "terminal") return "terminal_connect_connector";
  return "email_connect_connector";
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
    if (!["database", "terminal", "email"].includes(normalizedType)) return;
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
    if (!this.allowUserInteraction || !this.bridge?.requestUserInteraction) return;
    const normalizedType = normalizeConnectorType(connectorType);
    const normalizedName = String(connectorName || "").trim();
    if (!normalizedType || !normalizedName) return;
    try {
      await this.bridge.requestUserInteraction({
        content: `${normalizedType}连接器连接成功：${normalizedName}`,
        fields: [],
        dialogProcessId: this.dialogProcessId,
        requireEncryption: false,
        sessionId: this.sessionId,
        toolName: resolveConnectToolName(normalizedType),
        connectorName: normalizedName,
        connectorType: normalizedType,
        interactionType: "connector_connected",
        interactionData: {
          connectorName: normalizedName,
          connectorType: normalizedType,
          status: "connected",
        },
      });
    } catch {}
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
          `当前已勾选连接器「${normalizedName}」未连接，请重新连接`,
        fields: [],
        dialogProcessId: this.dialogProcessId,
        requireEncryption: false,
        sessionId: this.sessionId,
        toolName: normalizedReconnectToolName,
        connectorName: normalizedName,
        connectorType: normalizedType,
        interactionType: "connector_reconnect_required",
        interactionData: {
          connectorName: normalizedName,
          connectorType: normalizedType,
          reconnectToolName: normalizedReconnectToolName,
          defaultValues: collectNonSensitiveDefaults(defaultValues),
        },
      });
    } catch {}
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

