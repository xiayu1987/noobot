/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PLATFORM, normalizePlatform } from "@noobot/platform-compatibility/platform";

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

export function normalizePathForPlatform(value = "", { trailingSlash = false } = {}) {
  const decoded = decodeFileUrl(value);
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
  return normalized;
}

export function isAbsolutePathForPlatform(value = "", platform = "") {
  const normalized = normalizePathForPlatform(value);
  const resolvedPlatform = detectPathPlatform(value, platform);
  return resolvedPlatform === PLATFORM.WINDOWS
    ? /^(?:[a-z]:\/|\/\/[^/]+\/[^/]+)/i.test(normalized)
    : normalized.startsWith("/");
}
