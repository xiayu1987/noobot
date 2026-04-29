/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeSelectedConnectors(source = {}) {
  const selectedConnectorsSource =
    source && typeof source === "object" ? source : {};
  return Object.fromEntries(
    Object.entries(selectedConnectorsSource)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => Boolean(connectorType)),
  );
}

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
  const systemRuntime =
    runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : {};
  const selectedConnectors = normalizeSelectedConnectors(
    systemRuntime?.config?.selectedConnectors || {},
  );
  return {
    environment: {
      os: {
        platform: staticAgentContext.platform || process.platform,
        arch: staticAgentContext.arch || process.arch,
        timezone:
          staticAgentContext.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "",
        nodeVersion: staticAgentContext.nodeVersion || process.version,
      },
      workspace: {
        cwd: staticAgentContext.cwd || process.cwd(),
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
      dialogProcessId: String(systemRuntime?.dialogProcessId || dialogProcessId || "").trim(),
      timestamp: String(systemRuntime?.now || now).trim(),
      flags: {
        allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
        maxToolLoopTurns: Number(systemRuntime?.config?.maxToolLoopTurns || 0),
      },
      models: {
        runtimeModel: String(runtime?.runtimeModel || "").trim(),
        allEnabledProviders:
          runtime?.allEnabledProviders &&
          typeof runtime.allEnabledProviders === "object"
            ? runtime.allEnabledProviders
            : {},
      },
      controllers: {
        abortSignal: runtime?.abortSignal || null,
        parentAsyncResultContainer: runtime?.parentAsyncResultContainer || null,
        runtime,
      },
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
        attachments: Array.isArray(runtime?.attachmentMetas)
          ? runtime.attachmentMetas
          : [],
        connectors: selectedConnectors,
        turnStore: {
          currentTurnMessages: runtime?.currentTurnMessages || null,
          currentTurnTasks: runtime?.currentTurnTasks || null,
        },
      },
    },
    payload: {
      messages: {
        system: Array.isArray(systemMessages) ? systemMessages : [],
        history: Array.isArray(conversationMessages) ? conversationMessages : [],
      },
      tools: {
        registry: [],
        shared: runtime?.sharedTools || {},
      },
    },
  };
}

