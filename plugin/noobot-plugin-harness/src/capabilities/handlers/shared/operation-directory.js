/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

const DEFAULT_OPERATION_RELATIVE_PATH = "runtime/ops_workdir";

function normalizePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/");
}

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function sanitizeSandboxUserPart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function resolveSandboxWorkdirFallback(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const providerConfig =
    scriptConfig?.sandboxProvider && typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : scriptConfig?.sandbox_provider && typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : {};
  const provider = String(providerConfig?.default || "docker").trim().toLowerCase();
  if (provider === "firejail") return "$HOME/runtime/sandbox/persist";
  if (provider === "bubblewrap" || provider === "bwrap") return "/workspace/runtime/sandbox/persist";
  const providerDetail =
    providerConfig?.[provider] && typeof providerConfig[provider] === "object"
      ? providerConfig[provider]
      : {};
  const scope = String(
    providerDetail?.dockerContainerScope ||
      providerDetail?.docker_container_scope ||
      "global",
  ).trim().toLowerCase();
  if (scope === "user") return "/workspace/runtime/ops_workdir";
  const userPart = sanitizeSandboxUserPart(runtime?.userId || runtime?.systemRuntime?.userId || "user") || "user";
  return `/workspace/${userPart}/runtime/ops_workdir`;
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
  return { ...globalCfg, ...userCfg };
}

function isSandboxEnabled(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  return scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
}

function resolveHostBasePath(ctx = {}, runtime = null) {
  // Prefer runtime.basePath because agentContext.environment may already be
  // rendered in sandbox view before harness sees it. Falling back to
  // environment.workspace.basePath is kept only for legacy/non-runtime tests.
  return normalizePath(
    runtime?.basePath ||
      runtime?.systemRuntime?.staticInfo?.basePath ||
      ctx?.basePath ||
      ctx?.agentContext?.environment?.workspace?.hostBasePath ||
      ctx?.agentContext?.environment?.workspace?.basePath ||
      "",
  );
}

function callPathResolver(resolver, payload = {}) {
  if (typeof resolver !== "function") return "";
  try {
    return normalizePath(resolver(payload));
  } catch {
    return "";
  }
}

function resolveSandboxWorkdir(ctx = {}, runtime = null, hostWorkdir = "") {
  const payload = {
    path: hostWorkdir,
    hostPath: hostWorkdir,
    relativePath: DEFAULT_OPERATION_RELATIVE_PATH,
    runtime,
    agentContext: ctx?.agentContext || null,
    purpose: "harness_operation_directory",
  };
  const sharedTools = runtime?.sharedTools || {};
  const resolverCandidates = [
    sharedTools.resolveSandboxPath,
    sharedTools.toSandboxPath,
    sharedTools.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolverCandidates) {
    const resolved = callPathResolver(resolver, payload);
    if (resolved) return resolved;
  }
  return normalizePath(
    runtime?.systemRuntime?.staticInfo?.sandbox?.defaultWorkdir ||
      runtime?.systemRuntime?.staticInfo?.defaultWorkdir ||
      ctx?.agentContext?.environment?.staticInfo?.sandbox?.defaultWorkdir ||
      ctx?.agentContext?.environment?.staticInfo?.defaultWorkdir ||
      resolveSandboxWorkdirFallback(runtime || {}) ||
      "",
  );
}

export function resolveOperationDirectoryContext(ctx = {}) {
  const runtime = resolveRuntime(ctx);
  const hostBasePath = resolveHostBasePath(ctx, runtime);
  const relativePath = DEFAULT_OPERATION_RELATIVE_PATH;
  const hostWorkdir = hostBasePath
    ? normalizePath(path.join(hostBasePath, relativePath))
    : normalizePath(ctx?.agentContext?.environment?.workspace?.cwd || "");
  const sandboxEnabled = isSandboxEnabled(runtime || {});
  const sandboxWorkdir = resolveSandboxWorkdir(ctx, runtime, hostWorkdir);
  const activeView = sandboxEnabled && sandboxWorkdir ? "sandbox" : "non_sandbox";
  const activeAbsolutePath = activeView === "sandbox" ? sandboxWorkdir : hostWorkdir;

  return {
    relativePath,
    absolutePath: activeAbsolutePath,
    view: activeView,
    sandboxEnabled,
    sandboxView: {
      relativePath,
      absolutePath: sandboxWorkdir || "",
    },
    nonSandboxView: {
      relativePath,
      absolutePath: hostWorkdir || "",
    },
  };
}

export function compactOperationDirectoryForPrompt(operationDirectory = {}) {
  const source = operationDirectory && typeof operationDirectory === "object" ? operationDirectory : {};
  return {
    relativePath: String(source.relativePath || DEFAULT_OPERATION_RELATIVE_PATH).trim(),
    absolutePath: String(source.absolutePath || "").trim(),
    view: String(source.view || "").trim() === "sandbox" ? "sandbox" : "non_sandbox",
  };
}

export function formatOperationDirectoryForRelay(operationDirectory = {}) {
  const compact = compactOperationDirectoryForPrompt(operationDirectory);
  const viewLabel = compact.view === "sandbox" ? "sandbox" : "non-sandbox";
  return [
    `[Harness operation dir] ${compact.relativePath}`,
    compact.absolutePath ? `Use (${viewLabel}): ${compact.absolutePath}` : "",
  ].filter(Boolean).join("\n");
}
