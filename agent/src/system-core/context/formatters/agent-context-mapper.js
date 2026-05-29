/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  safeNum,
  normalizeSelectedConnectors,
  resolveForceToolCall,
} from "../../utils/shared-utils.js";
import { resolveDialogProcessId } from "../session/dialog-process-id-resolver.js";

export function mapToAgentContextSchema({
  staticAgentContext = {},
  runtime = {},
  dialogProcessId = "",
  resolvedRootSessionId = "",
  resolvedSessionTree = {},
  sessionId = "",
  parentSessionId = "",
  caller = "user",
  now = new Date().toISOString(),
  systemMessages = [],
  conversationMessages = [],
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
  const controllers = { runtime: runtimeRef };
  const tools = { registry: [] };
  const resolvedDialogProcessId = resolveDialogProcessId({
    ctx: {
      dialogProcessId,
      agentContext: {
        execution: {
          dialogProcessId: systemRuntime?.dialogProcessId,
          controllers: { runtime: { systemRuntime } },
        },
      },
    },
    messages: conversationMessages,
  });
  return {
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
      identity: {
        userId: staticAgentContext.userId || "",
      },
    },
    execution: {
      dialogProcessId: resolvedDialogProcessId,
      timestamp: String(systemRuntime?.now || now).trim(),
      flags: {
        allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
        forceTool: resolveForceToolCall(systemRuntime?.config || {}),
        maxToolLoopTurns: safeNum(systemRuntime?.config?.maxToolLoopTurns),
      },
      models: {
        runtimeModel: String(runtimeRef?.runtimeModel || "").trim(),
        allEnabledProviders:
          runtimeRef?.allEnabledProviders &&
          typeof runtimeRef.allEnabledProviders === "object"
            ? runtimeRef.allEnabledProviders
            : {},
      },
      controllers,
    },
    session: {
      root: {
        id: String(systemRuntime?.rootSessionId || resolvedRootSessionId || "").trim(),
        tree: systemRuntime?.sessionTree || resolvedSessionTree || {},
        sharedState: {},
      },
      parent: {
        id: String(systemRuntime?.parentSessionId || parentSessionId || "").trim(),
        caller: String(systemRuntime?.caller || caller || "user").trim(),
      },
      current: {
        id: String(systemRuntime?.sessionId || sessionId || "").trim(),
        connectors: selectedConnectors,
      },
    },
    payload: {
      messages: {
        system: Array.isArray(systemMessages) ? systemMessages : [],
        history: Array.isArray(conversationMessages) ? conversationMessages : [],
      },
      tools,
    },
  };
}
