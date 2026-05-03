/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tSystem } from "../i18n/system-text.js";

const HISTORY_FILE_NAME = "connector-history.json";
const CONNECTOR_TYPES = ["database", "terminal", "email"];

function normalizeConnectorType(connectorType = "") {
  const normalizedConnectorType = String(connectorType || "")
    .trim()
    .toLowerCase();
  if (normalizedConnectorType === "db") return "database";
  if (normalizedConnectorType === "shell") return "terminal";
  if (normalizedConnectorType === "mail") return "email";
  return CONNECTOR_TYPES.includes(normalizedConnectorType)
    ? normalizedConnectorType
    : "";
}

function isSensitiveKeyName(keyName = "") {
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
      database: Array.isArray(sourceConnectors?.database)
        ? sourceConnectors.database
        : [],
      terminal: Array.isArray(sourceConnectors?.terminal)
        ? sourceConnectors.terminal
        : [],
      email: Array.isArray(sourceConnectors?.email)
        ? sourceConnectors.email
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
      return { database: [], terminal: [], email: [] };
    }
    const historyPayload = await this._readHistory(normalizedUserId);
    const sessionHistory = historyPayload?.sessions?.[normalizedSessionId] || {};
    const sessionConnectors =
      sessionHistory?.connectors && typeof sessionHistory.connectors === "object"
        ? sessionHistory.connectors
        : {};
    return {
      database: Array.isArray(sessionConnectors?.database)
        ? sessionConnectors.database
        : [],
      terminal: Array.isArray(sessionConnectors?.terminal)
        ? sessionConnectors.terminal
        : [],
      email: Array.isArray(sessionConnectors?.email) ? sessionConnectors.email : [],
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
        status: "disconnected",
        status_code: 410,
        status_message: tSystem("connectors.historyDisconnected"),
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
          database: Array.isArray(currentConnectors?.database)
            ? currentConnectors.database
            : [],
          terminal: Array.isArray(currentConnectors?.terminal)
            ? currentConnectors.terminal
            : [],
          email: Array.isArray(currentConnectors?.email)
            ? currentConnectors.email
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
