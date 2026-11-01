/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export const CONNECTOR_SELECTION_ERROR_CODE = Object.freeze({
  NOT_OWNED: "CONNECTOR_SELECTION_NOT_OWNED",
});

export function normalizeSelectedConnectorIds(input = []) {
  if (!Array.isArray(input)) return Object.freeze([]);
  return Object.freeze([...new Set(input.map((value) => text(value)).filter(Boolean))]);
}

export function assertSelectedConnectorsOwned(selectedConnectorIds = [], connectors = []) {
  const normalizedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
  const ownedIds = new Set(
    (Array.isArray(connectors) ? connectors : [])
      .map((item) => text(item?.connectorId))
      .filter(Boolean),
  );
  const unknownIds = normalizedIds.filter((connectorId) => !ownedIds.has(connectorId));
  if (unknownIds.length) {
    throw Object.assign(
      new TypeError(`selected connector is not owned by user: ${unknownIds.join(", ")}`),
      { code: CONNECTOR_SELECTION_ERROR_CODE.NOT_OWNED },
    );
  }
  return normalizedIds;
}
