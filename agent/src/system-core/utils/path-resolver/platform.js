/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import nodePath from "node:path";

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
export const PATH_PLATFORMS = Object.freeze({
  WINDOWS: "windows",
  MACOS: "macos",
  LINUX: "linux",
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
function normalizePlatform(platform = "") {
  const value = String(platform || "").trim().toLowerCase();
  if (["win", "win32", "windows"].includes(value)) return PATH_PLATFORMS.WINDOWS;
  if (["mac", "macos", "darwin", "osx"].includes(value)) return PATH_PLATFORMS.MACOS;
  if (["linux", "posix"].includes(value)) return PATH_PLATFORMS.LINUX;
  return "";
}

export function normalizePathPlatform(platform = "") {
  return normalizePlatform(platform);
}

export function resolvePathPlatformFromContext(agentContext = {}, fallback = process.platform) {
  return normalizePlatform(
    agentContext?.environment?.os?.platform ||
    agentContext?.environment?.platform ||
    agentContext?.platform ||
    fallback ||
    "",
  );
}

export function isCaseInsensitivePathPlatform(platform = "") {
  const normalized = normalizePlatform(platform);
  return normalized === PATH_PLATFORMS.WINDOWS || normalized === PATH_PLATFORMS.MACOS;
}

export function isCaseInsensitivePathContext(agentContext = {}, fallback = process.platform) {
  return isCaseInsensitivePathPlatform(resolvePathPlatformFromContext(agentContext, fallback));
}
export function detectPathPlatform(value = "", platformHint = "") {
  const hinted = normalizePlatform(platformHint);
  if (hinted) return hinted;
  const source = String(value || "").trim();
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/[^/\\]+[/\\][^/\\]+)/i.test(source)) {
    return PATH_PLATFORMS.WINDOWS;
  }
  // A leading slash identifies POSIX syntax, not a specific source OS.
  // Callers that need macOS/Linux provenance must provide platformHint.
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

export function normalizePathForPlatform(value = "", { platform = "", trailingSlash = false } = {}) {
  const decoded = decodeFileUrl(value);
  const resolvedPlatform = detectPathPlatform(decoded, platform);
  let normalized = decoded.replaceAll("\\", "/");
  const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
  const body = normalized.slice(prefix.length);
  const parts = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== ".." && !/^[a-z]:$/i.test(parts.at(-1))) parts.pop();
    else if (part !== ".." || !prefix) parts.push(part);
  }
  normalized = `${prefix}${parts.join("/")}` || prefix;
  if (trailingSlash && normalized && !normalized.endsWith("/")) normalized += "/";
  if (resolvedPlatform === PATH_PLATFORMS.WINDOWS) return normalized;
  return normalized;
}

export function isAbsolutePathForPlatform(value = "", platform = "") {
  const normalized = normalizePathForPlatform(value, { platform });
  const resolvedPlatform = detectPathPlatform(value, platform);
  return resolvedPlatform === PATH_PLATFORMS.WINDOWS
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
  return String(value || "").trim().replaceAll("\\", "/");
}
