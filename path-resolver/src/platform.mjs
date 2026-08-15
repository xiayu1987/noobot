/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import nodePath from "node:path";
import {
  PLATFORM,
  isCaseInsensitivePlatform,
  normalizePlatform,
} from "@noobot/platform-compatibility/platform";

export { PLATFORM as PATH_PLATFORMS } from "@noobot/platform-compatibility/platform";

export const filePath = Object.freeze({
  basename: (...args) => nodePath.basename(...args),
  dirname: (...args) => nodePath.dirname(...args),
  extname: (...args) => nodePath.extname(...args),
  format: (...args) => nodePath.format(...args),
  isAbsolute: (...args) => nodePath.isAbsolute(...args),
  join: (...args) => nodePath.join(...args),
  normalize: (...args) => nodePath.normalize(...args),
  parse: (...args) => nodePath.parse(...args),
  relative: (...args) => nodePath.relative(...args),
  resolve: (...args) => nodePath.resolve(...args),
  delimiter: nodePath.delimiter,
  sep: nodePath.sep,
});
export const PATH_VIEWS = Object.freeze({
  HOST: "host",
  SANDBOX: "sandbox",
  CLIENT: "client",
});

export const TOOL_PATH_VIEWS = Object.freeze({
  WORKSPACE_RELATIVE: "workspace-relative",
  SANDBOX_ABSOLUTE: "sandbox-absolute",
  HOST_ABSOLUTE: "host-absolute",
  VIRTUAL_RELATIVE: "virtual-relative",
  EMPTY: "",
});
export function resolvePathPlatformFromContext(agentContext = {}) {
  return normalizePlatform(agentContext?.context?.environment?.os?.platform || "");
}

export function isCaseInsensitivePathPlatform(platform = "") {
  return isCaseInsensitivePlatform(platform);
}

export function isCaseInsensitivePathContext(agentContext = {}) {
  return isCaseInsensitivePathPlatform(resolvePathPlatformFromContext(agentContext));
}
export function detectPathPlatform(value = "", platformHint = "") {
  const hinted = normalizePlatform(platformHint);
  if (hinted) return hinted;
  const source = String(value || "").trim();
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/[^/\\]+[/\\][^/\\]+)/i.test(source)) {
    return PLATFORM.WINDOWS;
  }
  return "";
}

function decodeFileUrl(value = "") {
  const source = String(value || "").trim();
  if (!/^file:/i.test(source)) return source;
  try {
    const url = new URL(source);
    const pathname = decodeURIComponent(url.pathname);
    if (url.host) return `//${url.host}${pathname}`;
    return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return source;
  }
}

export function normalizePathForPlatform(
  value = "",
  { platform = "", trailingSlash = false } = {},
) {
  const decoded = decodeFileUrl(value);
  const resolvedPlatform = detectPathPlatform(decoded, platform);
  let normalized = decoded.replaceAll("\\", "/");
  const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
  const body = normalized.slice(prefix.length);
  const parts = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== ".." && !/^[a-z]:$/i.test(parts.at(-1)))
      parts.pop();
    else if (part !== ".." || !prefix) parts.push(part);
  }
  normalized = `${prefix}${parts.join("/")}` || prefix;
  if (trailingSlash && normalized && !normalized.endsWith("/")) normalized += "/";
  if (resolvedPlatform === PLATFORM.WINDOWS) return normalized;
  return normalized;
}

export function isAbsolutePathForPlatform(value = "", platform = "") {
  const normalized = normalizePathForPlatform(value, { platform });
  const resolvedPlatform = detectPathPlatform(value, platform);
  return resolvedPlatform === PLATFORM.WINDOWS
    ? /^(?:[a-z]:\/|\/\/[^/]+\/[^/]+)/i.test(normalized)
    : normalized.startsWith("/");
}

export function isAbsolutePathAnyPlatform(value = "", platform = "") {
  return nodePath.isAbsolute(String(value || "")) || isAbsolutePathForPlatform(value, platform);
}

export function resolvePathUnderRoot(rootPath = "", targetPath = "", { platform = "" } = {}) {
  const normalizedTarget = normalizePathForPlatform(targetPath, { platform });
  if (!rootPath || isAbsolutePathAnyPlatform(normalizedTarget, platform)) return normalizedTarget;
  return joinPathForPlatform(rootPath, normalizedTarget);
}

export function joinPathForPlatform(basePath = "", ...segments) {
  const platform = detectPathPlatform(basePath);
  return normalizePathForPlatform([basePath, ...segments].filter(Boolean).join("/"), { platform });
}

export function normalizeSlashPath(value = "") {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/");
}
