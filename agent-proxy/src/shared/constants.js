/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const CHANNEL_ACTIVITY_PHASE = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
});

export const UPSTREAM_TRANSPORT_PHASE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  DISPOSED: "disposed",
});

export const CHANNEL_RETENTION_PHASE = Object.freeze({
  ACTIVE: "active",
  TERMINAL_RETAINED: "terminal_retained",
  EXPIRED: "expired",
});

export const CONVERSATION_SOURCE_EVENT = {
  INIT: "init",
  RESTART: "restart",
  CHANNEL_STATUS: "channel_status",
};

export const SESSION_CHANNEL_STATE_KEY = "__session__";

export const TRANSPORT_TRACE_PROTOCOL_KIND = Object.freeze({
  MESSAGE_EVENT: "message_event",
  NON_MESSAGE_EVENT: "non_message_event",
});

export const UPSTREAM_CLOSE_REASON = {
  CLOSED: "closed",
  SEND_FAILED: "send_failed",
  INVALID_UPSTREAM_EVENT: "invalid_upstream_event",
  RESTART: "restart",
  CLEANUP: "cleanup",
};

export const AGENT_PROXY_HTTP_ERROR_CODE = Object.freeze({
  CLIENT_IP_NOT_ALLOWED: "CLIENT_IP_NOT_ALLOWED",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  INVALID_REQUEST_URL: "INVALID_REQUEST_URL",
  UPSTREAM_HTTP_ERROR: "UPSTREAM_HTTP_ERROR",
  REQUEST_BODY_TOO_LARGE: "REQUEST_BODY_TOO_LARGE",
  REQUEST_BODY_READ_FAILED: "REQUEST_BODY_READ_FAILED",
  INVALID_UPSTREAM_BASE_URL: "INVALID_UPSTREAM_BASE_URL",
  CONNECT_INTERCEPT_FAILED: "CONNECT_INTERCEPT_FAILED",
  CONNECT_INTERCEPT_ERROR: "CONNECT_INTERCEPT_ERROR",
});

export const AGENT_PROXY_CLOSE_REASON = {
  UNAUTHENTICATED: "unauthenticated",
};
