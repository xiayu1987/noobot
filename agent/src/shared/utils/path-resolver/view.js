/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizePathPlatform as normalizePlatform, normalizePathForPlatform, detectPathPlatform, PATH_VIEWS, normalizeSlashPath } from "./platform.js";
import { resolveSandboxPathMappings } from "./sandbox-mapping.js";

function normalizeView(view = "") {
  const value = String(view || "").trim().toLowerCase();
  return Object.values(PATH_VIEWS).includes(value) ? value : "";
}

function resolveHostPlatform(agentContext = null) {
  return normalizePlatform(
    agentContext?.environment?.os?.platform ||
    agentContext?.environment?.platform ||
    agentContext?.platform ||
    "",
  );
}

function explicitViewMappings(context = {}) {
  const mappings = Array.isArray(context?.mappings) ? context.mappings : [];
  return mappings.map((item = {}) => ({
    host: normalizeSlashPath(item.host || item.hostPath || item.source || ""),
    sandbox: normalizeSlashPath(item.sandbox || item.sandboxPath || item.target || ""),
    client: normalizeSlashPath(item.client || item.clientPath || ""),
  }));
}
export function convertPathView({
  path = "", sourceView = "", targetView = "", sourcePlatform = "",
  targetPlatform = "", runtime = {}, agentContext = null, mappings = [],
} = {}) {
  const from = normalizeView(sourceView);
  const to = normalizeView(targetView);
  if (!from || !to) throw new TypeError("sourceView and targetView must be host, sandbox, or client");
  const hostPlatform = resolveHostPlatform(agentContext);
  const fromPlatformHint = normalizePlatform(sourcePlatform) || (from === PATH_VIEWS.HOST ? hostPlatform : "");
  const normalized = normalizePathForPlatform(path, { platform: fromPlatformHint });
  const fromPlatform = fromPlatformHint || detectPathPlatform(normalized);
  const toPlatform = normalizePlatform(targetPlatform) || (to === PATH_VIEWS.HOST ? hostPlatform : "") || fromPlatform;
  let converted = normalized;
  let mapped = from === to;
  const allMappings = explicitViewMappings({ mappings: [
    ...resolveSandboxPathMappings(runtime).map(({ source, target }) => ({ host: source, sandbox: target })),
    ...mappings,
  ] });
  if (!mapped) {
    const candidates = allMappings
      .filter((item) => item[from] && item[to])
      .sort((a, b) => b[from].length - a[from].length);
    for (const item of candidates) {
      if (normalized === item[from] || normalized.startsWith(`${item[from]}/`)) {
        converted = `${item[to]}${normalized.slice(item[from].length)}`;
        mapped = true;
        break;
      }
    }
  }
  return {
    path: normalizePathForPlatform(converted, { platform: toPlatform }),
    sourcePath: normalized,
    sourcePlatform: fromPlatform,
    sourceView: from,
    targetPlatform: toPlatform,
    targetView: to,
    mapped,
  };
}

export const toHostPath = (options = {}) => convertPathView({ ...options, targetView: PATH_VIEWS.HOST });
export const toSandboxPath = (options = {}) => convertPathView({ ...options, targetView: PATH_VIEWS.SANDBOX });
export const toClientPath = (options = {}) => convertPathView({ ...options, targetView: PATH_VIEWS.CLIENT });
