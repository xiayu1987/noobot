/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeDockerContainerScope,
  normalizeSandboxProvider,
} from "../config/index.js";
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

export const TOOL_PATH_VIEWS = Object.freeze({
  WORKSPACE_RELATIVE: "workspace-relative",
  SANDBOX_ABSOLUTE: "sandbox-absolute",
  HOST_ABSOLUTE: "host-absolute",
  VIRTUAL_RELATIVE: "virtual-relative",
  EMPTY: "",
});

const VIRTUAL_TOOL_PATH_ROOTS = new Set(["project", "workspace", "workdir", "repo", "repository"]);
const OPS_WORKDIR_RELATIVE_PATH = "runtime/ops_workdir";

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

function normalizeWorkspaceRootAlias(value = "") {
  const normalized = normalizeSlashPath(value);
  if (normalized === "/workspace" || normalized.startsWith("/workspace/")) return "workspace";
  if (normalized === "/project" || normalized.startsWith("/project/")) return "project";
  return "";
}

export function classifyToolInputPath(inputPath = "", { agentContext = null } = {}) {
  const raw = String(inputPath || "").trim();
  if (!raw) {
    return {
      view: TOOL_PATH_VIEWS.EMPTY,
      raw,
      normalized: "",
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const normalized = normalizePathForPlatform(raw, {
    platform: resolvePathPlatformFromContext(agentContext, ""),
  });
  if (!normalized && (raw === "." || raw === "./")) {
    return {
      view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE,
      raw,
      normalized: ".",
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const sandboxRoot = normalizeWorkspaceRootAlias(normalized);
  if (sandboxRoot) {
    return {
      view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
      raw,
      normalized,
      virtualRoot: "",
      sandboxRoot,
    };
  }
  if (isAbsolutePathAnyPlatform(normalized)) {
    return {
      view: TOOL_PATH_VIEWS.HOST_ABSOLUTE,
      raw,
      normalized,
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const firstSegment = normalized.split("/").filter(Boolean)[0] || "";
  if (VIRTUAL_TOOL_PATH_ROOTS.has(firstSegment)) {
    return {
      view: TOOL_PATH_VIEWS.VIRTUAL_RELATIVE,
      raw,
      normalized,
      virtualRoot: firstSegment,
      sandboxRoot: "",
    };
  }
  return {
    view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE,
    raw,
    normalized,
    virtualRoot: "",
    sandboxRoot: "",
  };
}

function resolveSharedToolHostPath({ inputPath = "", runtime = {}, agentContext = null } = {}) {
  const payload = {
    path: inputPath,
    sandboxPath: inputPath,
    runtime,
    agentContext,
  };
  const resolverCandidates = [
    runtime?.sharedTools?.resolveHostPath,
    runtime?.sharedTools?.toHostPath,
    runtime?.sharedTools?.pathMapper?.toHostPath,
  ];
  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(resolver(payload) || "").trim();
      if (resolved) return filePath.resolve(resolved);
    } catch {
      // Ignore resolver errors; path validation remains deterministic.
    }
  }
  return "";
}

export function resolveToolInputPath({
  inputPath = "",
  agentContext = null,
  runtime = {},
  workspacePath = "",
  workspaceRoot = "",
  allowHostAbsolute = false,
  allowSandbox = true,
  allowVirtualRelative = true,
} = {}) {
  const classified = classifyToolInputPath(inputPath, { agentContext });
  const normalizedWorkspace = workspacePath ? filePath.resolve(workspacePath) : "";
  const normalizedWorkspaceRoot = workspaceRoot ? filePath.resolve(workspaceRoot) : "";
  if (!classified.normalized) {
    return {
      ...classified,
      ok: false,
      error: "empty_path",
      resolvedPath: "",
      workspaceRelativePath: "",
      hint: "Path is required.",
    };
  }

  const sharedResolved = resolveSharedToolHostPath({
    inputPath: classified.normalized,
    runtime,
    agentContext,
  });
  if (sharedResolved) {
    return {
      ...classified,
      ok: true,
      resolvedPath: sharedResolved,
      workspaceRelativePath: "",
      mapped: true,
      error: "",
      hint: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE) {
    if (!allowSandbox) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: "sandbox_path_not_allowed",
        hint: "Sandbox paths are not allowed here.",
      };
    }
    if (classified.sandboxRoot === "workspace" && normalizedWorkspaceRoot) {
      const normalizedSandboxPath = normalizeSlashPath(classified.normalized);
      const sandboxUserRoot = normalizeSlashPath(resolveSandboxUserRoot(runtime));
      if (sandboxUserRoot === "/workspace" && normalizedWorkspace) {
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspace
          : filePath.resolve(normalizedWorkspace, normalizedSandboxPath.slice("/workspace/".length));
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
      if (sandboxUserRoot.startsWith("/workspace/")) {
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspaceRoot
          : filePath.resolve(normalizedWorkspaceRoot, normalizedSandboxPath.slice("/workspace/".length));
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
      if (!sandboxUserRoot) {
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspaceRoot
          : filePath.resolve(normalizedWorkspaceRoot, normalizedSandboxPath.slice("/workspace/".length));
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
    }
    const mappedBySandbox = resolveHostPath({
      path: classified.normalized,
      sandboxPath: classified.normalized,
      runtime: { ...runtime, basePath: runtime?.basePath || normalizedWorkspace },
      agentContext,
    });
    if (mappedBySandbox) {
      return {
        ...classified,
        ok: true,
        resolvedPath: filePath.resolve(mappedBySandbox),
        workspaceRelativePath: "",
        mapped: true,
        error: "",
        hint: "",
      };
    }
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      error: "sandbox_path_not_mapped",
      hint: "Sandbox path is not mapped to a host path.",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.HOST_ABSOLUTE) {
    if (!allowHostAbsolute) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: "host_absolute_not_allowed",
        hint: "Host absolute paths are only allowed for super users.",
      };
    }
    return {
      ...classified,
      ok: true,
      resolvedPath: normalizePathForPlatform(classified.normalized),
      workspaceRelativePath: "",
      mapped: false,
      error: "",
      hint: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.VIRTUAL_RELATIVE && !allowVirtualRelative) {
    const relativeWithoutVirtualRoot = classified.normalized.split("/").slice(1).join("/");
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      candidateWorkspaceRelativePath: relativeWithoutVirtualRoot,
      candidateSandboxPath: `/${classified.normalized}`,
      error: "virtual_relative_path_ambiguous",
      hint: `Use /${classified.virtualRoot}/... for sandbox paths, or remove '${classified.virtualRoot}/' for workspace-relative paths.`,
    };
  }

  return {
    ...classified,
    ok: true,
    resolvedPath: filePath.resolve(normalizedWorkspace || ".", classified.normalized),
    workspaceRelativePath: classified.normalized,
    mapped: false,
    error: "",
    hint: "",
  };
}

function sanitizeSandboxUserPart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function resolveRuntimeUserId({ runtime = {}, agentContext = null, userId = "" } = {}) {
  return String(
    userId ||
      runtime?.systemRuntime?.userId ||
      runtime?.userId ||
      agentContext?.environment?.identity?.userId ||
      "",
  ).trim();
}

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
