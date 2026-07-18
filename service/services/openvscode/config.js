/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { BUILTIN_THRESHOLDS, normalizeTimeMs, resolveTimeMs } from "#agent/config";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isPlainObject } from "./utils.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMMAND = "openvscode-server";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_START_TIMEOUT_MS = BUILTIN_THRESHOLDS.openvscode.startTimeoutMs;
export const DEFAULT_IDLE_TIMEOUT_MS = BUILTIN_THRESHOLDS.openvscode.idleTimeoutMs;
export const DEFAULT_CLEANUP_INTERVAL_MS = TIME_THRESHOLDS.openvscode.cleanupIntervalMs;
export const DEFAULT_SHUTDOWN_GRACE_MS = TIME_THRESHOLDS.openvscode.shutdownGraceMs;
export const DEFAULT_TOUCH_PERSIST_INTERVAL_MS = TIME_THRESHOLDS.openvscode.touchPersistIntervalMs;
export const IDE_PATH_PREFIX = "/ide";
export const IDE_TOKEN_QUERY_KEY = "tkn";

function resolveManagedOpenVSCodeCommand() {
  const candidate = path.resolve(CURRENT_DIR, "../../vendor/openvscode-server/bin/openvscode-server");
  return existsSync(candidate) ? candidate : "";
}
function resolveOpenVSCodeTimeMs({ envName, source, key, legacyKey, fallback, min }) {
  const envRaw = process.env[envName];
  if (envRaw !== undefined) return normalizeTimeMs(envRaw, { fallback, min, allowZero: min <= 0 });
  return resolveTimeMs(source, { key, legacyKeys: legacyKey ? [legacyKey] : [], sourceTag: "service.openvscode", warnLegacy: true, fallback, min, allowZero: min <= 0 });
}
export function getOpenVSCodeConfig(globalConfig = {}) {
  const source = isPlainObject(globalConfig?.openVSCode) ? globalConfig.openVSCode : isPlainObject(globalConfig?.openvscode) ? globalConfig.openvscode : {};
  const envArgs = String(process.env.OPENVSCODE_SERVER_EXTRA_ARGS || "").trim();
  const configuredCommand = String(process.env.OPENVSCODE_SERVER_COMMAND || source.command || "").trim();
  return {
    command: configuredCommand || resolveManagedOpenVSCodeCommand() || DEFAULT_COMMAND,
    host: String(process.env.OPENVSCODE_SERVER_HOST || source.host || DEFAULT_HOST).trim() || DEFAULT_HOST,
    startTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    cleanupIntervalMs: resolveOpenVSCodeTimeMs({ envName: "OPENVSCODE_SERVER_CLEANUP_INTERVAL_MS", source, key: "cleanupIntervalMs", legacyKey: "cleanup_interval_ms", fallback: DEFAULT_CLEANUP_INTERVAL_MS, min: 1000 }),
    shutdownGraceMs: resolveOpenVSCodeTimeMs({ envName: "OPENVSCODE_SERVER_SHUTDOWN_GRACE_MS", source, key: "shutdownGraceMs", legacyKey: "shutdown_grace_ms", fallback: DEFAULT_SHUTDOWN_GRACE_MS, min: 0 }),
    extraArgs: Array.isArray(source.extraArgs) ? source.extraArgs.map((item) => String(item || "").trim()).filter(Boolean) : envArgs ? envArgs.split(" ").map((item) => item.trim()).filter(Boolean) : [],
  };
}
