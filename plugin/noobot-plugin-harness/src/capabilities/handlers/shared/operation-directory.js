/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { resolveRuntimePathContext } from "@noobot/path-resolver";
import {
  EXECUTION_ISOLATION_MODE,
  WORKSPACE_SANDBOX_PATHS,
  resolveExecutionIsolation,
  resolveToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";

const DEFAULT_OPERATION_RELATIVE_PATH = WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE;

function normalizePath(value = "") {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/");
}

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.bindings?.runtime || null;
}

function resolveHostBasePath(ctx = {}, runtime = null) {
  return normalizePath(
    runtime?.basePath ||
      runtime?.systemRuntime?.staticInfo?.basePath ||
      ctx?.basePath ||
      ctx?.agentContext?.context?.environment?.workspace?.hostBasePath ||
      ctx?.agentContext?.context?.environment?.workspace?.basePath ||
      "",
  );
}

export function resolveOperationDirectoryContext(ctx = {}) {
  const runtime = resolveRuntime(ctx) || {};
  const hostBasePath = resolveHostBasePath(ctx, runtime);
  const relativePath = DEFAULT_OPERATION_RELATIVE_PATH;
  const hostWorkdir = hostBasePath
    ? normalizePath(path.join(hostBasePath, relativePath))
    : normalizePath(ctx?.agentContext?.context?.environment?.workspace?.cwd || "");
  const isolation = resolveExecutionIsolation(runtime.globalConfig || {});
  const sandboxEnabled = isolation.mode === EXECUTION_ISOLATION_MODE.SANDBOX;
  const pathContext = resolveRuntimePathContext({
    runtime,
    agentContext: ctx?.agentContext || null,
    runtimeBasePath: hostBasePath,
    userId: runtime?.userId || runtime?.systemRuntime?.userId || "",
    globalConfig: runtime.globalConfig || {},
    executionPolicy: resolveToolExecutionPolicy({
      toolName: "execute_script",
      globalConfig: runtime.globalConfig || {},
    }),
  });
  const sandboxWorkdir = sandboxEnabled ? normalizePath(pathContext.opsWorkdir) : "";
  const activeView = sandboxEnabled ? "sandbox" : "non_sandbox";
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
  const source =
    operationDirectory && typeof operationDirectory === "object" ? operationDirectory : {};
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
  ]
    .filter(Boolean)
    .join("\n");
}
