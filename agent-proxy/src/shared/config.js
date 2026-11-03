/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOptionalJsonObjectConfigSync } from "@noobot/shared/config-file";
import { RUNTIME_PORT_TOPOLOGY } from "@noobot/runtime-topology-protocol/ports";
import { text } from "@noobot/shared/value";

export function loadFileConfig(
  configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../agent-proxy.config.json",
  ),
) {
  return readOptionalJsonObjectConfigSync({ filePath: configPath, defaultValue: {} });
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

function normalizeNumber(value, defaultValue, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const fallback = Number(defaultValue);
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : Number.isFinite(fallback) ? fallback : 0;
  return Math.min(max, Math.max(min, base));
}

function envNumber(name, fileKey, defaultValue, min = 0, max = Number.POSITIVE_INFINITY) {
  return normalizeNumber(getRawConfigValue(name, fileKey, defaultValue), defaultValue, {
    min,
    max,
  });
}

function envString(name, fileKey, defaultValue) {
  return String(getRawConfigValue(name, fileKey, defaultValue)).trim();
}

function envBoolean(name, fileKey, defaultValue = false) {
  const value = String(getRawConfigValue(name, fileKey, ""))
    .trim()
    .toLowerCase();
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
    .map((item) => text(item))
    .filter(Boolean);
}

function normalizePathPrefix(value) {
  const normalizedValue = text(value);
  if (!normalizedValue || normalizedValue === "/") return "";
  return normalizedValue.startsWith("/") ? normalizedValue : `/${normalizedValue}`;
}

export const config = {
  proxyPort: envNumber("AGENT_PROXY_PORT", "proxyPort", RUNTIME_PORT_TOPOLOGY.agentProxyPort, 1),
  proxyHost: envString("AGENT_PROXY_HOST", "proxyHost", "0.0.0.0"),
  upstreamWsUrl: envString(
    "AGENT_PROXY_UPSTREAM_WS_URL",
    "upstreamWsUrl",
    `ws://${RUNTIME_PORT_TOPOLOGY.loopbackHost}:${RUNTIME_PORT_TOPOLOGY.servicePort}/chat/ws`,
  ),
  upstreamHttpBase: envString(
    "AGENT_PROXY_UPSTREAM_HTTP_BASE",
    "upstreamHttpBase",
    `http://${RUNTIME_PORT_TOPOLOGY.loopbackHost}:${RUNTIME_PORT_TOPOLOGY.servicePort}`,
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
  trustedOrigins: envList("AGENT_PROXY_TRUSTED_ORIGINS", "trustedOrigins", ""),
  trustedIps: envList("AGENT_PROXY_TRUSTED_IPS", "trustedIps", ""),
  trustedProxies: envList("AGENT_PROXY_TRUSTED_PROXIES", "trustedProxies", ""),
  httpRateLimitEnabled: envBoolean(
    "AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED",
    "httpRateLimitEnabled",
    true,
  ),
  wsRateLimitEnabled: envBoolean("AGENT_PROXY_WS_RATE_LIMIT_ENABLED", "wsRateLimitEnabled", true),
  ideWsRateLimitEnabled: envBoolean(
    "AGENT_PROXY_IDE_WS_RATE_LIMIT_ENABLED",
    "ideWsRateLimitEnabled",
    true,
  ),
  ideHttpRateLimitEnabled: envBoolean(
    "AGENT_PROXY_IDE_HTTP_RATE_LIMIT_ENABLED",
    "ideHttpRateLimitEnabled",
    true,
  ),
  exposeUpstreamErrorDetail: envBoolean(
    "AGENT_PROXY_EXPOSE_UPSTREAM_ERROR_DETAIL",
    "exposeUpstreamErrorDetail",
    false,
  ),
  replayOnReconnect: envBoolean("AGENT_PROXY_REPLAY_ON_RECONNECT", "replayOnReconnect", false),
  upstreamHttpStripPrefix: normalizePathPrefix(
    envString("AGENT_PROXY_UPSTREAM_HTTP_STRIP_PREFIX", "upstreamHttpStripPrefix", "/api"),
  ),
  wsPaths: [
    "/chat/ws",
    "/api/chat/ws",
    "/agent-proxy/ws",
    "/api/agent-proxy/ws",
    "/logs/ws",
    "/api/logs/ws",
  ],
  connectPaths: ["/internal/connect", "/api/internal/connect"],
};
