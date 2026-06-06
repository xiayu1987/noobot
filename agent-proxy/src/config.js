/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadFileConfig() {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.resolve(currentDir, "../agent-proxy.config.json");
    if (!existsSync(configPath)) return {};
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const fileConfig = loadFileConfig();

function getRawConfigValue(envName, fileKey, defaultValue) {
  const envValue = process.env[envName];
  if (envValue !== undefined) return envValue;
  if (fileKey && Object.prototype.hasOwnProperty.call(fileConfig, fileKey)) {
    return fileConfig[fileKey];
  }
  return defaultValue;
}

function envNumber(name, fileKey, defaultValue, min = 0) {
  return Math.max(min, Number(getRawConfigValue(name, fileKey, defaultValue)));
}

function envString(name, fileKey, defaultValue) {
  return String(getRawConfigValue(name, fileKey, defaultValue)).trim();
}

function envBoolean(name, fileKey, defaultValue = false) {
  const value = String(getRawConfigValue(name, fileKey, "")).trim().toLowerCase();
  if (!value) return Boolean(defaultValue);
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return Boolean(defaultValue);
}

function envList(name, fileKey, defaultValue = "") {
  const raw = String(getRawConfigValue(name, fileKey, defaultValue)).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export const config = {
  proxyPort: envNumber("AGENT_PROXY_PORT", "proxyPort", 10062, 1),
  proxyHost: envString("AGENT_PROXY_HOST", "proxyHost", "0.0.0.0"),
  upstreamWsUrl: envString(
    "AGENT_PROXY_UPSTREAM_WS_URL",
    "upstreamWsUrl",
    "ws://127.0.0.1:10061/chat/ws",
  ),
  upstreamHttpBase: envString(
    "AGENT_PROXY_UPSTREAM_HTTP_BASE",
    "upstreamHttpBase",
    "http://127.0.0.1:10061",
  ),
  connectToken: envString("AGENT_PROXY_CONNECT_TOKEN", "connectToken", ""),
  connectTokenHeader: envString(
    "AGENT_PROXY_CONNECT_TOKEN_HEADER",
    "connectTokenHeader",
    "x-proxy-token",
  ).toLowerCase(),
  connectTokenAllowLoopback: envBoolean(
    "AGENT_PROXY_CONNECT_TOKEN_ALLOW_LOOPBACK",
    "connectTokenAllowLoopback",
    true,
  ),
  channelRetentionMs: envNumber(
    "AGENT_PROXY_CHANNEL_RETENTION_MS",
    "channelRetentionMs",
    10 * 60 * 1000,
    10_000,
  ),
  apiKeyRetentionMs: envNumber(
    "AGENT_PROXY_API_KEY_RETENTION_MS",
    "apiKeyRetentionMs",
    24 * 60 * 60 * 1000,
    60_000,
  ),
  maxChannelEvents: envNumber("AGENT_PROXY_MAX_CHANNEL_EVENTS", "maxChannelEvents", 2000, 100),
  cleanupIntervalMs: envNumber(
    "AGENT_PROXY_CLEANUP_INTERVAL_MS",
    "cleanupIntervalMs",
    15_000,
    5_000,
  ),
  maxConnections: envNumber("AGENT_PROXY_MAX_CONNECTIONS", "maxConnections", 1000, 10),
  maxBodySize: envNumber(
    "AGENT_PROXY_MAX_BODY_SIZE",
    "maxBodySize",
    10 * 1024 * 1024,
    1024 * 1024,
  ),
  requestIdTtlMs: envNumber(
    "AGENT_PROXY_REQUEST_ID_TTL_MS",
    "requestIdTtlMs",
    11 * 60 * 1000,
    5_000,
  ),
  httpUpstreamTimeoutMs: envNumber(
    "AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS",
    "httpUpstreamTimeoutMs",
    30_000,
    5_000,
  ),
  trustedOrigins: envList("AGENT_PROXY_TRUSTED_ORIGINS", "trustedOrigins", ""),
  trustedIps: envList("AGENT_PROXY_TRUSTED_IPS", "trustedIps", ""),
  httpRateLimitEnabled: envBoolean(
    "AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED",
    "httpRateLimitEnabled",
    true,
  ),
  wsRateLimitEnabled: envBoolean("AGENT_PROXY_WS_RATE_LIMIT_ENABLED", "wsRateLimitEnabled", true),
  httpRateLimitWindowMs: envNumber(
    "AGENT_PROXY_HTTP_RATE_LIMIT_WINDOW_MS",
    "httpRateLimitWindowMs",
    60_000,
    1_000,
  ),
  httpRateLimitMaxRequests: envNumber(
    "AGENT_PROXY_HTTP_RATE_LIMIT_MAX_REQUESTS",
    "httpRateLimitMaxRequests",
    180,
    10,
  ),
  wsRateLimitWindowMs: envNumber(
    "AGENT_PROXY_WS_RATE_LIMIT_WINDOW_MS",
    "wsRateLimitWindowMs",
    60_000,
    1_000,
  ),
  wsRateLimitMaxUpgrades: envNumber(
    "AGENT_PROXY_WS_RATE_LIMIT_MAX_UPGRADES",
    "wsRateLimitMaxUpgrades",
    80,
    5,
  ),
  ideWsRateLimitEnabled: envBoolean(
    "AGENT_PROXY_IDE_WS_RATE_LIMIT_ENABLED",
    "ideWsRateLimitEnabled",
    true,
  ),
  ideWsRateLimitWindowMs: envNumber(
    "AGENT_PROXY_IDE_WS_RATE_LIMIT_WINDOW_MS",
    "ideWsRateLimitWindowMs",
    60_000,
    1_000,
  ),
  ideWsRateLimitMaxUpgrades: envNumber(
    "AGENT_PROXY_IDE_WS_RATE_LIMIT_MAX_UPGRADES",
    "ideWsRateLimitMaxUpgrades",
    60,
    5,
  ),
  ideHttpRateLimitEnabled: envBoolean(
    "AGENT_PROXY_IDE_HTTP_RATE_LIMIT_ENABLED",
    "ideHttpRateLimitEnabled",
    true,
  ),
  ideHttpRateLimitWindowMs: envNumber(
    "AGENT_PROXY_IDE_HTTP_RATE_LIMIT_WINDOW_MS",
    "ideHttpRateLimitWindowMs",
    60_000,
    1_000,
  ),
  ideHttpRateLimitMaxRequests: envNumber(
    "AGENT_PROXY_IDE_HTTP_RATE_LIMIT_MAX_REQUESTS",
    "ideHttpRateLimitMaxRequests",
    2000,
    50,
  ),
  exposeUpstreamErrorDetail: envBoolean(
    "AGENT_PROXY_EXPOSE_UPSTREAM_ERROR_DETAIL",
    "exposeUpstreamErrorDetail",
    false,
  ),
  replayOnReconnect: envBoolean("AGENT_PROXY_REPLAY_ON_RECONNECT", "replayOnReconnect", false),
  maxReplayEvents: envNumber("AGENT_PROXY_MAX_REPLAY_EVENTS", "maxReplayEvents", 5000, 100),
  wsPaths: ["/chat/ws", "/api/chat/ws", "/agent-proxy/ws", "/api/agent-proxy/ws"],
  connectPaths: ["/internal/connect", "/api/internal/connect"],
};
