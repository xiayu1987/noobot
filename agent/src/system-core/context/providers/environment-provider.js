/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { resolveForceToolCall } from "../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../session/dialog-process-id-resolver.js";
import { normalizeParentSessionId } from "../parent-session-id-resolver.js";
import {
  hasOwnConfigKey,
  normalizeBooleanLike,
  normalizeSandboxProvider,
} from "../../config/index.js";

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

function normalizeContainerTarget(target = "") {
  const normalized = String(target || "").trim();
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveDockerExtraMountTargets(providerDetail = {}) {
  const dockerMounts = Array.isArray(providerDetail?.dockerMounts)
    ? providerDetail.dockerMounts
    : Array.isArray(providerDetail?.docker_mounts)
      ? providerDetail.docker_mounts
      : [];
  const extraTargets = dockerMounts
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => normalizeContainerTarget(
      item?.target || item?.mountTarget || item?.mount_target || "",
    ))
    .filter(Boolean);
  if (extraTargets.length) {
    return Array.from(new Set(extraTargets));
  }
  const legacyTarget = normalizeContainerTarget(
    providerDetail?.dockerProjectMountTarget || "",
  );
  return legacyTarget ? [legacyTarget] : [];
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
  const sandboxEnabled =
    executeScriptConfig?.sandboxMode === true || executeScriptConfig?.sandbox_mode === true;
  if (!sandboxEnabled) return null;

  const sandboxProviderConfig =
    executeScriptConfig?.sandboxProvider &&
    typeof executeScriptConfig.sandboxProvider === "object"
      ? executeScriptConfig.sandboxProvider
      : executeScriptConfig?.sandbox_provider &&
          typeof executeScriptConfig.sandbox_provider === "object"
        ? executeScriptConfig.sandbox_provider
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
    providerDetail?.dockerContainerScope ||
      providerDetail?.docker_container_scope ||
      "global",
  ).trim().toLowerCase();
  const normalizedUserPart = sanitizeDockerUserPart(userId || "user") || "user";

  if (provider === "firejail") {
    return {
      provider,
      cwd: "$HOME/runtime/sandbox/persist",
      basePath: "$HOME",
      allowedRoots: ["$HOME"],
    };
  }

  if (provider === "bubblewrap") {
    return {
      provider,
      cwd: "/workspace/runtime/sandbox/persist",
      basePath: "/workspace",
      allowedRoots: ["/workspace"],
    };
  }

  const dockerExtraTargets = resolveDockerExtraMountTargets(providerDetail);
  const dockerAllowedRoots = Array.from(
    new Set(["/workspace", ...dockerExtraTargets]),
  );

  return {
    provider,
    cwd:
      dockerScope === "user"
        ? "/workspace/runtime/ops_workdir"
        : `/workspace/${normalizedUserPart}/runtime/ops_workdir`,
    basePath: "/workspace",
    allowedRoots: dockerAllowedRoots,
    ...(dockerExtraTargets.length
      ? { extraMountTargets: dockerExtraTargets }
      : {}),
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
    userId: hostStaticInfo.userId,
    platform: hostStaticInfo.platform,
    arch: hostStaticInfo.arch,
    nodeVersion: hostStaticInfo.nodeVersion,
    timezone: hostStaticInfo.timezone,
    defaultWorkdir: sandboxView.cwd,
    sandboxRoot: sandboxView.basePath,
    relativePathBase: "defaultWorkdir",
    globalDefaults: {
      workspaceRoot: sandboxView.basePath,
    },
    sandbox: {
      enabled: true,
      provider: sandboxView.provider,
      defaultWorkdir: sandboxView.cwd,
      sandboxRoot: sandboxView.basePath,
      relativePathBase: "defaultWorkdir",
      allowedRoots: Array.isArray(sandboxView.allowedRoots)
        ? sandboxView.allowedRoots
        : [sandboxView.basePath],
      ...(Array.isArray(sandboxView.extraMountTargets) &&
      sandboxView.extraMountTargets.length
        ? { extraMountTargets: sandboxView.extraMountTargets }
        : {}),
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
    ...(hasOwnConfigKey(runConfig, "streaming")
      ? { streaming: normalizeBooleanLike(runConfig?.streaming, false) }
      : {}),
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
    parentSessionId: normalizeParentSessionId(parentSessionId),
    rootSessionId: String(rootSessionId || "").trim(),
    caller: String(caller || "user").trim(),
    dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
    sessionTree,
    now,
    config,
  };
}
