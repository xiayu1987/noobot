/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_RUNTIME_STATUS = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
  UNKNOWN: "unknown",
  INVALID: "invalid",
};

export const CONNECTOR_RUNTIME_STATUS_TEXT = {
  OK: "ok",
  HEALTH_CHECK_FAILED: "health check failed",
};

export const CONNECTOR_STATUS_CODE = {
  OK: 0,
  ERROR_DEFAULT: 1,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  DISCONNECTED_HISTORY: 410,
  INTERNAL_ERROR: 500,
  UNAVAILABLE: 503,
};

export const CONNECTOR_INTERACTION_EVENT = {
  STATUS: "connector_status",
};

export const CONNECTOR_INTERACTION_TYPE = {
  CONNECTED: "connector_connected",
  RECONNECT_REQUIRED: "connector_reconnect_required",
};

export const CONNECTOR_TOOL_NAME = {
  CONNECT_DATABASE: "database_connect_connector",
  CONNECT_TERMINAL: "terminal_connect_connector",
  CONNECT_EMAIL: "email_connect_connector",
};
