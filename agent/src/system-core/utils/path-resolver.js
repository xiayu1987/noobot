/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSandboxProvider } from "../config/index.js";
import nodePath from "node:path";

// Local filesystem operations also pass through this module. Cross-platform
// payload paths must use the explicit *ForPlatform/view conversion APIs below.
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

export default filePath;

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

function normalizePlatform(platform = "") {
  const value = String(platform || "").trim().toLowerCase();
  if (["win", "win32", "windows"].includes(value)) return PATH_PLATFORMS.WINDOWS;
  if (["mac", "macos", "darwin", "osx"].includes(value)) return PATH_PLATFORMS.MACOS;
  if (["linux", "posix"].includes(value)) return PATH_PLATFORMS.LINUX;
  return "";
}

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

export function joinPathForPlatform(basePath = "", ...segments) {
  const platform = detectPathPlatform(basePath);
  return normalizePathForPlatform([basePath, ...segments].filter(Boolean).join("/"), { platform });
}

export function normalizeSlashPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/");
}

function sanitizeSandboxUserPart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function resolveExecuteScriptConfig(runtime = {}) {
  const globalCfg =
    runtime?.globalConfig?.tools?.execute_script &&
    typeof runtime.globalConfig.tools.execute_script === "object"
      ? runtime.globalConfig.tools.execute_script
      : {};
  const userCfg =
    runtime?.userConfig?.tools?.execute_script &&
    typeof runtime.userConfig.tools.execute_script === "object"
      ? runtime.userConfig.tools.execute_script
      : {};
  return {
    ...globalCfg,
    ...userCfg,
  };
}

function normalizeContainerTarget(target = "") {
  const normalized = normalizeSlashPath(target);
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveExecuteScriptMountMappings(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxProviderCfg =
    ((scriptConfig?.sandboxProvider &&
      typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : null) ||
      (scriptConfig?.sandbox_provider &&
      typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null) ||
      {});
  const provider = normalizeSandboxProvider(
    sandboxProviderCfg?.default || "docker",
  );
  const providerDetail =
    sandboxProviderCfg?.[provider] && typeof sandboxProviderCfg[provider] === "object"
      ? sandboxProviderCfg[provider]
      : {};
  const dockerMounts = Array.isArray(providerDetail?.dockerMounts)
    ? providerDetail.dockerMounts
    : Array.isArray(providerDetail?.docker_mounts)
      ? providerDetail.docker_mounts
      : [];
  const normalizedMounts = dockerMounts
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => ({
      source: normalizeSlashPath(
        item?.source || item?.mountSource || item?.mount_source || "",
      ),
      target: normalizeContainerTarget(
        item?.target || item?.mountTarget || item?.mount_target || "",
      ),
    }))
    .filter((item) => Boolean(item.source && item.target));
  if (normalizedMounts.length) return normalizedMounts;

  const legacySource = normalizeSlashPath(
    providerDetail?.dockerProjectMountSource ||
      providerDetail?.docker_project_mount_source ||
      "",
  );
  const legacyTarget = normalizeContainerTarget(
    providerDetail?.dockerProjectMountTarget ||
      providerDetail?.docker_project_mount_target ||
      "",
  );
  if (legacySource && legacyTarget) {
    return [{ source: legacySource, target: legacyTarget }];
  }
  return [];
}

function resolveSandboxUserRoot(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxMode =
    scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  if (!sandboxMode) return "";
  const sandboxProviderCfg =
    ((scriptConfig?.sandboxProvider &&
      typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : null) ||
      (scriptConfig?.sandbox_provider &&
      typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null) ||
      {});
  const provider = normalizeSandboxProvider(
    sandboxProviderCfg?.default || "docker",
  );
  if (provider === "firejail") return "$HOME";
  if (provider === "bubblewrap") return "/workspace";
  const providerDetail =
    sandboxProviderCfg?.[provider] && typeof sandboxProviderCfg[provider] === "object"
      ? sandboxProviderCfg[provider]
      : {};
  const scope = String(
    providerDetail?.dockerContainerScope ||
      providerDetail?.docker_container_scope ||
      "global",
  )
    .trim()
    .toLowerCase();
  if (scope === "user") return "/workspace";
  const userPart = sanitizeSandboxUserPart(runtime?.userId || "user") || "user";
  return `/workspace/${userPart}`;
}

function mapPathByMappings(filePath = "", mappings = []) {
  const normalizedFilePath = normalizeSlashPath(filePath);
  if (!normalizedFilePath || !Array.isArray(mappings) || !mappings.length) return "";
  for (const mapping of mappings) {
    const source = normalizeSlashPath(mapping?.source || mapping?.hostPath || mapping?.host || "");
    const target = normalizeSlashPath(mapping?.target || mapping?.sandboxPath || mapping?.sandbox || "");
    if (!source || !target) continue;
    if (normalizedFilePath === source) return target;
    if (normalizedFilePath.startsWith(`${source}/`)) {
      return `${target}${normalizedFilePath.slice(source.length)}`;
    }
  }
  return "";
}

function mapPathByReverseMappings(filePath = "", mappings = []) {
  const normalizedFilePath = normalizeSlashPath(filePath);
  if (!normalizedFilePath || !Array.isArray(mappings) || !mappings.length) return "";
  const normalizedMappings = mappings
    .map((mapping) => ({
      source: normalizeSlashPath(mapping?.source || mapping?.hostPath || mapping?.host || ""),
      target: normalizeSlashPath(mapping?.target || mapping?.sandboxPath || mapping?.sandbox || ""),
    }))
    .filter((mapping) => Boolean(mapping.source && mapping.target))
    .sort((leftItem, rightItem) => rightItem.target.length - leftItem.target.length);
  for (const mapping of normalizedMappings) {
    if (normalizedFilePath === mapping.target) return mapping.source;
    if (normalizedFilePath.startsWith(`${mapping.target}/`)) {
      return `${mapping.source}${normalizedFilePath.slice(mapping.target.length)}`;
    }
  }
  return "";
}

export function resolveSandboxPathMappings(runtime = {}) {
  const systemRuntimeMappings = runtime?.systemRuntime?.config?.sandboxPathMappings;
  const userMappings = runtime?.userConfig?.tools?.sandboxPathMappings;
  const globalMappings = runtime?.globalConfig?.tools?.sandboxPathMappings;
  const mappings = Array.isArray(systemRuntimeMappings)
    ? systemRuntimeMappings
    : (Array.isArray(userMappings) ? userMappings : globalMappings);
  const configuredMappings = Array.isArray(mappings) ? mappings : [];
  return [
    ...configuredMappings,
    ...resolveExecuteScriptMountMappings(runtime),
  ]
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => ({
      source: normalizeSlashPath(item?.source || item?.hostPath || item?.host || ""),
      target: normalizeSlashPath(item?.target || item?.sandboxPath || item?.sandbox || ""),
    }))
    .filter((item) => Boolean(item.source && item.target))
    .sort((leftItem, rightItem) => rightItem.source.length - leftItem.source.length);
}

export function resolveSandboxPath({
  path = "",
  hostPath = "",
  relativePath = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxMode =
    scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  const sandboxRoot = String(
    runtime?.systemRuntime?.staticInfo?.sandboxRoot ||
      runtime?.systemRuntime?.staticInfo?.sandbox?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandbox?.sandboxRoot ||
      "",
  ).trim();
  if (!sandboxMode && !sandboxRoot) return "";

  const normalizedHostPath = normalizeSlashPath(hostPath || path);
  if (!normalizedHostPath && !String(relativePath || "").trim()) return "";

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(
    runtime?.basePath || agentContext?.environment?.workspace?.basePath || "",
  ).trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  if (sandboxUserRoot && normalizedHostBasePath && normalizedHostPath) {
    if (normalizedHostPath === normalizedHostBasePath) return sandboxUserRoot;
    if (normalizedHostPath.startsWith(`${normalizedHostBasePath}/`)) {
      return `${sandboxUserRoot}${normalizedHostPath.slice(normalizedHostBasePath.length)}`;
    }
  }

  const mappedByConfig = mapPathByMappings(
    normalizedHostPath,
    resolveSandboxPathMappings(runtime),
  );
  if (mappedByConfig) return String(mappedByConfig || "").trim();

  const normalizedSandboxRoot = normalizeSlashPath(sandboxRoot);
  if (normalizedSandboxRoot) {
    if (sandboxUserRoot && normalizedHostPath && normalizedHostBasePath) {
      if (normalizedHostPath === normalizedHostBasePath) return sandboxUserRoot;
      if (normalizedHostPath.startsWith(`${normalizedHostBasePath}/`)) {
        return `${sandboxUserRoot}${normalizedHostPath.slice(normalizedHostBasePath.length)}`;
      }
    }
    const normalizedRelativePath = normalizeSlashPath(relativePath).replace(/^\/+/, "");
    if (normalizedRelativePath) return `${normalizedSandboxRoot}/${normalizedRelativePath}`;
  }

  return "";
}

export function resolveHostPath({
  path = "",
  sandboxPath = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const normalizedSandboxPath = normalizeSlashPath(sandboxPath || path);
  if (!normalizedSandboxPath) return "";

  const mappedByConfig = mapPathByReverseMappings(
    normalizedSandboxPath,
    resolveSandboxPathMappings(runtime),
  );
  if (mappedByConfig) return String(mappedByConfig || "").trim();

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(
    runtime?.basePath || agentContext?.environment?.workspace?.basePath || "",
  ).trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  const normalizedSandboxUserRoot = normalizeSlashPath(sandboxUserRoot);
  if (normalizedSandboxUserRoot && normalizedHostBasePath) {
    if (normalizedSandboxPath === normalizedSandboxUserRoot) return normalizedHostBasePath;
    if (normalizedSandboxPath.startsWith(`${normalizedSandboxUserRoot}/`)) {
      return `${normalizedHostBasePath}${normalizedSandboxPath.slice(normalizedSandboxUserRoot.length)}`;
    }
  }

  const sandboxRoot = String(
    runtime?.systemRuntime?.staticInfo?.sandboxRoot ||
      runtime?.systemRuntime?.staticInfo?.sandbox?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandbox?.sandboxRoot ||
      "",
  ).trim();
  const normalizedSandboxRoot = normalizeSlashPath(sandboxRoot);
  if (normalizedSandboxRoot && normalizedHostBasePath) {
    if (normalizedSandboxPath === normalizedSandboxRoot) return normalizedHostBasePath;
    if (normalizedSandboxPath.startsWith(`${normalizedSandboxRoot}/`)) {
      return `${normalizedHostBasePath}${normalizedSandboxPath.slice(normalizedSandboxRoot.length)}`;
    }
  }

  return "";
}

export function resolveAttachmentDisplayPath({
  meta = {},
  path = "",
  hostPath = "",
  relativePath = "",
  runtime = {},
  agentContext = null,
  purpose = "attachment_display_path",
} = {}) {
  const sourceMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  const resolvedHostPath = String(hostPath || path || sourceMeta?.path || "").trim();
  const resolvedRelativePath = String(relativePath || sourceMeta?.relativePath || "").trim();
  const sandboxPath = resolveSandboxPath({
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    runtime,
    agentContext,
    purpose,
  });
  if (sandboxPath) return String(sandboxPath || "").trim();
  return String(resolvedRelativePath || resolvedHostPath || sourceMeta?.name || "").trim();
}
