/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_TYPES } from "../constants/chatConstants";

export function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  return {
    database: String(source?.database || "").trim(),
    terminal: String(source?.terminal || "").trim(),
    email: String(source?.email || "").trim(),
  };
}

export function createConnectorPanelState(overrides = {}) {
  const normalizedSelectedConnectors = normalizeSelectedConnectors(
    overrides?.selectedConnectors || {},
  );
  return {
    rootSessionId: String(overrides?.rootSessionId || "").trim(),
    groups: {
      database: Array.isArray(overrides?.groups?.database)
        ? overrides.groups.database
        : [],
      terminal: Array.isArray(overrides?.groups?.terminal)
        ? overrides.groups.terminal
        : [],
      email: Array.isArray(overrides?.groups?.email)
        ? overrides.groups.email
        : [],
    },
    selectedConnectors: normalizedSelectedConnectors,
    updatedAt: new Date().toISOString(),
  };
}

export function sessionTitleFromMessages(messages = [], fallback = "新会话") {
  const firstUser = (Array.isArray(messages) ? messages : []).find(
    (messageItem) =>
      String(messageItem?.role || "").trim().toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  return firstUser ? String(firstUser.content || "").slice(0, 20) : fallback;
}

export function generateSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (placeholder) => {
      const randomValue = Math.floor(Math.random() * 16);
      const resolvedValue =
        placeholder === "x" ? randomValue : (randomValue & 0x3) | 0x8;
      return resolvedValue.toString(16);
    },
  );
}

export function resolveSelectedConnectorsWithDefaults({
  groups = {},
  selectedConnectors = {},
} = {}) {
  const normalizedGroups =
    groups && typeof groups === "object" ? groups : {};
  const selectedSource =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  const output = normalizeSelectedConnectors({});
  for (const connectorType of CONNECTOR_TYPES) {
    const groupItems = Array.isArray(normalizedGroups?.[connectorType])
      ? normalizedGroups[connectorType]
      : [];
    const selectedConnectorName = String(
      selectedSource?.[connectorType] || "",
    ).trim();
    output[connectorType] = selectedConnectorName || pickDefaultConnectorName(groupItems);
  }
  return output;
}

function pickDefaultConnectorName(groupItems = []) {
  const sourceItems = Array.isArray(groupItems) ? groupItems : [];
  if (!sourceItems.length) return "";
  const parseTime = (connectorItem = {}) => {
    const checkedTime = new Date(
      String(
        connectorItem?.checkedAt ||
          connectorItem?.checked_at ||
          connectorItem?.connectedAt ||
          connectorItem?.connected_at ||
          0,
      ),
    ).getTime();
    return Number.isFinite(checkedTime) ? checkedTime : 0;
  };
  const connectedItems = sourceItems.filter(
    (connectorItem) =>
      String(connectorItem?.status || "").trim().toLowerCase() === "connected",
  );
  const sortByRecent = (leftConnector, rightConnector) =>
    parseTime(rightConnector) - parseTime(leftConnector);
  const latestConnectedItem = connectedItems.sort(sortByRecent)[0] || null;
  const latestItem = [...sourceItems].sort(sortByRecent)[0] || null;
  const targetItem = latestConnectedItem || latestItem;
  return String(targetItem?.connectorName || "").trim();
}
