/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeDatabaseCommand } from "./databases/index.js";
import { executeTerminalCommand } from "./terminals/index.js";

function normalizeConnectorType(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (value === "database" || value === "db") return "database";
  if (value === "terminal" || value === "server_terminal" || value === "shell") {
    return "terminal";
  }
  return "";
}

function toSerializableConnector(connector = {}) {
  return {
    connectorName: String(connector?.connectorName || "").trim(),
    connectorType: normalizeConnectorType(connector?.connectorType || ""),
    connectedAt: String(connector?.connectedAt || ""),
    connectionMeta:
      connector?.connectionMeta && typeof connector.connectionMeta === "object"
        ? { ...connector.connectionMeta }
        : {},
  };
}

class ConnectorChannelStore {
  constructor() {
    this.sessionBuckets = new Map();
  }

  _ensureSessionBucket(sessionId = "") {
    const sid = String(sessionId || "").trim();
    if (!sid) throw new Error("sessionId required");
    if (!this.sessionBuckets.has(sid)) {
      this.sessionBuckets.set(sid, {
        databases: new Map(),
        terminals: new Map(),
      });
    }
    return this.sessionBuckets.get(sid);
  }

  getSessionConnectors(sessionId = "") {
    const bucket = this._ensureSessionBucket(sessionId);
    return {
      databases: Array.from(bucket.databases.values()).map(toSerializableConnector),
      terminals: Array.from(bucket.terminals.values()).map(toSerializableConnector),
    };
  }

  connectConnector({
    sessionId = "",
    connectorName = "",
    connectorType = "",
    connectionInfo = {},
  } = {}) {
    const normalizedName = String(connectorName || "").trim();
    const normalizedType = normalizeConnectorType(connectorType);
    if (!normalizedName) throw new Error("connectorName required");
    if (!normalizedType) throw new Error("connectorType must be database|terminal");
    const bucket = this._ensureSessionBucket(sessionId);
    const connectedAt = new Date().toISOString();
    const info =
      connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
    const channel = {
      connectorName: normalizedName,
      connectorType: normalizedType,
      connectedAt,
      connectionInfo: { ...info },
      connectionMeta:
        normalizedType === "database"
          ? {
              databaseType: String(info?.database_type || info?.databaseType || ""),
            }
          : {
              terminalType: String(
                info?.terminal_type || info?.terminalType || "",
              ),
              host: String(info?.host || info?.ip || ""),
              port: Number(info?.port || 22),
              username: String(info?.username || ""),
            },
    };
    if (normalizedType === "database") {
      bucket.databases.set(normalizedName, channel);
    } else {
      bucket.terminals.set(normalizedName, channel);
    }
    return toSerializableConnector(channel);
  }

  _getChannel({ sessionId = "", connectorName = "", connectorType = "" } = {}) {
    const normalizedName = String(connectorName || "").trim();
    const normalizedType = normalizeConnectorType(connectorType);
    if (!normalizedName) throw new Error("connectorName required");
    if (!normalizedType) throw new Error("connectorType must be database|terminal");
    const bucket = this._ensureSessionBucket(sessionId);
    const sourceMap = normalizedType === "database" ? bucket.databases : bucket.terminals;
    const channel = sourceMap.get(normalizedName);
    if (!channel) {
      throw new Error(`connector not connected in current session: ${normalizedName}`);
    }
    return channel;
  }

  async executeConnectorCommand({
    sessionId = "",
    connectorName = "",
    connectorType = "",
    command = "",
    timeoutMs = 30000,
  } = {}) {
    const channel = this._getChannel({ sessionId, connectorName, connectorType });
    const normalizedType = normalizeConnectorType(connectorType);
    const cmd = String(command || "").trim();
    if (!cmd) throw new Error("command required");
    if (normalizedType === "terminal") {
      const execution = await executeTerminalCommand({
        command: cmd,
        channelKey: `${String(sessionId || "").trim()}::${String(
          connectorName || "",
        ).trim()}`,
        sessionId: String(sessionId || "").trim(),
        connectorName: String(connectorName || "").trim(),
        connectionInfo:
          channel?.connectionInfo && typeof channel.connectionInfo === "object"
            ? { ...channel.connectionInfo, timeout_ms: timeoutMs }
            : { timeout_ms: timeoutMs },
      });
      return {
        ok: execution.ok,
        connector: toSerializableConnector(channel),
        output: {
          code: execution.code,
          stdout: execution.stdout,
          stderr: execution.stderr,
        },
      };
    }
    const execution = await executeDatabaseCommand({
      command: cmd,
      connectionInfo:
        channel?.connectionInfo && typeof channel.connectionInfo === "object"
          ? channel.connectionInfo
          : {},
    });
    return {
      ok: execution?.ok === true,
      connector: toSerializableConnector(channel),
      output: {
        code: Number(execution?.code || 0),
        stdout: String(execution?.stdout || ""),
        stderr: String(execution?.stderr || ""),
      },
    };
  }
}

let globalConnectorChannelStore = null;

export function initConnectorChannelStore() {
  if (!globalConnectorChannelStore) {
    globalConnectorChannelStore = new ConnectorChannelStore();
  }
  return globalConnectorChannelStore;
}

export function getConnectorChannelStore() {
  return initConnectorChannelStore();
}
