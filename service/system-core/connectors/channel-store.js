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

function hasSensitiveKeyName(keyName = "") {
  const normalizedKeyName = String(keyName || "").trim().toLowerCase();
  if (!normalizedKeyName) return false;
  return (
    normalizedKeyName.includes("password") ||
    normalizedKeyName.includes("passwd") ||
    normalizedKeyName.includes("secret") ||
    normalizedKeyName.includes("token") ||
    normalizedKeyName.includes("apikey") ||
    normalizedKeyName.includes("api_key") ||
    normalizedKeyName.includes("connectionstring") ||
    normalizedKeyName.includes("connection_string")
  );
}

function sanitizeConnectorMeta(connectionMeta = {}) {
  const sourceMeta =
    connectionMeta && typeof connectionMeta === "object" ? connectionMeta : {};
  const sanitizedMeta = {};
  for (const [metaKey, metaValue] of Object.entries(sourceMeta)) {
    const normalizedMetaKey = String(metaKey || "").trim();
    if (!normalizedMetaKey || hasSensitiveKeyName(normalizedMetaKey)) continue;
    sanitizedMeta[normalizedMetaKey] = metaValue;
  }
  return sanitizedMeta;
}

function toSerializableConnector(connector = {}) {
  return {
    connectorName: String(connector?.connectorName || "").trim(),
    connectorType: normalizeConnectorType(connector?.connectorType || ""),
    connectedAt: String(connector?.connectedAt || ""),
    connectionMeta: sanitizeConnectorMeta(
      connector?.connectionMeta && typeof connector.connectionMeta === "object"
        ? { ...connector.connectionMeta }
        : {},
    ),
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

  _buildHealthCommand(connectorType = "") {
    const normalizedConnectorType = normalizeConnectorType(connectorType);
    if (normalizedConnectorType === "database") return "SELECT 1 WHERE 1=1";
    if (normalizedConnectorType === "terminal")
      return "printf __NOOBOT_CONNECTOR_HEALTH__";
    return "";
  }

  async inspectSessionConnectors({
    sessionId = "",
    timeoutMs = 6000,
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return {
        root_session_id: "",
        connectors: { databases: [], terminals: [] },
        summary: {
          total_count: 0,
          connected_count: 0,
          error_count: 0,
          unknown_count: 0,
        },
      };
    }
    const sourceConnectors = this.getSessionConnectors(normalizedSessionId);
    const databaseSourceList = Array.isArray(sourceConnectors?.databases)
      ? sourceConnectors.databases
      : [];
    const terminalSourceList = Array.isArray(sourceConnectors?.terminals)
      ? sourceConnectors.terminals
      : [];
    const resolveConnectorStatus = async (
      connectorItem = {},
      connectorType = "",
    ) => {
      const connectorName = String(connectorItem?.connectorName || "").trim();
      const baseStatus = {
        connector_name: connectorName,
        connector_type: connectorType,
        connected_at: String(connectorItem?.connectedAt || "").trim(),
        connection_meta: sanitizeConnectorMeta(connectorItem?.connectionMeta || {}),
        status: "unknown",
        status_code: 503,
        status_message: "status unavailable",
      };
      if (!connectorName) return baseStatus;
      const healthCommand = this._buildHealthCommand(connectorType);
      if (!healthCommand) return baseStatus;
      try {
        const executionResult = await this.executeConnectorCommand({
          sessionId: normalizedSessionId,
          connectorName,
          connectorType,
          command: healthCommand,
          timeoutMs,
        });
        const executionCode = Number(executionResult?.output?.code ?? 0);
        const executionOk = executionResult?.ok === true;
        return {
          ...baseStatus,
          status: executionOk ? "connected" : "error",
          status_code: Number.isFinite(executionCode)
            ? executionCode
            : executionOk
              ? 0
              : 1,
          status_message: executionOk
            ? "ok"
            : String(executionResult?.output?.stderr || "").trim(),
          checked_at: new Date().toISOString(),
        };
      } catch (error) {
        return {
          ...baseStatus,
          status: "error",
          status_code: 500,
          status_message: String(
            error?.message || error || "health check failed",
          ),
          checked_at: new Date().toISOString(),
        };
      }
    };
    const databases = await Promise.all(
      databaseSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, "database"),
      ),
    );
    const terminals = await Promise.all(
      terminalSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, "terminal"),
      ),
    );
    const allConnectors = [...databases, ...terminals];
    return {
      root_session_id: normalizedSessionId,
      connectors: {
        databases,
        terminals,
      },
      summary: {
        total_count: allConnectors.length,
        connected_count: allConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "connected",
        ).length,
        error_count: allConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "error",
        ).length,
        unknown_count: allConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "unknown",
        ).length,
      },
    };
  }

  async inspectConnectorRuntimeStatus({
    sessionId = "",
    connectorName = "",
    connectorType = "",
    timeoutMs = 6000,
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedConnectorName = String(connectorName || "").trim();
    const normalizedConnectorType = normalizeConnectorType(connectorType);
    if (!normalizedSessionId) {
      return {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: "unknown",
        status_code: 400,
        status_message: "sessionId required",
      };
    }
    if (!normalizedConnectorName || !normalizedConnectorType) {
      return {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: "invalid",
        status_code: 400,
        status_message: "invalid connector identity",
      };
    }
    const inspected = await this.inspectSessionConnectors({
      sessionId: normalizedSessionId,
      timeoutMs,
    });
    const bucketName =
      normalizedConnectorType === "database" ? "databases" : "terminals";
    const sourceList = Array.isArray(inspected?.connectors?.[bucketName])
      ? inspected.connectors[bucketName]
      : [];
    const hitConnector =
      sourceList.find(
        (connectorItem) =>
          String(connectorItem?.connector_name || "").trim() ===
          normalizedConnectorName,
      ) || null;
    if (hitConnector) return hitConnector;
    return {
      connector_name: normalizedConnectorName,
      connector_type: normalizedConnectorType,
      status: "unknown",
      status_code: 404,
      status_message: "connector not found in inspected result",
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
