/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function envNumber(name, defaultValue, min = 0) {
  return Math.max(min, Number(process.env[name] ?? defaultValue));
}

function envString(name, defaultValue) {
  return String(process.env[name] ?? defaultValue).trim();
}

function envBoolean(name, defaultValue = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return Boolean(defaultValue);
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return Boolean(defaultValue);
}

export const config = {
  proxyPort: envNumber("AGENT_PROXY_PORT", 10062, 1),
  proxyHost: envString("AGENT_PROXY_HOST", "0.0.0.0"),
  upstreamWsUrl: envString("AGENT_PROXY_UPSTREAM_WS_URL", "ws://127.0.0.1:10061/chat/ws"),
  upstreamHttpBase: envString("AGENT_PROXY_UPSTREAM_HTTP_BASE", "http://127.0.0.1:10061"),
  channelRetentionMs: envNumber("AGENT_PROXY_CHANNEL_RETENTION_MS", 10 * 60 * 1000, 10_000),
  apiKeyRetentionMs: envNumber("AGENT_PROXY_API_KEY_RETENTION_MS", 24 * 60 * 60 * 1000, 60_000),
  maxChannelEvents: envNumber("AGENT_PROXY_MAX_CHANNEL_EVENTS", 2000, 100),
  cleanupIntervalMs: envNumber("AGENT_PROXY_CLEANUP_INTERVAL_MS", 15_000, 5_000),
  maxConnections: envNumber("AGENT_PROXY_MAX_CONNECTIONS", 1000, 10),
  maxBodySize: envNumber("AGENT_PROXY_MAX_BODY_SIZE", 10 * 1024 * 1024, 1024 * 1024),
  requestIdTtlMs: envNumber("AGENT_PROXY_REQUEST_ID_TTL_MS", 5 * 60 * 1000, 5_000),
  httpUpstreamTimeoutMs: envNumber("AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS", 30_000, 5_000),
  replayOnReconnect: envBoolean("AGENT_PROXY_REPLAY_ON_RECONNECT", false),
  wsPaths: ["/chat/ws", "/api/chat/ws", "/agent-proxy/ws", "/api/agent-proxy/ws"],
  connectPaths: ["/internal/connect", "/api/internal/connect"],
};
