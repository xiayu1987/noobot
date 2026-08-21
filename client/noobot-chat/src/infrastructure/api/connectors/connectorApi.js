/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const endpoint = (userId = "", suffix = "") =>
  `/api/internal/connectors/${encodeURIComponent(String(userId || "").trim())}${suffix}`;

export function getConnectorCatalog({ fetcher }) {
  return fetcher("/api/internal/connectors/catalog");
}

export function listUserConnectors({ userId, fetcher }) {
  return fetcher(endpoint(userId));
}

export function createUserConnector({ userId, connector, fetcher }) {
  return fetcher(endpoint(userId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connector),
  });
}

export function connectUserConnector({ userId, connectorId, fetcher }) {
  return fetcher(endpoint(userId, `/${encodeURIComponent(connectorId)}/connect`), {
    method: "POST",
  });
}

export function disconnectUserConnector({ userId, connectorId, fetcher }) {
  return fetcher(endpoint(userId, `/${encodeURIComponent(connectorId)}/disconnect`), {
    method: "POST",
  });
}

export function deleteUserConnector({ userId, connectorId, fetcher }) {
  return fetcher(endpoint(userId, `/${encodeURIComponent(connectorId)}`), {
    method: "DELETE",
  });
}
