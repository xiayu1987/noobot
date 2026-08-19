/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();

export function normalizeConnectorHistoryItems(
  items = [],
  { disconnectedStatus = "disconnected", disconnectedMessage = "" } = {},
) {
  return (Array.isArray(items) ? items : []).map((item = {}) => ({
    connector_name: text(item.connector_name),
    connector_type: text(item.connector_type),
    connected_at: text(item.last_connected_at),
    connection_meta:
      item.connection_meta && typeof item.connection_meta === "object" ? item.connection_meta : {},
    status: text(item.status || disconnectedStatus) || disconnectedStatus,
    status_code: Number(item.status_code ?? 410),
    status_message: text(item.status_message) || disconnectedMessage,
    checked_at: text(item.checked_at || item.last_connected_at),
    last_connected_at: text(item.last_connected_at),
    connect_count: Number(item.connect_count || 0),
    connection_defaults:
      item.connection_defaults && typeof item.connection_defaults === "object"
        ? item.connection_defaults
        : {},
  }));
}

export function mergeConnectorStatusItems({
  runtimeConnectors = [],
  historyConnectors = [],
  connectedStatus = "connected",
  connectedMessage = "ok",
  disconnectedStatus = "disconnected",
  disconnectedMessage = "",
} = {}) {
  const history = normalizeConnectorHistoryItems(historyConnectors, {
    disconnectedStatus,
    disconnectedMessage,
  });
  const merged = new Map(
    history.map((item) => [text(item.connector_name), item]).filter(([key]) => key),
  );
  for (const runtimeItem of Array.isArray(runtimeConnectors) ? runtimeConnectors : []) {
    const connectorName = text(runtimeItem?.connector_name);
    if (!connectorName) continue;
    const previous = merged.get(connectorName) || {};
    merged.set(connectorName, {
      ...previous,
      ...runtimeItem,
      status: text(runtimeItem.status || connectedStatus) || connectedStatus,
      status_code: Number(runtimeItem.status_code ?? 0),
      status_message: text(runtimeItem.status_message || connectedMessage),
      checked_at:
        text(runtimeItem.checked_at || runtimeItem.connected_at) || text(previous.checked_at),
      last_connected_at: text(runtimeItem.connected_at) || text(previous.last_connected_at),
    });
  }
  return Array.from(merged.values()).sort((left, right) => {
    const leftTime = new Date(left.last_connected_at || left.checked_at || 0).getTime();
    const rightTime = new Date(right.last_connected_at || right.checked_at || 0).getTime();
    return rightTime - leftTime;
  });
}
