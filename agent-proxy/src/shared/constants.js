/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { EVENT_TYPE } from "@noobot/event-protocol";

export const CHANNEL_STATUS = {
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  RUNNING: "running",
  DONE: "done",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
};

export const CHANNEL_TERMINAL_STATUSES = Object.freeze([
  CHANNEL_STATUS.DONE,
  CHANNEL_STATUS.USER_STOPPED,
  CHANNEL_STATUS.ERROR,
]);

export const CHANNEL_RETENTION_PHASE = Object.freeze({
  ACTIVE: "active",
  TERMINAL_RETAINED: "terminal_retained",
  EXPIRED: "expired",
});

export const CONVERSATION_STATE = {
  NO_CONVERSATION: "no_conversation",
  SENDING: "sending",
  INTERACTION_PENDING: "interaction_pending",
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  STOPPING: "stopping",
  RECONNECTING: "reconnecting",
  EXPIRED: "expired",
};

export const CLIENT_ROLE = {
  USER: "user",
  SUPER_ADMIN: "super_admin",
};

export const WS_ACTION = {
  STOP: "stop",
  CONTINUE: "continue",
  RESUME: "resume",
  INTERACTION_RESPONSE: "interaction_response",
  JOIN: "join",
  RECONNECT: "reconnect",
  SNAPSHOT_GET: "turn.snapshot.get",
};

export const CONVERSATION_SOURCE_EVENT = {
  INIT: "init",
  RESTART: "restart",
  CHANNEL_STATUS: "channel_status",
  RECONNECT_CACHE_EXPIRED: "reconnect_cache_expired",
  STOP: WS_ACTION.STOP,
  CONTINUE: WS_ACTION.CONTINUE,
  RESUME: WS_ACTION.RESUME,
  INTERACTION_RESPONSE: WS_ACTION.INTERACTION_RESPONSE,
};

export const CONVERSATION_SCOPE_KEY = "__session__";

export const RECONNECT_SUGGESTION = {
  NONE: "",
  RELOAD_SESSION_HISTORY: "reload_session_history",
};

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
  UNSUPPORTED_ACTION: (action = "") =>
    `agentProxy unsupported action: ${String(action || "").trim()}`,
  CHANNEL_NOT_FOUND_FOR_STOP: "agentProxy channel not found for stop",
  CHANNEL_NOT_FOUND_FOR_INTERACTION:
    "agentProxy channel not found for interaction",
  CHANNEL_NOT_FOUND_FOR_JOIN: "agentProxy channel not found for join",
  PERMISSION_DENIED_FOR_ACTION: (action = "") =>
    `agentProxy permission denied for action: ${String(action || "").trim()}`,
  UPSTREAM_NOT_RUNNING: "agentProxy upstream not running",
  UPSTREAM_UNAVAILABLE: "agentProxy upstream is unavailable",
  REQUIRES_APIKEY: "agentProxy requires apikey",
  REQUIRES_USERID_SESSIONID: "agentProxy requires userId and sessionId",
  UPSTREAM_URL_EMPTY: "agentProxy upstream url is empty",
  FAILED_TO_SEND_PAYLOAD: "agentProxy failed to send payload",
  INVALID_UPSTREAM_EVENT: "agentProxy invalid upstream event",
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
