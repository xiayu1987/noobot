/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeDatabaseCommand } from "./databases/index.js";
import { executeTerminalCommand } from "./terminals/index.js";
import { releaseTerminalChannel } from "./terminals/index.js";
import { executeEmailCommand } from "./emails/index.js";
import { tSystem } from "../i18n/system-text.js";

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
    if (!sid) throw new Error(tSystem("connectors.sessionIdRequired"));
    if (!this.sessionBuckets.has(sid)) {
      this.sessionBuckets.set(sid, {
        databases: new Map(),
        terminals: new Map(),
        emails: new Map(),
      });
    }
    const bucket = this.sessionBuckets.get(sid);
    if (!(bucket?.emails instanceof Map)) {
      bucket.emails = new Map();
    }
    return bucket;
  }

  getSessionConnectors(sessionId = "") {
    const bucket = this._ensureSessionBucket(sessionId);
    return {
      databases: Array.from((bucket.databases || new Map()).values()).map(
        toSerializableConnector,
      ),
      terminals: Array.from((bucket.terminals || new Map()).values()).map(
        toSerializableConnector,
      ),
      emails: Array.from((bucket.emails || new Map()).values()).map(
        toSerializableConnector,
      ),
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
    if (!normalizedName) throw new Error(tSystem("connectors.connectorNameRequired"));
    if (!normalizedType) {
      throw new Error(tSystem("connectors.connectorTypeInvalid"));
    }
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
              databaseType: String(info?.database_type || ""),
            }
          : normalizedType === "terminal"
            ? {
              terminalType: String(info?.terminal_type || ""),
              host: String(info?.host || ""),
              port: Number(info?.port || 22),
              username: String(info?.username || ""),
            }
            : {
              smtpHost: String(info?.smtp_host || ""),
              smtpPort: Number(info?.smtp_port || 587),
              imapHost: String(info?.imap_host || ""),
              imapPort: Number(info?.imap_port || 993),
              username: String(info?.username || ""),
            },
    };
    if (normalizedType === "database") {
      bucket.databases.set(normalizedName, channel);
    } else if (normalizedType === "terminal") {
      bucket.terminals.set(normalizedName, channel);
    } else {
      bucket.emails.set(normalizedName, channel);
    }
    return toSerializableConnector(channel);
  }

  disconnectConnector({
    sessionId = "",
    connectorName = "",
    connectorType = "",
  } = {}) {
    const normalizedName = String(connectorName || "").trim();
    const normalizedType = normalizeConnectorType(connectorType);
    if (!normalizedName || !normalizedType) return false;
    const bucket = this._ensureSessionBucket(sessionId);
    const sourceMap =
      normalizedType === "database"
        ? bucket.databases
        : normalizedType === "terminal"
          ? bucket.terminals
          : bucket.emails;
    const existingChannel = sourceMap.get(normalizedName) || null;
    const deleted = sourceMap.delete(normalizedName);
    if (deleted && normalizedType === "terminal") {
      releaseTerminalChannel({
        connectionInfo:
          existingChannel?.connectionInfo &&
          typeof existingChannel.connectionInfo === "object"
            ? existingChannel.connectionInfo
            : {},
        sessionId: String(sessionId || "").trim(),
        connectorName: normalizedName,
      });
    }
    return deleted;
  }

  releaseSessionConnectors(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return {
        released: false,
        sessionId: "",
        releasedCounts: { databases: 0, terminals: 0, emails: 0, total: 0 },
      };
    }
    const bucket = this.sessionBuckets.get(normalizedSessionId);
    if (!bucket) {
      return {
        released: false,
        sessionId: normalizedSessionId,
        releasedCounts: { databases: 0, terminals: 0, emails: 0, total: 0 },
      };
    }
    const databaseChannels = Array.from(
      (bucket.databases || new Map()).values(),
    );
    const terminalChannels = Array.from(
      (bucket.terminals || new Map()).values(),
    );
    const emailChannels = Array.from((bucket.emails || new Map()).values());
    for (const terminalChannel of terminalChannels) {
      releaseTerminalChannel({
        connectionInfo:
          terminalChannel?.connectionInfo &&
          typeof terminalChannel.connectionInfo === "object"
            ? terminalChannel.connectionInfo
            : {},
        sessionId: normalizedSessionId,
        connectorName: String(terminalChannel?.connectorName || "").trim(),
      });
    }
    this.sessionBuckets.delete(normalizedSessionId);
    const releasedCounts = {
      databases: databaseChannels.length,
      terminals: terminalChannels.length,
      emails: emailChannels.length,
      total:
        databaseChannels.length + terminalChannels.length + emailChannels.length,
    };
    return {
      released: releasedCounts.total > 0,
      sessionId: normalizedSessionId,
      releasedCounts,
    };
  }

  _getChannel({ sessionId = "", connectorName = "", connectorType = "" } = {}) {
    const normalizedName = String(connectorName || "").trim();
    const normalizedType = normalizeConnectorType(connectorType);
    if (!normalizedName) throw new Error(tSystem("connectors.connectorNameRequired"));
    if (!normalizedType) {
      throw new Error(tSystem("connectors.connectorTypeInvalid"));
    }
    const bucket = this._ensureSessionBucket(sessionId);
    const sourceMap =
      normalizedType === "database"
        ? bucket.databases
        : normalizedType === "terminal"
          ? bucket.terminals
          : bucket.emails;
    const channel = sourceMap.get(normalizedName);
    if (!channel) {
      throw new Error(`${tSystem("connectors.connectorNotConnectedInSession")}: ${normalizedName}`);
    }
    return channel;
  }

  async executeConnectorCommand({
    sessionId = "",
    connectorName = "",
    connectorType = "",
    command = "",
    timeoutMs = 30000,
    emailAttachmentHandler = null,
  } = {}) {
    const channel = this._getChannel({ sessionId, connectorName, connectorType });
    const normalizedType = normalizeConnectorType(connectorType);
    const cmd = String(command || "").trim();
    if (!cmd) throw new Error(tSystem("connectors.commandRequired"));
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
    if (normalizedType === "email") {
      const execution = await executeEmailCommand({
        command: cmd,
        attachmentHandler:
          typeof emailAttachmentHandler === "function"
            ? emailAttachmentHandler
            : null,
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
    if (normalizedConnectorType === "email")
      return JSON.stringify({ action: "list", folder: "INBOX", page: 1, page_size: 1 });
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
        connectors: { databases: [], terminals: [], emails: [] },
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
    const emailSourceList = Array.isArray(sourceConnectors?.emails)
      ? sourceConnectors.emails
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
        status_message: tSystem("connectors.statusUnavailable"),
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
    const emails = await Promise.all(
      emailSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, "email"),
      ),
    );
    const allConnectors = [...databases, ...terminals, ...emails];
    return {
      root_session_id: normalizedSessionId,
      connectors: {
        databases,
        terminals,
        emails,
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
        status_message: tSystem("connectors.statusSessionIdRequired"),
      };
    }
    if (!normalizedConnectorName || !normalizedConnectorType) {
      return {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: "invalid",
        status_code: 400,
        status_message: tSystem("connectors.statusInvalidConnectorIdentity"),
      };
    }
    const inspected = await this.inspectSessionConnectors({
      sessionId: normalizedSessionId,
      timeoutMs,
    });
    const bucketName =
      normalizedConnectorType === "database"
        ? "databases"
        : normalizedConnectorType === "terminal"
          ? "terminals"
          : "emails";
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
      status_message: tSystem("connectors.statusConnectorNotFoundInInspected"),
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
