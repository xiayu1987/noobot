/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  safeNum,
  normalizeSelectedConnectors,
} from "../../shared/utils/shared-utils.js";
import { createAgentContextEnvelope } from "@noobot/context-protocol/agent-context-envelope";

export function mapToAgentContextSchema({
  staticAgentContext = {},
  runtime = {},
  dialogProcessId = "",
  resolvedRootSessionId = "",
  resolvedSessionTree = {},
  sessionId = "",
  parentSessionId = "",
  caller = "user",
  turnScopeId = "",
  runId = "",
  now = new Date().toISOString(),
  systemMessages = [],
  conversationMessages = [],
  incrementalMessages = [],
  globalConfig = {},
} = {}) {
  const runtimeRef = runtime && typeof runtime === "object" ? runtime : {};
  const systemRuntime =
    runtimeRef?.systemRuntime && typeof runtimeRef.systemRuntime === "object"
      ? runtimeRef.systemRuntime
      : {};
  const selectedConnectors = normalizeSelectedConnectors(
    systemRuntime?.config?.selectedConnectors || {},
  );
  const identity = {
    userId: staticAgentContext?.identity?.userId || staticAgentContext.userId || "",
    sessionId: systemRuntime?.sessionId || sessionId,
    rootSessionId: systemRuntime?.rootSessionId || resolvedRootSessionId,
    parentSessionId: systemRuntime?.parentSessionId || parentSessionId,
    dialogProcessId,
    turnScopeId,
    runId,
  };
  return createAgentContextEnvelope({
    identity,
    environment: {
      os: {
        platform: staticAgentContext.platform || "",
        arch: staticAgentContext.arch || "",
        timezone: staticAgentContext.timezone || "",
        nodeVersion: staticAgentContext.nodeVersion || "",
      },
      workspace: {
        cwd: staticAgentContext.cwd || "",
        basePath: staticAgentContext.basePath || "",
        workspaceDirectories: Array.isArray(staticAgentContext.workspaceDirectories)
          ? staticAgentContext.workspaceDirectories
          : [],
        globalDefaults:
          staticAgentContext.globalDefaults &&
          typeof staticAgentContext.globalDefaults === "object"
            ? staticAgentContext.globalDefaults
            : { workspaceRoot: globalConfig?.workspaceRoot || "" },
      },
      permissions: {
        isSuperUser:
          staticAgentContext?.identity?.isSuperUser === true ||
          systemRuntime?.isSuperUser === true,
      },
    },
    execution: {
      timestamp: String(systemRuntime?.now || now).trim(),
      caller: String(systemRuntime?.caller || caller || "user").trim(),
      flags: {
        allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
        safeConfirm: systemRuntime?.config?.safeConfirm !== false,
        maxToolLoopTurns: safeNum(systemRuntime?.config?.maxToolLoopTurns),
      },
      model: {
        runtimeModel: String(runtimeRef?.runtimeModel || "").trim(),
        allEnabledProviders:
          runtimeRef?.allEnabledProviders &&
          typeof runtimeRef.allEnabledProviders === "object"
            ? runtimeRef.allEnabledProviders
            : {},
      },
      selectedConnectors,
    },
    modelContext: {
      protocolVersion: 1,
      activeTurnIdentity: {
        dialogProcessId: String(dialogProcessId || "").trim(),
        turnScopeId: String(turnScopeId || "").trim(),
      },
      messageBlocks: {
        system: Array.isArray(systemMessages) ? systemMessages : [],
        history: Array.isArray(conversationMessages) ? conversationMessages : [],
        incremental: Array.isArray(incrementalMessages) ? incrementalMessages : [],
      },
    },
  });
}
