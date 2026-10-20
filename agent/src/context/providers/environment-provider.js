/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
import { filePath as path, resolveRuntimePathContext } from "@noobot/path-resolver";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import {
  SECURITY_RISK_LEVEL,
  normalizeSecurityRiskLevel,
} from "@noobot/security-assessment-protocol";
import { hasOwnConfigKey, normalizeBoolean } from "../../config/index.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { isConfiguredSuperUser } from "../../shared/utils/super-user.js";
import { resolveConfiguredPathPolicy } from "../../config/core/path-policy-adapter.js";
import { text } from "@noobot/shared/value";

export function resolveRuntimeBasePath({ userId, globalConfig }) {
  if (!text(userId) || !text(globalConfig.workspaceRoot)) {
    throw new TypeError("resolveRuntimeBasePath requires userId and globalConfig.workspaceRoot");
  }
  return path.resolve(globalConfig.workspaceRoot, userId);
}

export function resolveContextIdentityInfo({ userId = "", globalConfig = {} } = {}) {
  return {
    userId: text(userId),
    isSuperUser: isConfiguredSuperUser({ globalConfig, userId }),
  };
}

export function buildStaticInfo({ runtimeBasePath, identity, globalConfig }) {
  const pathContext = resolveRuntimePathContext({
    hostRootDirectory: runtimeBasePath,
    userId: identity.userId,
    globalConfig,
    executionPolicy: resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig }),
    isSuperUser: identity.isSuperUser,
    pathPolicy: resolveConfiguredPathPolicy(globalConfig),
  });
  const { directories } = pathContext;
  return {
    cwd: directories.currentDirectory,
    userId: identity.userId,
    basePath: directories.rootDirectory,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    globalDefaults: {
      workspaceRoot: pathContext.sandbox ? pathContext.sandbox.root : globalConfig.workspaceRoot,
    },
    directories,
    identity,
  };
}

export function buildDynamicInfo({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  rootSessionId = "",
  caller = "user",
  dialogProcessId = "",
  runConfig = {},
  now = new Date().toISOString(),
} = {}) {
  const normalizedTurnScopeId = text(runConfig?.turnScopeId);
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? { ...runConfig.toolPolicy }
      : null;
  const selectedConnectorIds = normalizeSelectedConnectorIds(runConfig?.selectedConnectorIds);
  const config = {
    allowUserInteraction: runConfig?.allowUserInteraction !== false,
    safeConfirm: runConfig?.safeConfirm !== false,
    sanitizeOutput: runConfig?.sanitizeOutput !== false,
    safeConfirmLevel: normalizeSecurityRiskLevel(
      runConfig?.safeConfirmLevel,
      SECURITY_RISK_LEVEL.LOW,
    ),
    ...(hasOwnConfigKey(runConfig, "streaming")
      ? { streaming: normalizeBoolean(runConfig?.streaming, false) }
      : {}),
    ...(toolPolicy ? { toolPolicy } : {}),
    selectedConnectorIds,
  };
  return {
    userId: text(userId),
    sessionId: text(sessionId),
    parentSessionId: normalizeParentSessionId(parentSessionId),
    rootSessionId: text(rootSessionId),
    caller: text(caller) || "user",
    dialogProcessId: normalizeDialogProcessId(dialogProcessId),
    turnScopeId: normalizedTurnScopeId,
    now,
    config,
  };
}
