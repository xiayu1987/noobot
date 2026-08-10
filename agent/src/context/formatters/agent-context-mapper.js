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
import { createContextBuildReceipt } from "@noobot/context-protocol/context-build-receipt";

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
  messageId = "",
  now = new Date().toISOString(),
  systemMessages = [],
  conversationMessages = [],
  incrementalMessages = [],
  globalConfig = {},
  sourceRevision = "",
  contextBuildMode = "",
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
    messageId: String(
      messageId ||
        runtimeRef?.systemRuntime?.messageId ||
        runtimeRef?.runConfig?.messageId ||
        "",
    ).trim(),
  };
  const contextScopeIsComplete = Boolean(
    String(identity.sessionId || "").trim() &&
    String(identity.dialogProcessId || "").trim() &&
    String(identity.turnScopeId || "").trim(),
  );
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
      ...(contextScopeIsComplete ? { contextBuild: createContextBuildReceipt({
        scope: {
          sessionId: String(systemRuntime?.sessionId || sessionId).trim(),
          dialogProcessId: String(dialogProcessId || "").trim(),
          turnScopeId: String(turnScopeId || "").trim(),
        },
        mode: contextBuildMode,
        sourceRevision,
        startedAt: String(systemRuntime?.now || now).trim(),
        completedAt: String(systemRuntime?.now || now).trim(),
        messageCount: Array.isArray(conversationMessages) ? conversationMessages.length : 0,
      }) } : {}),
    },
    modelContext: {
      protocolVersion: 2,
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
