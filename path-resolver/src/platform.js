/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import nodePath from "node:path";
import {
  detectPathPlatform,
  isAbsolutePathForPlatform,
  normalizePathForPlatform,
} from "./path-syntax.js";

export {
  detectPathPlatform,
  isAbsolutePathForPlatform,
  normalizePathForPlatform,
} from "./path-syntax.js";
import {
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
