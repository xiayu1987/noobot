/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, PATH_VIEWS, normalizeSlashPath } from "./platform.mjs";
import { resolveSandboxPathMappings, resolveRuntimeUserId } from "./sandbox-mapping.mjs";
import {
  EXECUTION_ISOLATION_MODE,
  WORKSPACE_SANDBOX_PATHS,
  resolveExecutionIsolation,
  resolveWorkspaceSandboxLayout,
} from "@noobot/execution-isolation-protocol";

function resolveRuntimeHostRoot({
  runtime = {},
  agentContext = null,
  runtimeBasePath = "",
  workspacePath = "",
} = {}) {
  return String(
    runtimeBasePath ||
      workspacePath ||
      runtime?.basePath ||
      agentContext?.context?.environment?.workspace?.basePath ||
      "",
  ).trim();
}

function resolveRuntimeWorkspaceRoot({ runtime = {}, globalConfig = {}, workspaceRoot = "" } = {}) {
  return String(
    workspaceRoot || globalConfig?.workspaceRoot || runtime?.globalConfig?.workspaceRoot || "",
  ).trim();
}

function uniqueNormalizedPaths(paths = []) {
  return Array.from(new Set(paths.map((item) => normalizeSlashPath(item)).filter(Boolean)));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveStaticPathDirectories({ runtime = {}, agentContext = null } = {}) {
  const contextStaticInfo = objectOrEmpty(agentContext?.context?.environment?.staticInfo);
  const runtimeStaticInfo = objectOrEmpty(runtime?.systemRuntime?.staticInfo);
  return objectOrEmpty(contextStaticInfo.directories || runtimeStaticInfo.directories);
}

function isHostFilesystemSentinel(value = "") {
  return String(value || "").trim() === "<host-filesystem>";
}

export function resolveRuntimePathContext({
  runtime = {},
  agentContext = null,
  runtimeBasePath = "",
  workspacePath = "",
  workspaceRoot = "",
  userId = "",
  globalConfig = {},
  executionContext = {},
} = {}) {
  const resolvedUserId = resolveRuntimeUserId({ runtime, agentContext, userId });
  const hostRootDirectory = resolveRuntimeHostRoot({
    runtime,
    agentContext,
    runtimeBasePath,
    workspacePath,
  });
  const hostWorkspaceRoot = resolveRuntimeWorkspaceRoot({
    runtime,
    globalConfig,
    workspaceRoot,
  });
  const hostOpsWorkdir = hostRootDirectory
    ? filePath.join(hostRootDirectory, WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE)
    : "";
  const resolvedGlobalConfig = Object.keys(globalConfig).length
    ? globalConfig
    : objectOrEmpty(runtime?.globalConfig);
  const isolation = resolveExecutionIsolation(resolvedGlobalConfig);
  const executionView = String(executionContext?.view || isolation.mode)
    .trim()
    .toLowerCase();
  const sandboxEnabled = executionView === EXECUTION_ISOLATION_MODE.SANDBOX;
  const sandboxProvider = sandboxEnabled ? isolation.sandbox.provider : "";
  const mappingRuntime = {
    ...runtime,
    globalConfig: resolvedGlobalConfig,
    userConfig: {},
  };
  const sandboxPathMappings = sandboxEnabled ? resolveSandboxPathMappings(mappingRuntime) : [];
  const hostMountSources = uniqueNormalizedPaths(
    sandboxPathMappings.map((item = {}) => item.source),
  );
  const sandboxMountTargets = uniqueNormalizedPaths(
    sandboxPathMappings.map((item = {}) => item.target),
  );
  const hostDirectories = {
    view: "host",
    currentDirectory: hostOpsWorkdir,
    rootDirectory: hostRootDirectory,
    opsWorkdir: hostOpsWorkdir,
    relativePathBase: "rootDirectory",
    allowedRoots: uniqueNormalizedPaths([hostRootDirectory]),
  };
  const hostContext = {
    view: "host",
    sandboxEnabled: false,
    sandboxProvider: "",
    sandboxScope: "",
    isDockerGlobal: false,
    currentDirectory: hostDirectories.currentDirectory,
    rootDirectory: hostDirectories.rootDirectory,
    opsWorkdir: hostDirectories.opsWorkdir,
    sandboxRoot: "",
    userRoot: hostRootDirectory,
    relativePathBase: hostDirectories.relativePathBase,
    allowedRoots: hostDirectories.allowedRoots,
    extraMountTargets: [],
    hostRootDirectory,
    hostWorkspaceRoot,
    hostOpsWorkdir,
    hostAllowedRoots: [],
    hostMountSources,
    sandboxMountTargets,
    sandboxPathMappings,
    directories: hostDirectories,
  };
  if (!sandboxEnabled) return hostContext;

  const layout = resolveWorkspaceSandboxLayout({ isolation, userId: resolvedUserId });
  const sandboxScope = isolation.sandbox.scope;
  const sandboxRoot = layout.root;
  const isDockerGlobal = !layout.userIsolated;
  const userRoot = layout.userRoot;
  const opsWorkdir = layout.opsWorkdir;
  const allowedRoots = uniqueNormalizedPaths([sandboxRoot, ...sandboxMountTargets]);
  const directories = {
    view: "sandbox",
    currentDirectory: opsWorkdir,
    rootDirectory: userRoot,
    opsWorkdir,
    relativePathBase: "rootDirectory",
    allowedRoots,
    ...(sandboxMountTargets.length ? { extraMountTargets: sandboxMountTargets } : {}),
  };
  return {
    ...hostContext,
    view: "sandbox",
    sandboxEnabled: true,
    sandboxProvider,
    sandboxScope,
    isDockerGlobal,
    currentDirectory: opsWorkdir,
    rootDirectory: userRoot,
    opsWorkdir,
    sandboxRoot,
    userRoot,
    allowedRoots,
    extraMountTargets: sandboxMountTargets,
    directories,
  };
}

export function resolveAgentPathContext({
  runtime = {},
  agentContext = null,
  runtimeBasePath = "",
  workspacePath = "",
  workspaceRoot = "",
  userId = "",
  globalConfig = {},
  executionContext = {},
} = {}) {
  const baseContext = resolveRuntimePathContext({
    runtime,
    agentContext,
    runtimeBasePath,
    workspacePath,
    workspaceRoot,
    userId,
    globalConfig,
    executionContext,
  });
  const staticDirectories = resolveStaticPathDirectories({ runtime, agentContext });
  if (!Object.keys(staticDirectories).length) return baseContext;

  const directoryView = String(
    staticDirectories.view || baseContext.directories.view || baseContext.view || "",
  ).trim();
  const directories = {
    ...baseContext.directories,
    ...staticDirectories,
    view: directoryView || baseContext.directories.view,
    allowedRoots: Array.isArray(staticDirectories.allowedRoots)
      ? uniqueNormalizedPaths(staticDirectories.allowedRoots)
      : baseContext.directories.allowedRoots,
  };
  const isSandboxView = directories.view === PATH_VIEWS.SANDBOX;
  const staticRootDirectory = String(directories.rootDirectory || "").trim();
  const hostRootDirectory =
    !isSandboxView && staticRootDirectory ? staticRootDirectory : baseContext.hostRootDirectory;
  const hostAllowedRoots =
    !isSandboxView && Array.isArray(directories.allowedRoots)
      ? uniqueNormalizedPaths(
          directories.allowedRoots.filter((item) => !isHostFilesystemSentinel(item)),
        )
      : [];

  return {
    ...baseContext,
    view: directories.view || baseContext.view,
    currentDirectory: directories.currentDirectory || baseContext.currentDirectory,
    rootDirectory: directories.rootDirectory || baseContext.rootDirectory,
    opsWorkdir: directories.opsWorkdir || baseContext.opsWorkdir,
    relativePathBase: directories.relativePathBase || baseContext.relativePathBase,
    allowedRoots: directories.allowedRoots || baseContext.allowedRoots,
    extraMountTargets: Array.isArray(directories.extraMountTargets)
      ? directories.extraMountTargets
      : baseContext.extraMountTargets,
    hostRootDirectory,
    hostAllowedRoots,
    directories,
  };
}
