/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSlashPath } from "./platform.js";
import {
  isSandboxIsolationMode,
  resolveExecutionIsolation,
  resolveSandboxMountMappings,
  resolveWorkspaceSandboxMountProjection,
} from "@noobot/execution-isolation-protocol";
import { text } from "@noobot/shared/value";

export const SANDBOX_MOUNT_KIND = Object.freeze({
  WORKSPACE: "workspace",
  CONFIGURED: "configured",
});

function normalizeMountMappings(mappings = []) {
  return mappings.map((item) => ({
    source: normalizeSlashPath(item.source),
    target: item.target,
    readOnly: item.readOnly,
  }));
}

export function resolveSandboxPathMappings({ globalConfig }) {
  return normalizeMountMappings(
    resolveSandboxMountMappings(resolveExecutionIsolation(globalConfig)),
  ).sort((leftItem, rightItem) => rightItem.source.length - leftItem.source.length);
}

function requireRuntimeText(value, fieldName) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`resolveSandboxMount requires runtime ${fieldName}`);
  return normalized;
}

function resolveSandboxMountTable(runtime) {
  const isolation = resolveExecutionIsolation(runtime.globalConfig);
  if (!isSandboxIsolationMode(isolation.mode)) return [];
  const workspaceMount = resolveWorkspaceSandboxMountProjection({
    isolation,
    userId: requireRuntimeText(runtime.systemRuntime?.userId, "systemRuntime.userId"),
    hostUserRoot: requireRuntimeText(runtime.basePath, "basePath"),
  });
  const withKind = (kind) => (item) => ({ ...item, kind });
  return [
    ...normalizeMountMappings([
      { source: workspaceMount.source, target: workspaceMount.target, readOnly: false },
    ]).map(withKind(SANDBOX_MOUNT_KIND.WORKSPACE)),
    ...normalizeMountMappings(resolveSandboxMountMappings(isolation)).map(
      withKind(SANDBOX_MOUNT_KIND.CONFIGURED),
    ),
  ];
}

export function resolveSandboxMount({ sandboxPath, runtime }) {
  const normalizedPath = normalizeSlashPath(sandboxPath);
  if (!normalizedPath) return null;
  const mapping = resolveSandboxMountTable(runtime)
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
