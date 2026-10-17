/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export const CHANNEL_STATUS = {
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  RUNNING: "running",
  DONE: "done",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
};

export const CHANNEL_RETENTION_PHASE = Object.freeze({
  ACTIVE: "active",
  TERMINAL_RETAINED: "terminal_retained",
  EXPIRED: "expired",
});

export const CLIENT_ROLE = {
  USER: "user",
  SUPER_ADMIN: "super_admin",
};

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

export const AGENT_PROXY_ERROR = {
  DEFAULT: "agentProxy error",
  INVALID_JSON_PAYLOAD: "agentProxy invalid json payload",
  UNSUPPORTED_ACTION: (action = "") => `agentProxy unsupported action: ${text(action)}`,
  CHANNEL_NOT_FOUND_FOR_STOP: "agentProxy channel not found for stop",
  CHANNEL_NOT_FOUND_FOR_INTERACTION: "agentProxy channel not found for interaction",
  PERMISSION_DENIED_FOR_ACTION: (action = "") =>
    `agentProxy permission denied for action: ${text(action)}`,
  UPSTREAM_NOT_RUNNING: "agentProxy upstream not running",
  UPSTREAM_UNAVAILABLE: "agentProxy upstream is unavailable",
  REQUIRES_APIKEY: "agentProxy requires apikey",
  REQUIRES_USERID_SESSIONID: "agentProxy requires userId and sessionId",
  UPSTREAM_URL_EMPTY: "agentProxy upstream url is empty",
  FAILED_TO_SEND_PAYLOAD: "agentProxy failed to send payload",
  INVALID_UPSTREAM_EVENT: "agentProxy invalid upstream event",
  RECONNECT_FAILED: "agentProxy reconnect failed",
  ROUTE_FAILED: "agentProxy websocket route failed",
  INVALID_REQUEST_URL: "agentProxy invalid request url",
  UPSTREAM_HTTP_ERROR: "agentProxy upstream http error",
  REQUEST_BODY_TOO_LARGE: "agentProxy request body too large",
  INVALID_UPSTREAM_BASE_URL: "agentProxy invalid upstream base url",
  CONNECT_INTERCEPT_FAILED: "agentProxy connect intercept failed",
  CONNECT_INTERCEPT_ERROR: "agentProxy connect intercept error",
  CLIENT_IP_NOT_ALLOWED: "agentProxy client ip not allowed",
  ORIGIN_NOT_ALLOWED: "agentProxy origin not allowed",
  MISSING_APIKEY: "agentProxy missing apikey",
};

export const AGENT_PROXY_CLOSE_REASON = {
  MISSING_APIKEY: "missing_apikey",
};
