/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeSelectedConnectorIds(input = []) {
  if (!Array.isArray(input)) return Object.freeze([]);
  return Object.freeze([
    ...new Set(input.map((value) => String(value || "").trim()).filter(Boolean)),
  ]);
}

export function assertSelectedConnectorsOwned(selectedConnectorIds = [], connectors = []) {
  const normalizedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
  const ownedIds = new Set(
    (Array.isArray(connectors) ? connectors : [])
      .map((item) => String(item?.connectorId || "").trim())
      .filter(Boolean),
  );
  const unknownIds = normalizedIds.filter((connectorId) => !ownedIds.has(connectorId));
  if (unknownIds.length)
    throw new TypeError(`selected connector is not owned by user: ${unknownIds.join(", ")}`);
  return normalizedIds;
}
