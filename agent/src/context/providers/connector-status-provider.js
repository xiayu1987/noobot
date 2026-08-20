/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeSelectedConnectorIds,
  projectPublicConnector,
  projectSelectedConnectorContext,
} from "@noobot/connector-protocol";

export async function resolveConnectorStatusSection({
  userId = "",
  selectedConnectorIds = [],
  connectorChannelStore = null,
  connectorRegistry = null,
} = {}) {
  const ownerUserId = String(userId || "").trim();
  const selectedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
  if (!ownerUserId || !selectedIds.length) {
    return { connectors: [] };
  }
  if (!connectorRegistry || !connectorChannelStore) {
    throw new Error("selected connector runtime is unavailable");
  }

  const records = await connectorRegistry.list(ownerUserId);
  const runtimeById = new Map(
    connectorChannelStore
      .getUserConnectors(ownerUserId)
      .map((item) => [String(item.connectorId || "").trim(), item]),
  );
  const publicConnectors = records.map((record) =>
    projectPublicConnector(record, runtimeById.get(record.connectorId)),
  );
  return {
    connectors: projectSelectedConnectorContext(selectedIds, publicConnectors),
  };
}
