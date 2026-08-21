/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertConnectorAccessPort,
  normalizeSelectedConnectorIds,
  projectSelectedConnectorContext,
} from "@noobot/connector-protocol";

export async function resolveConnectorStatusSection({
  userId = "",
  selectedConnectorIds = [],
  connectorAccessPort = null,
} = {}) {
  const ownerUserId = String(userId || "").trim();
  const selectedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
  if (!ownerUserId || !selectedIds.length) {
    return { connectors: [] };
  }
  if (!connectorAccessPort) {
    throw new Error("selected connector access port is unavailable");
  }
  const publicConnectors =
    await assertConnectorAccessPort(connectorAccessPort).listUserConnectors(ownerUserId);
  return {
    connectors: projectSelectedConnectorContext(selectedIds, publicConnectors),
  };
}
