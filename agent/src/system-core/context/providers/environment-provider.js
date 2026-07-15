/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath as path,
  resolveRuntimePathContext,
} from "../../utils/path-resolver.js";
import { resolveDialogProcessIdFromContext } from "../session/dialog-process-id-resolver.js";
import { normalizeParentSessionId } from "../parent-session-id-resolver.js";
import {
  hasOwnConfigKey,
  normalizeBooleanLike,
} from "../../config/index.js";

export function resolveRuntimeBasePath({ userId = "", globalConfig = {} } = {}) {
  if (!userId) return "";
  const workspaceRoot = globalConfig?.workspaceRoot || "";
  if (!workspaceRoot) return "";
  return path.resolve(workspaceRoot, userId);
}

export function buildStaticInfo({ runtimeBasePath = "", userId = "", globalConfig = {} } = {}) {
  const normalizedBasePath = runtimeBasePath || "";
  const pathContext = resolveRuntimePathContext({
    runtimeBasePath: normalizedBasePath,
    userId,
    globalConfig,
  });
  return {
    cwd: process.cwd(),
    userId: userId || "",
    basePath: normalizedBasePath,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    globalDefaults: {
      workspaceRoot: globalConfig?.workspaceRoot || "",
    },
    directories: pathContext.directories,
  };
}

export function buildSandboxViewStaticInfo({
  runtimeBasePath = "",
  userId = "",
  globalConfig = {},
  effectiveConfig = {},
} = {}) {
  const hostStaticInfo = buildStaticInfo({ runtimeBasePath, userId, globalConfig });
  const pathContext = resolveRuntimePathContext({
    runtimeBasePath,
    userId,
    globalConfig,
    effectiveConfig,
  });
  if (pathContext.view !== "sandbox") return hostStaticInfo;
  const directories = pathContext.directories;
  return {
    userId: hostStaticInfo.userId,
    platform: hostStaticInfo.platform,
    arch: hostStaticInfo.arch,
    nodeVersion: hostStaticInfo.nodeVersion,
    timezone: hostStaticInfo.timezone,
    cwd: directories.currentDirectory,
    defaultWorkdir: directories.opsWorkdir,
    sandboxRoot: pathContext.sandboxRoot,
    relativePathBase: directories.relativePathBase,
    globalDefaults: {
      workspaceRoot: pathContext.sandboxRoot,
    },
    directories,
    sandbox: {
      enabled: true,
      provider: pathContext.sandboxProvider,
      defaultWorkdir: directories.opsWorkdir,
      sandboxRoot: pathContext.sandboxRoot,
      relativePathBase: directories.relativePathBase,
      allowedRoots: directories.allowedRoots,
      ...(Array.isArray(pathContext.extraMountTargets) &&
      pathContext.extraMountTargets.length
        ? { extraMountTargets: pathContext.extraMountTargets }
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
  const normalizedTurnScopeId = String(runConfig?.turnScopeId || "").trim();
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
    safeConfirm: runConfig?.safeConfirm !== false,
    ...(hasOwnConfigKey(runConfig, "streaming")
      ? { streaming: normalizeBooleanLike(runConfig?.streaming, false) }
      : {}),
    ...(toolPolicy ? { toolPolicy } : {}),
    selectedConnectors,
  };
  return {
    userId: String(userId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    parentSessionId: normalizeParentSessionId(parentSessionId),
    rootSessionId: String(rootSessionId || "").trim(),
    caller: String(caller || "user").trim(),
    dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
    turnScopeId: normalizedTurnScopeId,
    sessionTree,
    now,
    config: {
      ...config,
      ...(normalizedTurnScopeId ? { turnScopeId: normalizedTurnScopeId } : {}),
    },
  };
}
