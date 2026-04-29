/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

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

export function buildDynamicInfo({
  sessionId = "",
  parentSessionId = "",
  rootSessionId = "",
  caller = "user",
  dialogProcessId = "",
  sessionTree = {},
  runConfig = {},
  now = new Date().toISOString(),
} = {}) {
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
  return {
    sessionId: String(sessionId || "").trim(),
    parentSessionId: String(parentSessionId || "").trim(),
    rootSessionId: String(rootSessionId || "").trim(),
    caller: String(caller || "user").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    sessionTree,
    now,
    config: {
      allowUserInteraction: runConfig?.allowUserInteraction !== false,
      selectedConnectors,
      ...(Number.isFinite(Number(runConfig?.maxToolLoopTurns)) &&
      Number(runConfig?.maxToolLoopTurns) > 0
        ? { maxToolLoopTurns: Math.floor(Number(runConfig.maxToolLoopTurns)) }
        : {}),
    },
  };
}
