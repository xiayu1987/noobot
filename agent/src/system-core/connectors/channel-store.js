/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeDatabaseCommand } from "./databases/index.js";
import { executeTerminalCommand } from "./terminals/index.js";
import { releaseTerminalChannel } from "./terminals/index.js";
import { executeEmailCommand } from "./emails/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { recoverableToolError } from "../error/index.js";
import { ERROR_CODE } from "../error/constants.js";
import { matchesSensitiveFieldPattern } from "../tools/core/sensitive-field-patterns.js";
import {
  CONNECTOR_TYPE,
  normalizeConnectorType,
} from "../config/core/enums.js";
import { normalizeTimeMs } from "../config/core/time-config-normalizer.js";
import {
  CONNECTOR_RUNTIME_STATUS,
  CONNECTOR_STATUS_CODE,
  CONNECTOR_RUNTIME_STATUS_TEXT,
} from "./constants.js";

function hasSensitiveKeyName(keyName = "") {
  return matchesSensitiveFieldPattern(keyName);
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
    if (!sid) {
      throw recoverableToolError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
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

  _resolveBucketMap(bucket = {}, connectorType = "") {
    const normalizedType = normalizeConnectorType(connectorType);
    if (normalizedType === CONNECTOR_TYPE.DATABASE) return bucket.databases;
    if (normalizedType === CONNECTOR_TYPE.TERMINAL) return bucket.terminals;
    if (normalizedType === CONNECTOR_TYPE.EMAIL) return bucket.emails;
    return null;
  }

  _registerConnectorChannel(bucket = {}, channel = {}) {
    const sourceMap = this._resolveBucketMap(bucket, channel?.connectorType || "");
    const normalizedName = String(channel?.connectorName || "").trim();
    if (!(sourceMap instanceof Map) || !normalizedName) return false;
    sourceMap.set(normalizedName, channel);
    return true;
  }

  _unregisterConnectorChannel({
    bucket = {},
    connectorType = "",
    connectorName = "",
    sessionId = "",
  } = {}) {
    const sourceMap = this._resolveBucketMap(bucket, connectorType);
    const normalizedName = String(connectorName || "").trim();
    if (!(sourceMap instanceof Map) || !normalizedName) {
      return { deleted: false, channel: null };
    }
    const existingChannel = sourceMap.get(normalizedName) || null;
    const deleted = sourceMap.delete(normalizedName);
    if (deleted && normalizeConnectorType(connectorType) === CONNECTOR_TYPE.TERMINAL) {
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
    return { deleted, channel: existingChannel };
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
    if (!normalizedName) {
      throw recoverableToolError(tSystem("connectors.connectorNameRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    if (!normalizedType) {
      throw recoverableToolError(tSystem("connectors.connectorTypeInvalid"), {
        code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
      });
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
        normalizedType === CONNECTOR_TYPE.DATABASE
          ? {
              databaseType: String(info?.database_type || ""),
            }
          : normalizedType === CONNECTOR_TYPE.TERMINAL
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
    this._registerConnectorChannel(bucket, channel);
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
    const { deleted } = this._unregisterConnectorChannel({
      bucket,
      connectorType: normalizedType,
      connectorName: normalizedName,
      sessionId,
    });
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
    if (!normalizedName) {
      throw recoverableToolError(tSystem("connectors.connectorNameRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    if (!normalizedType) {
      throw recoverableToolError(tSystem("connectors.connectorTypeInvalid"), {
        code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
      });
    }
    const bucket = this._ensureSessionBucket(sessionId);
    const sourceMap = this._resolveBucketMap(bucket, normalizedType);
    const channel = sourceMap.get(normalizedName);
    if (!channel) {
      throw recoverableToolError(
        `${tSystem("connectors.connectorNotConnectedInSession")}: ${normalizedName}`,
        { code: ERROR_CODE.RECOVERABLE_CONNECTOR_NOT_CONNECTED },
      );
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
    const resolvedTimeoutMs = normalizeTimeMs(timeoutMs, {
      fallback: 30000,
      min: 1000,
    });
    const channel = this._getChannel({ sessionId, connectorName, connectorType });
    const normalizedType = normalizeConnectorType(connectorType);
    const cmd = String(command || "").trim();
    if (!cmd) {
      throw recoverableToolError(tSystem("connectors.commandRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    if (normalizedType === CONNECTOR_TYPE.TERMINAL) {
      const execution = await executeTerminalCommand({
        command: cmd,
        channelKey: `${String(sessionId || "").trim()}::${String(
          connectorName || "",
        ).trim()}`,
        sessionId: String(sessionId || "").trim(),
        connectorName: String(connectorName || "").trim(),
        connectionInfo:
          channel?.connectionInfo && typeof channel.connectionInfo === "object"
            ? { ...channel.connectionInfo, timeout_ms: resolvedTimeoutMs }
            : { timeout_ms: resolvedTimeoutMs },
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
    if (normalizedType === CONNECTOR_TYPE.EMAIL) {
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
    if (normalizedConnectorType === CONNECTOR_TYPE.DATABASE) return "SELECT 1 WHERE 1=1";
    if (normalizedConnectorType === CONNECTOR_TYPE.TERMINAL)
      return "printf __NOOBOT_CONNECTOR_HEALTH__";
    if (normalizedConnectorType === CONNECTOR_TYPE.EMAIL)
      return JSON.stringify({ action: "list", folder: "INBOX", page: 1, page_size: 1 });
    return "";
  }

  async inspectSessionConnectors({
    sessionId = "",
    timeoutMs = 6000,
  } = {}) {
    const resolvedTimeoutMs = normalizeTimeMs(timeoutMs, {
      fallback: 6000,
      min: 1000,
    });
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
        status: CONNECTOR_RUNTIME_STATUS.UNKNOWN,
        status_code: CONNECTOR_STATUS_CODE.UNAVAILABLE,
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
          timeoutMs: resolvedTimeoutMs,
        });
        const executionCode = Number(executionResult?.output?.code ?? 0);
        const executionOk = executionResult?.ok === true;
        return {
          ...baseStatus,
          status: executionOk
            ? CONNECTOR_RUNTIME_STATUS.CONNECTED
            : CONNECTOR_RUNTIME_STATUS.ERROR,
          status_code: Number.isFinite(executionCode)
            ? executionCode
            : executionOk
              ? CONNECTOR_STATUS_CODE.OK
              : CONNECTOR_STATUS_CODE.ERROR_DEFAULT,
          status_message: executionOk
            ? CONNECTOR_RUNTIME_STATUS_TEXT.OK
            : String(executionResult?.output?.stderr || "").trim(),
          checked_at: new Date().toISOString(),
        };
      } catch (error) {
        return {
          ...baseStatus,
          status: CONNECTOR_RUNTIME_STATUS.ERROR,
          status_code: CONNECTOR_STATUS_CODE.INTERNAL_ERROR,
          status_message: String(
            error?.message ||
              error ||
              CONNECTOR_RUNTIME_STATUS_TEXT.HEALTH_CHECK_FAILED,
          ),
          checked_at: new Date().toISOString(),
        };
      }
    };
    const databases = await Promise.all(
      databaseSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, CONNECTOR_TYPE.DATABASE),
      ),
    );
    const terminals = await Promise.all(
      terminalSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, CONNECTOR_TYPE.TERMINAL),
      ),
    );
    const emails = await Promise.all(
      emailSourceList.map((connectorItem) =>
        resolveConnectorStatus(connectorItem, CONNECTOR_TYPE.EMAIL),
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
          (connectorItem) =>
            String(connectorItem?.status || "") ===
            CONNECTOR_RUNTIME_STATUS.CONNECTED,
        ).length,
        error_count: allConnectors.filter(
          (connectorItem) =>
            String(connectorItem?.status || "") ===
            CONNECTOR_RUNTIME_STATUS.ERROR,
        ).length,
        unknown_count: allConnectors.filter(
          (connectorItem) =>
            String(connectorItem?.status || "") ===
            CONNECTOR_RUNTIME_STATUS.UNKNOWN,
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
    const resolvedTimeoutMs = normalizeTimeMs(timeoutMs, {
      fallback: 6000,
      min: 1000,
    });
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedConnectorName = String(connectorName || "").trim();
    const normalizedConnectorType = normalizeConnectorType(connectorType);
    if (!normalizedSessionId) {
      return {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: CONNECTOR_RUNTIME_STATUS.UNKNOWN,
        status_code: CONNECTOR_STATUS_CODE.BAD_REQUEST,
        status_message: tSystem("common.sessionIdRequired"),
      };
    }
    if (!normalizedConnectorName || !normalizedConnectorType) {
      return {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: CONNECTOR_RUNTIME_STATUS.INVALID,
        status_code: CONNECTOR_STATUS_CODE.BAD_REQUEST,
        status_message: tSystem("connectors.statusInvalidConnectorIdentity"),
      };
    }
    const inspected = await this.inspectSessionConnectors({
      sessionId: normalizedSessionId,
      timeoutMs: resolvedTimeoutMs,
    });
    const bucketName =
      normalizedConnectorType === CONNECTOR_TYPE.DATABASE
        ? "databases"
        : normalizedConnectorType === CONNECTOR_TYPE.TERMINAL
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
      status: CONNECTOR_RUNTIME_STATUS.UNKNOWN,
      status_code: CONNECTOR_STATUS_CODE.NOT_FOUND,
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
