/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSlashPath } from "./platform.js";
import {
  WORKSPACE_SANDBOX_PATHS,
  isSandboxIsolationMode,
  resolveExecutionIsolation,
  resolveSandboxMountMappings,
  resolveWorkspaceSandboxLayout,
} from "@noobot/execution-isolation-protocol";
import { text } from "@noobot/shared/value";

export function resolveRuntimeUserId({ runtime = {}, agentContext = null, userId = "" } = {}) {
  return text(userId || runtime?.systemRuntime?.userId || agentContext?.context?.identity?.userId);
}

function resolveConfiguredMountMappings(runtime = {}) {
  return resolveSandboxMountMappings(resolveExecutionIsolation(runtime?.globalConfig || {}));
}

export function resolveSandboxUserRoot(runtime = {}) {
  const isolation = resolveExecutionIsolation(runtime?.globalConfig || {});
  if (!isSandboxIsolationMode(isolation.mode)) return "";
  return resolveWorkspaceSandboxLayout({
    isolation,
    userId: resolveRuntimeUserId({ runtime }),
  }).userRoot;
}

export function resolveSandboxPathMappings(runtime = {}) {
  return resolveConfiguredMountMappings(runtime)
    .map((item) => ({
      source: normalizeSlashPath(item.source),
      target: item.target,
      readOnly: item.readOnly,
    }))
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

export function resolveHostPath({ sandboxPath = "", runtime = {} } = {}) {
  const isolation = resolveExecutionIsolation(runtime?.globalConfig || {});
  if (!isSandboxIsolationMode(isolation.mode)) return "";
  const normalizedSandboxPath = normalizeSlashPath(sandboxPath);
  if (!normalizedSandboxPath) return "";

  const mount = resolveSandboxMount({ sandboxPath: normalizedSandboxPath, runtime });
  if (mount) return mount.hostPath;

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = text(runtime?.basePath);
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
