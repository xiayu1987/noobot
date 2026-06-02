/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { resolveForceToolCall } from "../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../session/dialog-process-id-resolver.js";
import { normalizeSandboxProvider } from "../../config/index.js";

export function resolveRuntimeBasePath({ userId = "", globalConfig = {} } = {}) {
  if (!userId) return "";
  const workspaceRoot = globalConfig?.workspaceRoot || "";
  if (!workspaceRoot) return "";
  return path.resolve(workspaceRoot, userId);
}

export function buildStaticInfo({ runtimeBasePath = "", userId = "", globalConfig = {} } = {}) {
  return {
    cwd: process.cwd(),
    userId: userId || "",
    basePath: runtimeBasePath || "",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    globalDefaults: {
      workspaceRoot: globalConfig?.workspaceRoot || "",
    },
  };
}

function sanitizeDockerUserPart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function resolveSandboxPromptView({
  userId = "",
  effectiveConfig = {},
} = {}) {
  const toolsConfig =
    effectiveConfig?.tools && typeof effectiveConfig.tools === "object"
      ? effectiveConfig.tools
      : {};
  const executeScriptConfig =
    toolsConfig?.execute_script && typeof toolsConfig.execute_script === "object"
      ? toolsConfig.execute_script
      : {};
  const sandboxEnabled = executeScriptConfig?.sandboxMode === true;
  if (!sandboxEnabled) return null;

  const sandboxProviderConfig =
    executeScriptConfig?.sandboxProvider &&
    typeof executeScriptConfig.sandboxProvider === "object"
      ? executeScriptConfig.sandboxProvider
      : {};
  const provider = normalizeSandboxProvider(
    sandboxProviderConfig?.default || "docker",
  );
  const providerDetail =
    sandboxProviderConfig?.[provider] &&
    typeof sandboxProviderConfig[provider] === "object"
      ? sandboxProviderConfig[provider]
      : {};
  const dockerScope = String(
    providerDetail?.dockerContainerScope || "global",
  ).trim().toLowerCase();
  const normalizedUserPart = sanitizeDockerUserPart(userId || "user") || "user";

  if (provider === "firejail") {
    return {
      provider,
      cwd: "$HOME/runtime/sandbox/persist",
      basePath: "$HOME",
    };
  }

  if (provider === "bubblewrap") {
    return {
      provider,
      cwd: "/workspace/runtime/sandbox/persist",
      basePath: "/workspace",
    };
  }

  return {
    provider,
    cwd:
      dockerScope === "user"
        ? "/workspace/runtime/workspace"
        : `/workspace/${normalizedUserPart}/runtime/workspace`,
    basePath: "/workspace",
  };
}

export function buildSandboxViewStaticInfo({
  runtimeBasePath = "",
  userId = "",
  globalConfig = {},
  effectiveConfig = {},
} = {}) {
  const hostStaticInfo = buildStaticInfo({ runtimeBasePath, userId, globalConfig });
  const sandboxView = resolveSandboxPromptView({
    userId,
    effectiveConfig,
  });
  if (!sandboxView) return hostStaticInfo;
  return {
    ...hostStaticInfo,
    cwd: sandboxView.cwd,
    basePath: sandboxView.basePath,
    globalDefaults: {
      workspaceRoot: sandboxView.basePath,
    },
    sandbox: {
      enabled: true,
      provider: sandboxView.provider,
      cwd: sandboxView.cwd,
      basePath: sandboxView.basePath,
      hostPathHidden: true,
    },
  };
}

export function buildDynamicInfo({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  rootSessionId = "",
  caller = "user",
  dialogProcessId = "",
  sessionTree = {},
  runConfig = {},
  now = new Date().toISOString(),
} = {}) {
  const forceTool = resolveForceToolCall(runConfig);
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? { ...runConfig.toolPolicy }
      : null;
  const selectedConnectorsSource =
    runConfig?.selectedConnectors && typeof runConfig.selectedConnectors === "object"
      ? runConfig.selectedConnectors
      : {};
  const selectedConnectors = Object.fromEntries(
    Object.entries(selectedConnectorsSource)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => Boolean(connectorType)),
  );
  const config = {
    allowUserInteraction: runConfig?.allowUserInteraction !== false,
    forceTool,
    ...(toolPolicy ? { toolPolicy } : {}),
    selectedConnectors,
    ...(Number.isFinite(Number(runConfig?.maxToolLoopTurns)) &&
    Number(runConfig?.maxToolLoopTurns) > 0
      ? { maxToolLoopTurns: Math.floor(Number(runConfig.maxToolLoopTurns)) }
      : {}),
  };
  return {
    userId: String(userId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    parentSessionId: String(parentSessionId || "").trim(),
    rootSessionId: String(rootSessionId || "").trim(),
    caller: String(caller || "user").trim(),
    dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
    sessionTree,
    now,
    config,
  };
}
