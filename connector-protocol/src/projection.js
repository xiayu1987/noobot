/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();

export function projectPublicConnector(record = {}, runtimeStatus = {}) {
  return Object.freeze({
    connectorId: text(record.connectorId),
    name: text(record.name),
    type: text(record.type),
    subType: text(record.subType),
    status: text(runtimeStatus.status || "disconnected") || "disconnected",
    statusCode: Number(runtimeStatus.statusCode ?? 0),
    statusMessage: text(runtimeStatus.statusMessage),
    connectedAt: text(runtimeStatus.connectedAt),
    createdAt: text(record.createdAt),
    updatedAt: text(record.updatedAt),
  });
}

export function projectSelectedConnectorContext(selectedConnectorIds = [], publicConnectors = []) {
  const selected = new Set(Array.isArray(selectedConnectorIds) ? selectedConnectorIds : []);
  return Object.freeze(
    (Array.isArray(publicConnectors) ? publicConnectors : [])
      .filter((item) => selected.has(item.connectorId))
      .map((item) =>
        Object.freeze({
          connector_id: text(item.connectorId),
          connector_name: text(item.name),
          connector_type: text(item.type),
          connector_sub_type: text(item.subType),
        }),
      ),
  );
}
