/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_STATUS = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
});

export const CONNECTOR_ACCESS_CANCELLATION = Object.freeze({
  REQUEST_CANCELLABLE: "request_cancellable",
  NOT_CANCELLABLE: "not_cancellable",
});

export function assertConnectorAccessCancellation(value) {
  const normalized = String(value || "").trim();
  if (!Object.values(CONNECTOR_ACCESS_CANCELLATION).includes(normalized)) {
    throw new TypeError(`connector access cancellation is invalid: ${value}`);
  }
  return normalized;
}

export function assertConnectorInstanceImplementation(implementation = {}) {
  const definition = implementation.definition;
  if (!definition?.instanceType) throw new TypeError("connector definition is required");
  for (const method of ["create", "health", "access", "dispose"]) {
    if (typeof implementation[method] !== "function") {
      throw new TypeError(`connector implementation method is required: ${method}`);
    }
  }
  assertConnectorAccessCancellation(implementation.accessCancellation);
  return implementation;
}

export function assertConnectorAccessPort(port = {}) {
  for (const method of ["access", "listUserConnectors"]) {
    if (typeof port?.[method] !== "function") {
      throw new TypeError(`connector access port method is required: ${method}`);
    }
  }
  return port;
}

export function createConnectorConnectionResult(connector = {}) {
  const status = String(connector?.status || "").trim();
  if (!Object.values(CONNECTOR_STATUS).includes(status)) {
    throw new TypeError(`connector status is invalid: ${status}`);
  }
  return Object.freeze({
    connected: status === CONNECTOR_STATUS.CONNECTED,
    connector,
  });
}
