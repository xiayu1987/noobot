/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tSystem } from "../i18n/system-text.js";
import {
  CONNECTOR_TYPE,
  normalizeConnectorType,
} from "../config/core/enums.js";
import {
  CONNECTOR_RUNTIME_STATUS,
  CONNECTOR_STATUS_CODE,
} from "./constants.js";
import { matchesSensitiveFieldPattern } from "../tools/core/sensitive-field-patterns.js";

const HISTORY_FILE_NAME = "connector-history.json";

function isSensitiveKeyName(keyName = "") {
  return matchesSensitiveFieldPattern(keyName);
}

function sanitizeObject(inputValue = {}) {
  const sourceObject =
    inputValue && typeof inputValue === "object" && !Array.isArray(inputValue)
      ? inputValue
      : {};
  const sanitizedObject = {};
  for (const [rawKey, rawValue] of Object.entries(sourceObject)) {
    const normalizedKey = String(rawKey || "").trim();
    if (!normalizedKey || isSensitiveKeyName(normalizedKey)) continue;
    if (rawValue === undefined || rawValue === null) continue;
    sanitizedObject[normalizedKey] = rawValue;
  }
  return sanitizedObject;
}

function normalizeHistoryPayload(inputValue = {}) {
  const sourceObject =
    inputValue && typeof inputValue === "object" ? inputValue : {};
  const sourceSessions =
    sourceObject?.sessions && typeof sourceObject.sessions === "object"
      ? sourceObject.sessions
      : {};
  const normalizedSessions = {};
  for (const [rawSessionId, rawSessionValue] of Object.entries(sourceSessions)) {
    const normalizedSessionId = String(rawSessionId || "").trim();
    if (!normalizedSessionId) continue;
    const sessionValue =
      rawSessionValue && typeof rawSessionValue === "object"
        ? rawSessionValue
        : {};
    const sourceConnectors =
      sessionValue?.connectors && typeof sessionValue.connectors === "object"
        ? sessionValue.connectors
        : {};
    const normalizedConnectors = {
      [CONNECTOR_TYPE.DATABASE]: Array.isArray(
        sourceConnectors?.[CONNECTOR_TYPE.DATABASE],
      )
        ? sourceConnectors[CONNECTOR_TYPE.DATABASE]
        : [],
      [CONNECTOR_TYPE.TERMINAL]: Array.isArray(
        sourceConnectors?.[CONNECTOR_TYPE.TERMINAL],
      )
        ? sourceConnectors[CONNECTOR_TYPE.TERMINAL]
        : [],
      [CONNECTOR_TYPE.EMAIL]: Array.isArray(
        sourceConnectors?.[CONNECTOR_TYPE.EMAIL],
      )
        ? sourceConnectors[CONNECTOR_TYPE.EMAIL]
        : [],
    };
    normalizedSessions[normalizedSessionId] = {
      sessionId: normalizedSessionId,
      updatedAt: String(sessionValue?.updatedAt || "").trim(),
      connectors: normalizedConnectors,
    };
  }
  return {
    updatedAt: String(sourceObject?.updatedAt || "").trim(),
    sessions: normalizedSessions,
  };
}

class ConnectorHistoryStore {
  constructor({ workspaceRoot = "" } = {}) {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
    this.userLockMap = new Map();
  }

  setWorkspaceRoot(workspaceRoot = "") {
    this.workspaceRoot = path.resolve(String(workspaceRoot || "."));
  }

  _userHistoryFilePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      throw new Error(tSystem("connectors.historyUserIdRequired"));
    }
    return path.join(
      this.workspaceRoot,
      normalizedUserId,
      "runtime",
      "connectors",
      HISTORY_FILE_NAME,
    );
  }

  async _readHistory(userId = "") {
    const filePath = this._userHistoryFilePath(userId);
    try {
      const parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
      return normalizeHistoryPayload(parsedPayload);
    } catch {
      return normalizeHistoryPayload({});
    }
  }

  async _writeHistory(userId = "", payload = {}) {
    const filePath = this._userHistoryFilePath(userId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(normalizeHistoryPayload(payload), null, 2)}\n`,
      "utf8",
    );
  }

  async _withUserLock(userId = "", executor = async () => {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) throw new Error(tSystem("connectors.historyUserIdRequired"));
    const previousTask = this.userLockMap.get(normalizedUserId) || Promise.resolve();
    let releaseLock = () => {};
    const currentTask = new Promise((resolve) => {
      releaseLock = resolve;
    });
    this.userLockMap.set(normalizedUserId, previousTask.then(() => currentTask));
    await previousTask;
    try {
      return await executor();
    } finally {
      releaseLock();
      const latestTask = this.userLockMap.get(normalizedUserId);
      if (latestTask === currentTask) {
        this.userLockMap.delete(normalizedUserId);
      }
    }
  }

  async listSessionConnectors({ userId = "", sessionId = "" } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedUserId || !normalizedSessionId) {
      return {
        [CONNECTOR_TYPE.DATABASE]: [],
        [CONNECTOR_TYPE.TERMINAL]: [],
        [CONNECTOR_TYPE.EMAIL]: [],
      };
    }
    const historyPayload = await this._readHistory(normalizedUserId);
    const sessionHistory = historyPayload?.sessions?.[normalizedSessionId] || {};
    const sessionConnectors =
      sessionHistory?.connectors && typeof sessionHistory.connectors === "object"
        ? sessionHistory.connectors
        : {};
    return {
      [CONNECTOR_TYPE.DATABASE]: Array.isArray(
        sessionConnectors?.[CONNECTOR_TYPE.DATABASE],
      )
        ? sessionConnectors[CONNECTOR_TYPE.DATABASE]
        : [],
      [CONNECTOR_TYPE.TERMINAL]: Array.isArray(
        sessionConnectors?.[CONNECTOR_TYPE.TERMINAL],
      )
        ? sessionConnectors[CONNECTOR_TYPE.TERMINAL]
        : [],
      [CONNECTOR_TYPE.EMAIL]: Array.isArray(
        sessionConnectors?.[CONNECTOR_TYPE.EMAIL],
      )
        ? sessionConnectors[CONNECTOR_TYPE.EMAIL]
        : [],
    };
  }

  async upsertConnectedConnector({
    userId = "",
    sessionId = "",
    connectorType = "",
    connectorName = "",
    connectionInfo = {},
    connectionMeta = {},
  } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedConnectorType = normalizeConnectorType(connectorType);
    const normalizedConnectorName = String(connectorName || "").trim();
    if (
      !normalizedUserId ||
      !normalizedSessionId ||
      !normalizedConnectorType ||
      !normalizedConnectorName
    ) {
      return null;
    }
    return this._withUserLock(normalizedUserId, async () => {
      const nowIso = new Date().toISOString();
      const historyPayload = await this._readHistory(normalizedUserId);
      const sessions =
        historyPayload?.sessions && typeof historyPayload.sessions === "object"
          ? historyPayload.sessions
          : {};
      const currentSessionValue =
        sessions?.[normalizedSessionId] && typeof sessions[normalizedSessionId] === "object"
          ? sessions[normalizedSessionId]
          : { sessionId: normalizedSessionId, connectors: {} };
      const currentConnectors =
        currentSessionValue?.connectors && typeof currentSessionValue.connectors === "object"
          ? currentSessionValue.connectors
          : {};
      const connectorList = Array.isArray(currentConnectors?.[normalizedConnectorType])
        ? [...currentConnectors[normalizedConnectorType]]
        : [];
      const existingIndex = connectorList.findIndex(
        (connectorItem) =>
          String(connectorItem?.connector_name || "").trim() ===
          normalizedConnectorName,
      );
      const existingItem =
        existingIndex >= 0 && connectorList[existingIndex]
          ? connectorList[existingIndex]
          : {};
      const sanitizedDefaults = sanitizeObject(connectionInfo);
      const sanitizedMeta = sanitizeObject(connectionMeta);
      const nextItem = {
        connector_name: normalizedConnectorName,
        connector_type: normalizedConnectorType,
        status: CONNECTOR_RUNTIME_STATUS.DISCONNECTED,
        status_code: CONNECTOR_STATUS_CODE.DISCONNECTED_HISTORY,
        status_message: tSystem("status.disconnectedFromHistory"),
        checked_at: nowIso,
        last_connected_at: nowIso,
        connect_count: Number(existingItem?.connect_count || 0) + 1,
        connection_defaults: {
          ...(existingItem?.connection_defaults &&
          typeof existingItem.connection_defaults === "object"
            ? existingItem.connection_defaults
            : {}),
          ...sanitizedDefaults,
        },
        connection_meta: {
          ...(existingItem?.connection_meta &&
          typeof existingItem.connection_meta === "object"
            ? existingItem.connection_meta
            : {}),
          ...sanitizedMeta,
        },
      };
      if (existingIndex >= 0) {
        connectorList[existingIndex] = nextItem;
      } else {
        connectorList.push(nextItem);
      }
      connectorList.sort((leftItem, rightItem) => {
        const leftTime = new Date(leftItem?.last_connected_at || 0).getTime();
        const rightTime = new Date(rightItem?.last_connected_at || 0).getTime();
        return rightTime - leftTime;
      });
      const nextSessionValue = {
        ...currentSessionValue,
        sessionId: normalizedSessionId,
        updatedAt: nowIso,
        connectors: {
          [CONNECTOR_TYPE.DATABASE]: Array.isArray(
            currentConnectors?.[CONNECTOR_TYPE.DATABASE],
          )
            ? currentConnectors[CONNECTOR_TYPE.DATABASE]
            : [],
          [CONNECTOR_TYPE.TERMINAL]: Array.isArray(
            currentConnectors?.[CONNECTOR_TYPE.TERMINAL],
          )
            ? currentConnectors[CONNECTOR_TYPE.TERMINAL]
            : [],
          [CONNECTOR_TYPE.EMAIL]: Array.isArray(
            currentConnectors?.[CONNECTOR_TYPE.EMAIL],
          )
            ? currentConnectors[CONNECTOR_TYPE.EMAIL]
            : [],
          [normalizedConnectorType]: connectorList,
        },
      };
      const nextPayload = {
        ...historyPayload,
        updatedAt: nowIso,
        sessions: {
          ...sessions,
          [normalizedSessionId]: nextSessionValue,
        },
      };
      await this._writeHistory(normalizedUserId, nextPayload);
      return nextItem;
    });
  }

  async deleteSessionHistory({ userId = "", sessionId = "" } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedUserId || !normalizedSessionId) return false;
    return this._withUserLock(normalizedUserId, async () => {
      const historyPayload = await this._readHistory(normalizedUserId);
      const sessions =
        historyPayload?.sessions && typeof historyPayload.sessions === "object"
          ? { ...historyPayload.sessions }
          : {};
      if (!sessions?.[normalizedSessionId]) return false;
      delete sessions[normalizedSessionId];
      await this._writeHistory(normalizedUserId, {
        ...historyPayload,
        updatedAt: new Date().toISOString(),
        sessions,
      });
      return true;
    });
  }
}

let globalConnectorHistoryStore = null;

export function initConnectorHistoryStore({ workspaceRoot = "" } = {}) {
  if (!globalConnectorHistoryStore) {
    globalConnectorHistoryStore = new ConnectorHistoryStore({
      workspaceRoot,
    });
  } else if (workspaceRoot) {
    globalConnectorHistoryStore.setWorkspaceRoot(workspaceRoot);
  }
  return globalConnectorHistoryStore;
}

export function getConnectorHistoryStore() {
  return initConnectorHistoryStore({});
}
