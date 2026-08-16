/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSlashPath } from "./platform.js";
import {
  EXECUTION_ISOLATION_MODE,
  WORKSPACE_SANDBOX_PATHS,
  resolveExecutionIsolation,
  resolveSandboxMountMappings,
  resolveWorkspaceSandboxLayout,
} from "@noobot/execution-isolation-protocol";

export function resolveRuntimeUserId({ runtime = {}, agentContext = null, userId = "" } = {}) {
  return String(
    userId ||
      runtime?.systemRuntime?.userId ||
      runtime?.userId ||
      agentContext?.context?.identity?.userId ||
      "",
  ).trim();
}

function resolveConfiguredMountMappings(runtime = {}) {
  return resolveSandboxMountMappings(resolveExecutionIsolation(runtime?.globalConfig || {}));
}

export function resolveSandboxUserRoot(runtime = {}) {
  const isolation = resolveExecutionIsolation(runtime?.globalConfig || {});
  if (isolation.mode !== EXECUTION_ISOLATION_MODE.SANDBOX) return "";
  return resolveWorkspaceSandboxLayout({
    isolation,
    userId: resolveRuntimeUserId({ runtime }),
  }).userRoot;
}

function mapPathByMappings(filePath = "", mappings = []) {
  const normalizedFilePath = normalizeSlashPath(filePath);
  if (!normalizedFilePath || !Array.isArray(mappings) || !mappings.length) return "";
  for (const mapping of mappings) {
    const source = normalizeSlashPath(mapping?.source || "");
    const target = normalizeSlashPath(mapping?.target || "");
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
      source: normalizeSlashPath(mapping?.source || ""),
      target: normalizeSlashPath(mapping?.target || ""),
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
  return resolveConfiguredMountMappings(runtime)
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => ({
      source: normalizeSlashPath(item?.source || ""),
      target: normalizeSlashPath(item?.target || ""),
      readOnly: item?.readOnly === true,
    }))
    .filter((item) => Boolean(item.source && item.target))
    .sort((leftItem, rightItem) => rightItem.source.length - leftItem.source.length);
}

export function resolveSandboxMount({ sandboxPath = "", runtime = {} } = {}) {
  const normalizedPath = normalizeSlashPath(sandboxPath);
  if (!normalizedPath) return null;
  const mapping = resolveSandboxPathMappings(runtime)
    .sort((leftItem, rightItem) => rightItem.target.length - leftItem.target.length)
    .find((item) => normalizedPath === item.target || normalizedPath.startsWith(`${item.target}/`));
  if (!mapping) return null;
  return Object.freeze({
    ...mapping,
    sandboxPath: normalizedPath,
    hostPath:
      normalizedPath === mapping.target
        ? mapping.source
        : `${mapping.source}${normalizedPath.slice(mapping.target.length)}`,
  });
}

export function resolveSandboxPath({
  path = "",
  hostPath = "",
  relativePath = "",
  runtime = {},
} = {}) {
  const isolation = resolveExecutionIsolation(runtime?.globalConfig || {});
  if (isolation.mode !== EXECUTION_ISOLATION_MODE.SANDBOX) return "";
  const sandboxRoot = WORKSPACE_SANDBOX_PATHS.ROOT;

  const normalizedHostPath = normalizeSlashPath(hostPath || path);
  if (!normalizedHostPath && !String(relativePath || "").trim()) return "";

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(runtime?.basePath || "").trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  if (sandboxUserRoot && normalizedHostBasePath && normalizedHostPath) {
    if (normalizedHostPath === normalizedHostBasePath) return sandboxUserRoot;
    if (normalizedHostPath.startsWith(`${normalizedHostBasePath}/`)) {
      return `${sandboxUserRoot}${normalizedHostPath.slice(normalizedHostBasePath.length)}`;
    }
  }

  const mappedByConfig = mapPathByMappings(normalizedHostPath, resolveSandboxPathMappings(runtime));
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

export function resolveHostPath({ path = "", sandboxPath = "", runtime = {} } = {}) {
  const isolation = resolveExecutionIsolation(runtime?.globalConfig || {});
  if (isolation.mode !== EXECUTION_ISOLATION_MODE.SANDBOX) return "";
  const normalizedSandboxPath = normalizeSlashPath(sandboxPath || path);
  if (!normalizedSandboxPath) return "";

  const mappedByConfig = mapPathByReverseMappings(
    normalizedSandboxPath,
    resolveSandboxPathMappings(runtime),
  );
  if (mappedByConfig) return String(mappedByConfig || "").trim();

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(runtime?.basePath || "").trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  const normalizedSandboxUserRoot = normalizeSlashPath(sandboxUserRoot);
  if (normalizedSandboxUserRoot && normalizedHostBasePath) {
    if (normalizedSandboxPath === normalizedSandboxUserRoot) return normalizedHostBasePath;
    if (normalizedSandboxPath.startsWith(`${normalizedSandboxUserRoot}/`)) {
      return `${normalizedHostBasePath}${normalizedSandboxPath.slice(normalizedSandboxUserRoot.length)}`;
    }
  }

  const sandboxRoot = WORKSPACE_SANDBOX_PATHS.ROOT;
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
