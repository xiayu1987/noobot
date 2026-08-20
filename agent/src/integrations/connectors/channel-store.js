/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildConnectorConnectionInfo, CONNECTOR_TYPE } from "@noobot/connector-protocol";
import { normalizeTimeMs } from "@noobot/agent-config-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { tSystem } from "noobot-i18n/agent/system-text";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { executeDatabaseCommand } from "./databases/index.js";
import { executeEmailCommand } from "./emails/index.js";
import { executeTerminalCommand, releaseTerminalChannel } from "./terminals/index.js";
import {
  CONNECTOR_RUNTIME_STATUS,
  CONNECTOR_RUNTIME_STATUS_TEXT,
  CONNECTOR_STATUS_CODE,
} from "./constants.js";

function normalizeUserId(userId = "") {
  const normalized = String(userId || "").trim();
  if (!normalized) {
    throw recoverableToolError("connector owner userId is required", {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  return normalized;
}

function publicRuntimeStatus(channel = {}) {
  return {
    connectorId: String(channel.connectorId || "").trim(),
    connectorName: String(channel.name || "").trim(),
    connectorType: String(channel.type || "").trim(),
    connectorSubType: String(channel.subType || "").trim(),
    status: CONNECTOR_RUNTIME_STATUS.CONNECTED,
    statusCode: CONNECTOR_STATUS_CODE.OK,
    statusMessage: CONNECTOR_RUNTIME_STATUS_TEXT.OK,
    connectedAt: String(channel.connectedAt || "").trim(),
  };
}

export class ConnectorChannelStore {
  constructor() {
    this.userChannels = new Map();
  }

  _userBucket(userId = "", { create = true } = {}) {
    const ownerUserId = normalizeUserId(userId);
    if (!this.userChannels.has(ownerUserId) && create) {
      this.userChannels.set(ownerUserId, new Map());
    }
    return this.userChannels.get(ownerUserId) || null;
  }

  getUserConnectors(userId = "") {
    const bucket = this._userBucket(userId, { create: false });
    return bucket ? Array.from(bucket.values()).map(publicRuntimeStatus) : [];
  }

  getConnector({ userId = "", connectorId = "" } = {}) {
    return (
      this._userBucket(userId, { create: false })?.get(String(connectorId || "").trim()) || null
    );
  }

  connectConnector({ userId = "", connector = {} } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const connectorId = String(connector?.connectorId || "").trim();
    if (!connectorId || String(connector?.ownerUserId || "").trim() !== ownerUserId) {
      throw recoverableToolError("connector does not belong to current user", {
        code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
      });
    }
    const connectionInfo = buildConnectorConnectionInfo({
      type: connector.type,
      subType: connector.subType,
      parameters: connector.parameters,
    });
    const channel = {
      connectorId,
      ownerUserId,
      name: String(connector.name || "").trim(),
      type: String(connector.type || "").trim(),
      subType: String(connector.subType || "").trim(),
      connectionInfo,
      connectedAt: new Date().toISOString(),
    };
    this._userBucket(ownerUserId).set(connectorId, channel);
    return publicRuntimeStatus(channel);
  }

  disconnectConnector({ userId = "", connectorId = "" } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const normalizedId = String(connectorId || "").trim();
    const bucket = this._userBucket(ownerUserId, { create: false });
    const channel = bucket?.get(normalizedId) || null;
    if (!channel) return false;
    if (channel.type === CONNECTOR_TYPE.TERMINAL) {
      releaseTerminalChannel({
        connectionInfo: channel.connectionInfo,
        channelKey: `${ownerUserId}::${normalizedId}`,
        sessionId: ownerUserId,
        connectorName: normalizedId,
      });
    }
    bucket.delete(normalizedId);
    if (!bucket.size) this.userChannels.delete(ownerUserId);
    return true;
  }

  releaseUserConnectors(userId = "") {
    const ownerUserId = normalizeUserId(userId);
    const connectorIds = this.getUserConnectors(ownerUserId).map((item) => item.connectorId);
    for (const connectorId of connectorIds) {
      this.disconnectConnector({ userId: ownerUserId, connectorId });
    }
    return {
      released: connectorIds.length > 0,
      userId: ownerUserId,
      releasedCount: connectorIds.length,
    };
  }

  _requireChannel({ userId = "", connectorId = "" } = {}) {
    const channel = this.getConnector({ userId, connectorId });
    if (!channel) {
      throw recoverableToolError(tSystem("connectors.connectorNotConnectedInSession"), {
        code: ERROR_CODE.RECOVERABLE_CONNECTOR_NOT_CONNECTED,
      });
    }
    return channel;
  }

  async executeConnectorCommand({
    userId = "",
    connectorId = "",
    command = "",
    timeoutMs = TIME_THRESHOLDS.connectors.channelCommandTimeoutMs,
    emailAttachmentHandler = null,
  } = {}) {
    const ownerUserId = normalizeUserId(userId);
    const channel = this._requireChannel({ userId: ownerUserId, connectorId });
    const normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) {
      throw recoverableToolError(tSystem("connectors.commandRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    const resolvedTimeoutMs = normalizeTimeMs(timeoutMs, {
      fallback: TIME_THRESHOLDS.connectors.channelCommandTimeoutMs,
      min: 1000,
    });
    let execution;
    if (channel.type === CONNECTOR_TYPE.TERMINAL) {
      execution = await executeTerminalCommand({
        command: normalizedCommand,
        channelKey: `${ownerUserId}::${channel.connectorId}`,
        sessionId: ownerUserId,
        connectorName: channel.connectorId,
        connectionInfo: { ...channel.connectionInfo, timeout_ms: resolvedTimeoutMs },
      });
    } else if (channel.type === CONNECTOR_TYPE.EMAIL) {
      execution = await executeEmailCommand({
        command: normalizedCommand,
        attachmentHandler: emailAttachmentHandler,
        connectionInfo: channel.connectionInfo,
      });
    } else {
      execution = await executeDatabaseCommand({
        command: normalizedCommand,
        connectionInfo: channel.connectionInfo,
      });
    }
    return {
      ok: execution?.ok === true,
      connector: publicRuntimeStatus(channel),
      output: {
        code: Number(execution?.code || 0),
        stdout: String(execution?.stdout || ""),
        stderr: String(execution?.stderr || ""),
      },
    };
  }

  _healthCommand(type = "") {
    if (type === CONNECTOR_TYPE.DATABASE) return "SELECT 1 WHERE 1=1";
    if (type === CONNECTOR_TYPE.TERMINAL) return "printf __NOOBOT_CONNECTOR_HEALTH__";
    if (type === CONNECTOR_TYPE.EMAIL) {
      return JSON.stringify({ action: "list", folder: "INBOX", page: 1, page_size: 1 });
    }
    return "";
  }

  async inspectConnector({
    userId = "",
    connectorId = "",
    timeoutMs = TIME_THRESHOLDS.connectors.quickInspectTimeoutMs,
  } = {}) {
    const channel = this.getConnector({ userId, connectorId });
    if (!channel) {
      return {
        connectorId: String(connectorId || "").trim(),
        status: CONNECTOR_RUNTIME_STATUS.DISCONNECTED,
        statusCode: CONNECTOR_STATUS_CODE.NOT_FOUND,
        statusMessage: "disconnected",
      };
    }
    try {
      const result = await this.executeConnectorCommand({
        userId,
        connectorId,
        command: this._healthCommand(channel.type),
        timeoutMs,
      });
      return {
        ...publicRuntimeStatus(channel),
        status: result.ok ? CONNECTOR_RUNTIME_STATUS.CONNECTED : CONNECTOR_RUNTIME_STATUS.ERROR,
        statusCode: Number(result.output.code || 0),
        statusMessage: result.ok ? CONNECTOR_RUNTIME_STATUS_TEXT.OK : result.output.stderr,
      };
    } catch (error) {
      return {
        ...publicRuntimeStatus(channel),
        status: CONNECTOR_RUNTIME_STATUS.ERROR,
        statusCode: CONNECTOR_STATUS_CODE.INTERNAL_ERROR,
        statusMessage: String(error?.message || error),
      };
    }
  }

  async inspectUserConnectors({
    userId = "",
    connectorIds = null,
    timeoutMs = TIME_THRESHOLDS.connectors.quickInspectTimeoutMs,
  } = {}) {
    const selectedSet = Array.isArray(connectorIds) ? new Set(connectorIds) : null;
    const runtime = this.getUserConnectors(userId).filter(
      (item) => !selectedSet || selectedSet.has(item.connectorId),
    );
    const connectors = await Promise.all(
      runtime.map((item) =>
        this.inspectConnector({ userId, connectorId: item.connectorId, timeoutMs }),
      ),
    );
    const summary = {
      total_count: connectors.length,
      connected_count: connectors.filter(
        (item) => item.status === CONNECTOR_RUNTIME_STATUS.CONNECTED,
      ).length,
      error_count: connectors.filter((item) => item.status === CONNECTOR_RUNTIME_STATUS.ERROR)
        .length,
      unknown_count: connectors.filter(
        (item) =>
          ![CONNECTOR_RUNTIME_STATUS.CONNECTED, CONNECTOR_RUNTIME_STATUS.ERROR].includes(
            item.status,
          ),
      ).length,
    };
    return { userId: String(userId || "").trim(), connectors, summary };
  }
}

let globalConnectorChannelStore = null;

export function initConnectorChannelStore() {
  if (!globalConnectorChannelStore) globalConnectorChannelStore = new ConnectorChannelStore();
  return globalConnectorChannelStore;
}

export function getConnectorChannelStore() {
  return initConnectorChannelStore();
}
