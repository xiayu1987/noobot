/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveTimeMs } from "../../config/core/time-config-normalizer.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export function normalizeConnectionSource(connectionInfo = {}) {
  return connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
}

export function normalizeConnectionString(source = {}) {
  return String(source?.connection_string || source?.connectionString || "").trim();
}

export function parseConnectionString(connectionString = "") {
  const normalizedConnectionString = String(connectionString || "").trim();
  if (!normalizedConnectionString) return null;
  try {
    return new URL(normalizedConnectionString);
  } catch {
    return null;
  }
}

export function resolveHostPortUserPasswordDatabase({
  source = {},
  defaultPort = 0,
  fallbackHost = "127.0.0.1",
} = {}) {
  const connectionString = normalizeConnectionString(source);
  const parsedUrl = parseConnectionString(connectionString);

  let host = String(source?.host || source?.ip || "").trim();
  let port = Number(source?.port || defaultPort);
  let user = String(source?.username || source?.user || "").trim();
  let password = String(source?.password || "").trim();
  let database = String(source?.database || source?.db || "").trim();

  if (parsedUrl) {
    host = host || String(parsedUrl.hostname || "").trim();
    port = Number.isFinite(port) && port > 0 ? port : Number(parsedUrl.port || defaultPort);
    user = user || decodeURIComponent(String(parsedUrl.username || ""));
    password = password || decodeURIComponent(String(parsedUrl.password || ""));
    database = database || String(parsedUrl.pathname || "").replace(/^\/+/, "").trim();
  }

  return {
    connectionString,
    host: host || fallbackHost,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : defaultPort,
    user,
    password,
    database,
  };
}

export function normalizeTimeoutMs(
  source = {},
  fallback = TIME_THRESHOLDS.connectors.defaultCommandTimeoutMs,
) {
  return resolveTimeMs(source, {
    key: "timeoutMs",
    legacyKeys: ["timeout_ms"],
    sourceTag: "connectors.database",
    warnLegacy: true,
    fallback,
    min: 1000,
  });
}

export async function importDefaultOrModule(moduleName = "") {
  try {
    const mod = await import(String(moduleName || ""));
    return mod?.default || mod;
  } catch {
    return null;
  }
}
