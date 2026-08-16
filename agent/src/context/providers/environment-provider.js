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
import { hasOwnConfigKey, normalizeBooleanLike } from "../../config/index.js";
import { normalizeSelectedConnectors } from "@noobot/agent-config-protocol/enums";

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
    executionPolicy: resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig }),
  });
  return {
    cwd: pathContext.currentDirectory,
    userId: userId || "",
    basePath: pathContext.rootDirectory,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    globalDefaults: {
      workspaceRoot:
        pathContext.view === "sandbox"
          ? pathContext.sandboxRoot
          : globalConfig?.workspaceRoot || "",
    },
    directories: pathContext.directories,
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
  const normalizedTurnScopeId = String(runConfig?.turnScopeId || "").trim();
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? { ...runConfig.toolPolicy }
      : null;
  const selectedConnectors = normalizeSelectedConnectors(runConfig?.selectedConnectors);
  const config = {
    allowUserInteraction: runConfig?.allowUserInteraction !== false,
    safeConfirm: runConfig?.safeConfirm !== false,
    sanitizeOutput: runConfig?.sanitizeOutput !== false,
    safeConfirmLevel: normalizeSecurityRiskLevel(
      runConfig?.safeConfirmLevel,
      SECURITY_RISK_LEVEL.LOW,
    ),
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
    dialogProcessId: normalizeDialogProcessId(dialogProcessId),
    turnScopeId: normalizedTurnScopeId,
    now,
    config: {
      ...config,
      ...(normalizedTurnScopeId ? { turnScopeId: normalizedTurnScopeId } : {}),
    },
  };
}
