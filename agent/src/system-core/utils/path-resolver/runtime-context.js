/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, PATH_VIEWS, normalizeSlashPath } from "./platform.js";
import { resolveSandboxPathMappings, resolveExecuteScriptConfig, resolveRuntimeUserId, sanitizeSandboxUserPart } from "./sandbox-mapping.js";
import { normalizeDockerContainerScope, normalizeSandboxProvider } from "../../config/index.js";

const OPS_WORKDIR_RELATIVE_PATH = "runtime/ops_workdir";

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
      agentContext?.environment?.workspace?.basePath ||
      agentContext?.environment?.staticInfo?.basePath ||
      "",
  ).trim();
}

function resolveRuntimeWorkspaceRoot({
  runtime = {},
  globalConfig = {},
  workspaceRoot = "",
} = {}) {
  return String(
    workspaceRoot ||
      globalConfig?.workspaceRoot ||
      runtime?.globalConfig?.workspaceRoot ||
      "",
  ).trim();
}

function resolveEffectiveExecuteScriptConfig({
  runtime = {},
  effectiveConfig = {},
} = {}) {
  const effectiveScriptConfig =
    effectiveConfig?.tools?.execute_script &&
    typeof effectiveConfig.tools.execute_script === "object"
      ? effectiveConfig.tools.execute_script
      : null;
  if (effectiveScriptConfig) return effectiveScriptConfig;
  return resolveExecuteScriptConfig(runtime);
}

function resolveSandboxProviderContext(scriptConfig = {}) {
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
  return { provider, providerDetail, providerConfig: sandboxProviderCfg };
}

function resolveRuntimePathMappingRuntime({
  runtime = {},
  effectiveConfig = {},
} = {}) {
  if (effectiveConfig?.tools && typeof effectiveConfig.tools === "object") {
    return {
      ...runtime,
      globalConfig: effectiveConfig,
      userConfig: {},
    };
  }
  return runtime;
}

function uniqueNormalizedPaths(paths = []) {
  return Array.from(
    new Set(
      paths
        .map((item) => normalizeSlashPath(item))
        .filter(Boolean),
    ),
  );
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveStaticPathDirectories({ runtime = {}, agentContext = null } = {}) {
  const contextStaticInfo = objectOrEmpty(agentContext?.environment?.staticInfo);
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
  effectiveConfig = {},
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
    ? filePath.join(hostRootDirectory, OPS_WORKDIR_RELATIVE_PATH)
    : "";
  const scriptConfig = resolveEffectiveExecuteScriptConfig({ runtime, effectiveConfig });
  const sandboxEnabled =
    scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  const { provider: sandboxProvider, providerDetail } =
    resolveSandboxProviderContext(scriptConfig);
  const mappingRuntime = resolveRuntimePathMappingRuntime({ runtime, effectiveConfig });
  const sandboxPathMappings = resolveSandboxPathMappings(mappingRuntime);
  const hostMountSources = uniqueNormalizedPaths(
    sandboxPathMappings.map((item = {}) => item.source),
  );
  const sandboxMountTargets = uniqueNormalizedPaths(
    sandboxPathMappings.map((item = {}) => item.target),
  );
  const hostDirectories = {
    view: "host",
    currentDirectory: process.cwd(),
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

  if (sandboxProvider === "firejail") {
    const sandboxRoot = "$HOME";
    const opsWorkdir = "$HOME/runtime/sandbox/persist";
    const allowedRoots = uniqueNormalizedPaths([sandboxRoot, ...sandboxMountTargets]);
    const directories = {
      view: "sandbox",
      currentDirectory: opsWorkdir,
      rootDirectory: sandboxRoot,
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
      currentDirectory: opsWorkdir,
      rootDirectory: sandboxRoot,
      opsWorkdir,
      sandboxRoot,
      userRoot: sandboxRoot,
      allowedRoots,
      extraMountTargets: sandboxMountTargets,
      directories,
    };
  }

  if (sandboxProvider === "bubblewrap") {
    const sandboxRoot = "/workspace";
    const opsWorkdir = "/workspace/runtime/sandbox/persist";
    const allowedRoots = uniqueNormalizedPaths([sandboxRoot, ...sandboxMountTargets]);
    const directories = {
      view: "sandbox",
      currentDirectory: opsWorkdir,
      rootDirectory: sandboxRoot,
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
      currentDirectory: opsWorkdir,
      rootDirectory: sandboxRoot,
      opsWorkdir,
      sandboxRoot,
      userRoot: sandboxRoot,
      allowedRoots,
      extraMountTargets: sandboxMountTargets,
      directories,
    };
  }

  const sandboxScope = normalizeDockerContainerScope(
    providerDetail?.dockerContainerScope ||
      providerDetail?.docker_container_scope ||
      "global",
  );
  const userPart = sanitizeSandboxUserPart(resolvedUserId || "user") || "user";
  const sandboxRoot = "/workspace";
  const isDockerGlobal = sandboxScope !== "user";
  const userRoot = isDockerGlobal ? `/workspace/${userPart}` : "/workspace";
  const opsWorkdir = `${userRoot}/${OPS_WORKDIR_RELATIVE_PATH}`;
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
  effectiveConfig = {},
} = {}) {
  const baseContext = resolveRuntimePathContext({
    runtime,
    agentContext,
    runtimeBasePath,
    workspacePath,
    workspaceRoot,
    userId,
    globalConfig,
    effectiveConfig,
  });
  const staticDirectories = resolveStaticPathDirectories({ runtime, agentContext });
  if (!Object.keys(staticDirectories).length) return baseContext;

  const directoryView = String(staticDirectories.view || baseContext.directories.view || baseContext.view || "").trim();
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
  const hostRootDirectory = !isSandboxView && staticRootDirectory
    ? staticRootDirectory
    : baseContext.hostRootDirectory;
  const hostAllowedRoots = !isSandboxView && Array.isArray(directories.allowedRoots)
    ? uniqueNormalizedPaths(directories.allowedRoots.filter((item) => !isHostFilesystemSentinel(item)))
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

export function resolveToolPathPolicy({
  runtime = {},
  agentContext = null,
  runtimeBasePath = "",
  workspacePath = "",
  workspaceRoot = "",
  userId = "",
  globalConfig = {},
  effectiveConfig = {},
  isSuperUser = false,
} = {}) {
  const pathContext = resolveAgentPathContext({
    runtime,
    agentContext,
    runtimeBasePath,
    workspacePath,
    workspaceRoot,
    userId,
    globalConfig,
    effectiveConfig,
  });
  const validationRoot = workspacePath || runtimeBasePath || pathContext.hostRootDirectory;
  const relativeHostRoot = pathContext.hostRootDirectory || validationRoot || ".";
  const sandboxModeEnabled = pathContext.sandboxEnabled;
  const allowedRoots = uniqueNormalizedPaths([
    validationRoot,
    ...pathContext.hostAllowedRoots,
    ...(isSuperUser && sandboxModeEnabled && pathContext.isDockerGlobal && workspaceRoot
      ? [workspaceRoot]
      : []),
    ...pathContext.hostMountSources,
  ])
    .filter((item) => !isHostFilesystemSentinel(item))
    .map((item) => filePath.resolve(item));
  return {
    pathContext,
    relativeHostRoot: filePath.resolve(relativeHostRoot),
    validationRoot: validationRoot ? filePath.resolve(validationRoot) : "",
    allowedRoots,
    sandboxModeEnabled,
    superUserBypassesDirectoryScope: isSuperUser && !sandboxModeEnabled,
  };
}
