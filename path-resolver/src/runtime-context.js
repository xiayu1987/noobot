/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, normalizeSlashPath } from "./platform.js";
import { resolveSandboxPathMappings } from "./sandbox-mapping.js";
import { HOST_FILESYSTEM_ROOT, resolveSuperAdminHostRoots } from "./path-contract.js";
import {
  WORKSPACE_SANDBOX_PATHS,
  assertToolExecutionPolicy,
  isSandboxExecutionView,
  resolveWorkspaceSandboxLayout,
} from "@noobot/execution-isolation-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

function uniqueNormalizedPaths(paths = []) {
  return Array.from(new Set(paths.map((item) => normalizeSlashPath(item)).filter(Boolean)));
}

function requireTextInput(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`resolveRuntimePathContext requires ${label}`);
  }
  return value.trim();
}

export function isHostFilesystemSentinel(value = "") {
  return text(value) === HOST_FILESYSTEM_ROOT;
}

export function resolveRuntimeOpsWorkdir({ hostRootDirectory, userId, executionPolicy }) {
  const hostRoot = requireTextInput(hostRootDirectory, "hostRootDirectory");
  const resolvedUserId = requireTextInput(userId, "userId");
  const policy = assertToolExecutionPolicy(executionPolicy);
  if (!isSandboxExecutionView(policy.view)) {
    return {
      view: "host",
      opsWorkdir: filePath.join(hostRoot, WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE),
    };
  }
  return {
    view: "sandbox",
    opsWorkdir: resolveWorkspaceSandboxLayout({
      isolation: policy.isolation,
      userId: resolvedUserId,
    }).opsWorkdir,
  };
}

function resolveHostDirectories({ hostRootDirectory, opsWorkdir, superUserHostRoots }) {
  const hostAbsolutePaths = superUserHostRoots.length > 0;
  return {
    view: "host",
    currentDirectory: hostRootDirectory,
    rootDirectory: hostRootDirectory,
    opsWorkdir,
    relativePathBase: "rootDirectory",
    allowedRoots: hostAbsolutePaths
      ? [...superUserHostRoots]
      : uniqueNormalizedPaths([hostRootDirectory]),
    extraMountTargets: [],
    ...(hostAbsolutePaths ? { hostAbsolutePaths } : {}),
  };
}

function resolveSandboxContext({ globalConfig, isolation, userId, opsWorkdir }) {
  const pathMappings = resolveSandboxPathMappings({ globalConfig });
  const mountTargets = uniqueNormalizedPaths(pathMappings.map((item) => item.target));
  const layout = resolveWorkspaceSandboxLayout({ isolation, userId });
  return {
    directories: {
      view: "sandbox",
      currentDirectory: layout.userRoot,
      rootDirectory: layout.userRoot,
      opsWorkdir,
      relativePathBase: "rootDirectory",
      allowedRoots: uniqueNormalizedPaths([layout.root, ...mountTargets]),
      extraMountTargets: mountTargets,
    },
    sandbox: {
      provider: isolation.sandbox.provider,
      scope: isolation.sandbox.scope,
      root: layout.root,
      pathMappings,
    },
  };
}

export function resolveRuntimePathContext({
  hostRootDirectory,
  userId,
  globalConfig,
  executionPolicy,
  isSuperUser,
  pathPolicy,
}) {
  const hostRoot = requireTextInput(hostRootDirectory, "hostRootDirectory");
  const resolvedUserId = requireTextInput(userId, "userId");
  if (!isPlainObject(globalConfig)) {
    throw new TypeError("resolveRuntimePathContext requires globalConfig");
  }
  if (typeof isSuperUser !== "boolean") {
    throw new TypeError("resolveRuntimePathContext requires boolean isSuperUser");
  }
  const policy = assertToolExecutionPolicy(executionPolicy);
  const configuredHostRoots = resolveSuperAdminHostRoots(pathPolicy);
  const { view, opsWorkdir } = resolveRuntimeOpsWorkdir({
    hostRootDirectory: hostRoot,
    userId: resolvedUserId,
    executionPolicy: policy,
  });
  if (view === "host") {
    const superUserHostRoots = isSuperUser ? configuredHostRoots : [];
    return {
      view,
      directories: resolveHostDirectories({
        hostRootDirectory: hostRoot,
        opsWorkdir,
        superUserHostRoots,
      }),
      sandbox: null,
    };
  }
  return {
    view,
    ...resolveSandboxContext({
      globalConfig,
      isolation: policy.isolation,
      userId: resolvedUserId,
      opsWorkdir,
    }),
  };
}
